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

Return one valid JSON object only. Do not use markdown fences, headings, commentary, or text before/after the JSON.
The JSON must match exactly this shape:
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

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    // Fall through to balanced-object extraction.
  }

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, i + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
        } catch {
          start = -1;
        }
      }
    }
  }

  return null;
}

async function runModel(
  accountId: string,
  token: string,
  model: string,
  userPrompt: string,
  repairRaw?: string,
): Promise<string> {
  const messages = repairRaw === undefined
    ? [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]
    : [
        {
          role: 'system',
          content: `${SYSTEM_PROMPT}\n\nYour previous response was not valid JSON. Repair it now. Output only the JSON object.`,
        },
        {
          role: 'user',
          content: `${userPrompt}\n\nPrevious model response to repair:\n${repairRaw.slice(0, 6000)}`,
        },
      ];

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        max_tokens: 900,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.errors?.[0]?.message ?? `HTTP ${response.status}`);
  return String(payload?.result?.response ?? '');
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
    let raw = await runModel(accountId, token, model, userPrompt);
    let parsed = parseJsonObject(raw);

    if (!parsed) {
      raw = await runModel(accountId, token, model, userPrompt, raw);
      parsed = parseJsonObject(raw);
    }

    if (!parsed) throw new Error('The model returned an unreadable response twice. Please retry.');

    const previousExperience = parsed.previous_experience as Record<string, unknown> | undefined;
    const contentCheck = parsed.content_check as Record<string, unknown> | undefined;
    const experienceStatus = ['reported', 'none', 'not_provided'].includes(String(previousExperience?.status))
      ? String(previousExperience?.status) as 'reported' | 'none' | 'not_provided'
      : 'not_provided';
    const quality = ['clear', 'needs_clarification', 'insufficient'].includes(String(contentCheck?.quality))
      ? String(contentCheck?.quality) as 'clear' | 'needs_clarification' | 'insufficient'
      : 'needs_clarification';
    const rawConfidence = Number(contentCheck?.confidence);
    const confidence = Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(100, Math.round(rawConfidence)))
      : 50;

    const result: ApplicantSummary = {
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'No summary returned.',
      content_check: {
        quality,
        confidence,
        rationale: typeof contentCheck?.rationale === 'string'
          ? contentCheck.rationale
          : 'The model did not provide a rationale.',
      },
      previous_experience: {
        status: experienceStatus,
        details: typeof previousExperience?.details === 'string'
          ? previousExperience.details
          : null,
      },
      interests: Array.isArray(parsed.interests)
        ? parsed.interests.filter((item: unknown) => typeof item === 'string').slice(0, 8) as string[]
        : [],
      goals: typeof parsed.goals === 'string' ? parsed.goals : null,
      useful_follow_up: Array.isArray(parsed.useful_follow_up)
        ? parsed.useful_follow_up.filter((item: unknown) => typeof item === 'string').slice(0, 3) as string[]
        : [],
    };

    return json({ summary: result, model, advisory: true }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workers AI request failed.';
    return fail(message, 502, origin);
  }
});
