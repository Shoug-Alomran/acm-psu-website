/**
 * application-summary — advisory Cloudflare Workers AI summary for membership applications.
 *
 * This function never scores, ranks, approves, rejects, or recommends a decision.
 * It only turns the applicant's own answers into a concise reviewer summary and
 * highlights whether previous experience was reported.
 */
import { clientForRequest, fail, json, corsHeaders, requireRole } from '../_shared/http.ts';

interface ApplicantSummary {
  summary: string;
  previous_experience: {
    status: 'reported' | 'none' | 'not_provided';
    details: string | null;
  };
  interests: string[];
  goals: string | null;
  useful_follow_up: string[];
}

const SYSTEM_PROMPT = `You assist an ACM student-club administrator reviewing a membership application.
Membership is not a technical screening and prior experience is not required.
Do not score, rank, approve, reject, or recommend a decision. Do not infer facts the applicant did not state.
Summarize only the supplied application information in clear neutral language.

Reply with JSON only in exactly this shape:
{
  "summary": "2-4 concise sentences",
  "previous_experience": {
    "status": "reported" | "none" | "not_provided",
    "details": "brief factual summary or null"
  },
  "interests": ["short labels copied or condensed from the application"],
  "goals": "brief factual summary or null",
  "useful_follow_up": ["at most 3 neutral questions that would clarify the applicant's interests or experience"]
}

If the applicant says they have no experience, use status "none". If they did not answer, use "not_provided".
Never turn missing experience into a negative assessment.`;

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return fail('POST only', 405, origin);

  const supabase = clientForRequest(req);
  if (!supabase) return fail('Sign in required.', 401, origin);

  const caller = await requireRole(supabase, ['reviewer', 'club_admin']);
  if (!caller) return fail('Reviewer access required.', 403, origin);

  let applicationId = '';
  try {
    const body = await req.json();
    applicationId = String(body?.application_id ?? '');
  } catch {
    return fail('Expected JSON body { application_id }.', 400, origin);
  }
  if (!applicationId) return fail('application_id is required.', 400, origin);

  const { data: application, error } = await supabase
    .from('applications')
    .select(`
      id, full_name, major, academic_year, interests, goal_text,
      experience_status, experience_text, status, created_at
    `)
    .eq('id', applicationId)
    .single();

  if (error || !application) return fail('Application not found.', 404, origin);

  const accountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID');
  const token = Deno.env.get('CLOUDFLARE_AI_TOKEN');
  if (!accountId || !token) {
    return fail('Workers AI is not configured.', 503, origin);
  }

  const model = Deno.env.get('CLOUDFLARE_AI_MODEL') ?? '@cf/meta/llama-3.1-8b-instruct-fast';
  const userPrompt = [
    `Applicant: ${application.full_name}`,
    `Major: ${application.major}`,
    `Academic year: ${application.academic_year}`,
    `Areas of interest: ${(application.interests ?? []).join(', ') || '(none provided)'}`,
    `Previous experience status: ${application.experience_status ?? 'not_provided'}`,
    `Previous experience details: ${application.experience_text ?? '(none provided)'}`,
    `What they want from ACM: ${application.goal_text ?? '(none provided)'}`,
  ].join('\n');

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 650,
          temperature: 0.15,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.errors?.[0]?.message ?? `HTTP ${response.status}`);
    }

    const raw = String(payload?.result?.response ?? '');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('The model did not return usable JSON.');

    const parsed = JSON.parse(match[0]);
    const status = ['reported', 'none', 'not_provided'].includes(parsed?.previous_experience?.status)
      ? parsed.previous_experience.status
      : 'not_provided';

    const result: ApplicantSummary = {
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'No summary returned.',
      previous_experience: {
        status,
        details: typeof parsed?.previous_experience?.details === 'string'
          ? parsed.previous_experience.details
          : null,
      },
      interests: Array.isArray(parsed.interests)
        ? parsed.interests.filter((item: unknown) => typeof item === 'string').slice(0, 8)
        : [],
      goals: typeof parsed.goals === 'string' ? parsed.goals : null,
      useful_follow_up: Array.isArray(parsed.useful_follow_up)
        ? parsed.useful_follow_up.filter((item: unknown) => typeof item === 'string').slice(0, 3)
        : [],
    };

    return json({ summary: result, model, advisory: true }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workers AI request failed.';
    return fail(message, 502, origin);
  }
});
