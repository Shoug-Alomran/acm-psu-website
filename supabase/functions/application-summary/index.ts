/**
 * application-summary — advisory Cloudflare Workers AI summary for membership applications.
 *
 * The assistant evaluates clarity/completeness of the submitted information only.
 * The confidence percentage is never an acceptance score or candidate ranking.
 */
import { clientForRequest, fail, json, corsHeaders, requireRole } from '../_shared/http.ts';

interface ApplicantSummary {
  summary: string;
  content_check: {
    quality: 'clear' | 'needs_clarification' | 'insufficient';
    confidence: number;
    rationale: string;
  };
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
Do not score, rank, approve, reject, recommend acceptance, or infer unstated facts.

Your only assessment is whether the submitted information is clear and complete enough for an administrator to understand the applicant before an interview.
The confidence percentage means confidence in the clarity/completeness of the supplied application content, NOT confidence that the applicant should be accepted.

Reply with JSON only in exactly this shape:
{
  "summary": "2-4 concise factual sentences",
  "content_check": {
    "quality": "clear" | "needs_clarification" | "insufficient",
    "confidence": 0-100,
    "rationale": "one concise sentence explaining content clarity/completeness"
  },
  "previous_experience": {
    "status": "reported" | "none" | "not_provided",
    "details": "brief factual summary or null"
  },
  "interests": ["short labels copied or condensed from the application"],
  "goals": "brief factual summary or null",
  "useful_follow_up": ["at most 3 neutral interview questions that clarify the applicant's interests, goals, or experience"]
}

Use "clear" when the submitted information is internally understandable and specific enough to prepare for an interview.
Use "needs_clarification" when one or more answers are vague or ambiguous but still usable.
Use "insufficient" only when the application lacks enough substantive information to summarize reliably.
Never penalize or lower quality merely because the applicant reports no previous experience.`;

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
  if (!accountId || !token) return fail('Workers AI is not configured.', 503, origin);

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
          max_tokens: 700,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.errors?.[0]?.message ?? `HTTP ${response.status}`);

    const raw = String(payload?.result?.response ?? '');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('The model did not return usable JSON.');

    const parsed = JSON.parse(match[0]);
    const experienceStatus = ['reported', 'none', 'not_provided'].includes(parsed?.previous_experience?.status)
      ? parsed.previous_experience.status
      : 'not_provided';
    const quality = ['clear', 'needs_clarification', 'insufficient'].includes(parsed?.content_check?.quality)
      ? parsed.content_check.quality
      : 'needs_clarification';
    const rawConfidence = Number(parsed?.content_check?.confidence);
    const confidence = Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(100, Math.round(rawConfidence)))
      : 50;

    const result: ApplicantSummary = {
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'No summary returned.',
      content_check: {
        quality,
        confidence,
        rationale: typeof parsed?.content_check?.rationale === 'string'
          ? parsed.content_check.rationale
          : 'The model did not provide a rationale.',
      },
      previous_experience: {
        status: experienceStatus,
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
