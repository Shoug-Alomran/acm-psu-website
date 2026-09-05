/** AI-assisted bio formatting for an instructor's own public profile. */
import { clientForRequest, corsHeaders, fail, json } from '../_shared/http.ts';

const SYSTEM_PROMPT = `You format an ACM PSU faculty profile bio.
Use only facts present in the supplied draft and profile fields. Never invent credentials, publications, awards, employment, or responsibilities.
Return polished plain text in two or three short paragraphs separated by blank lines.
Paragraph 1 should introduce the person and academic focus. Paragraph 2 should connect their expertise, teaching, or research to their ACM role. Use a professional, warm third-person voice. Do not use headings, bullets, markdown, hype, or generic filler.`;

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return fail('POST only', 405, origin);
  const client = clientForRequest(req);
  if (!client) return fail('Sign in required.', 401, origin);
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return fail('Sign in required.', 401, origin);

  let draft = '';
  try { draft = String((await req.json())?.draft ?? '').trim().slice(0, 5000); }
  catch { return fail('Expected JSON body { draft }.', 400, origin); }

  const [personResult, instructorResult] = await Promise.all([
    client.from('app_users').select('full_name, university_role').eq('id', auth.user.id).single(),
    client.from('instructor_profiles').select('*').eq('user_id', auth.user.id).maybeSingle(),
  ]);
  const person = personResult.data;
  if (!person || !['instructor', 'staff'].includes(person.university_role)) {
    return fail('Instructor account required.', 403, origin);
  }
  if (instructorResult.error) return fail(instructorResult.error.message, 500, origin);
  const profile = instructorResult.data ?? {};
  if (!draft && !Object.values(profile).some(Boolean)) {
    return fail('Add a draft or academic profile details first.', 400, origin);
  }

  const accountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID');
  const token = Deno.env.get('CLOUDFLARE_AI_TOKEN');
  if (!accountId || !token) return fail('Workers AI is not configured.', 503, origin);
  const model = Deno.env.get('CLOUDFLARE_AI_MODEL') ?? '@cf/meta/llama-3.1-8b-instruct-fast';
  const facts = [
    `Name: ${person.full_name}`,
    `Current draft: ${draft || '(none)'}`,
    `Academic title: ${profile.academic_title ?? '(not supplied)'}`,
    `Department: ${profile.department ?? '(not supplied)'}`,
    `Courses taught: ${(profile.courses_taught ?? []).join(', ') || '(not supplied)'}`,
    `Expertise: ${(profile.expertise ?? []).join(', ') || '(not supplied)'}`,
    `Research interests: ${(profile.research_interests ?? []).join(', ') || '(not supplied)'}`,
  ].join('\n');

  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: facts }],
        max_tokens: 550, temperature: 0.2,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.errors?.[0]?.message ?? `HTTP ${response.status}`);
    const bio = String(payload?.result?.response ?? '').trim()
      .replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/, '').slice(0, 5000);
    if (!bio) throw new Error('The formatter returned no text.');
    return json({ bio, model, advisory: true }, 200, origin);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Workers AI request failed.', 502, origin);
  }
});
