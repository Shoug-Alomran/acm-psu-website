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

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    content_check: {
      type: 'object',
      additionalProperties: false,
      properties: {
        quality: {
          type: 'string',
          enum: ['clear', 'needs_clarification', 'insufficient'],
        },
        confidence: { type: 'number', minimum: 0, maximum: 100 },
        rationale: { type: 'string' },
      },
      required: ['quality', 'confidence', 'rationale'],
    },
    previous_experience: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: {
          type: 'string',
          enum: ['reported', 'none', 'not_provided'],
        },
        details: { type: ['string', 'null'] },
      },
      required: ['status', 'details'],
    },
    interests: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 8,
    },
    goals: { type: ['string', 'null'] },
    useful_follow_up: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 3,
    },
  },
  required: [
    'summary',
    'content_check',
    'previous_experience',
    'interests',
    'goals',
    'useful_follow_up',
  ],
};

const SYSTEM_PROMPT = `You assist an ACM student-club administrator reviewing a membership application.
Membership is not a technical screening and prior experience is not required.
Do not score, rank, approve, reject, recommend acceptance, or infer unstated facts.

Your only assessment is whether the submitted information is clear and complete enough for an administrator to understand the applicant before an interview.
The confidence percentage means confidence in the clarity/completeness of the supplied application content, NOT confidence that the applicant should be accepted.

Use "clear" when the submitted information is internally understandable and specific enough to prepare for an interview.
Use "needs_clarification" when one or more answers are vague or ambiguous but still usable.
Use "insufficient" only when the application lacks enough substantive information to summarize reliably.
Never penalize or lower quality merely because the applicant reports no previous experience.
Keep the summary factual and concise, and suggest at most three neutral interview follow-up questions.`;

function normalizeSummary(parsed: unknown): ApplicantSummary {
  const value = parsed as Record<string, unknown>;
  const check = (value?.content_check ?? {}) as Record<string, unknown>;
  const experience = (value?.previous_experience ?? {}) as Record<string, unknown>;

  const quality = ['clear', 'needs_clarification', 'insufficient'].includes(String(check.quality))
    ? String(check.quality) as ApplicantSummary['content_check']['quality']
    : 'needs_clarification';

  const rawConfidence = Number(check.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(100, Math.round(rawConfidence)))
    : 50;

  const experienceStatus = ['reported', 'none', 'not_provided'].includes(String(experience.status))
    ? String(experience.status) as ApplicantSummary['previous_experience']['status']
    : 'not_provided';

  return {
    summary: typeof value.summary === 'string' ? value.summary : 'No summary returned.',
    content_check: {
      quality,
      confidence,
      rationale: typeof check.rationale === 'string'
        ? check.rationale
        : 'The model did not provide a rationale.',
    },
    previous_experience: {
      status: experienceStatus,
      details: typeof experience.details === 'string' ? experience.details : null,
    },
    interests: Array.isArray(value.interests)
      ? value.interests.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [],
    goals: typeof value.goals === 'string' ? value.goals : null,
    useful_follow_up: Array.isArray(value.useful_follow_up)
      ? value.useful_follow_up.filter((item): item is string => typeof item === 'string').slice(0, 3)
      : [],
  };
}

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
          response_format: {
            type: 'json_schema',
            json_schema: SUMMARY_SCHEMA,
          },
          max_tokens: 700,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    const payload = await response.json();
    if (!response.ok) {
      const cloudflareMessage = payload?.errors?.[0]?.message
        ?? payload?.messages?.[0]?.message
        ?? `HTTP ${response.status}`;
      throw new Error(cloudflareMessage);
    }

    const raw = payload?.result?.response;
    let parsed: unknown;

    if (raw && typeof raw === 'object') {
      // Cloudflare JSON Mode returns the validated object directly here.
      parsed = raw;
    } else if (typeof raw === 'string' && raw.trim()) {
      parsed = JSON.parse(raw);
    } else {
      throw new Error('Cloudflare returned no structured response.');
    }

    const result = normalizeSummary(parsed);
    return json({ summary: result, model, advisory: true }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workers AI request failed.';
    return fail(message, 502, origin);
  }
});
