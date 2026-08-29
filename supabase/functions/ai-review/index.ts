/**
 * ai-review — Cloudflare Workers AI assistance for archive submission review.
 *
 * The assistant is advisory and nothing more. It cannot approve, publish or
 * change visibility: it only writes a row to archive_submission_ai, which the
 * admin review page renders as suggestions with ACCEPT / EDIT / IGNORE beside
 * each one. Publishing still goes exclusively through
 * publish_archive_submission(), which demands an authenticated club admin.
 *
 * The Cloudflare token lives in an Edge Function secret and never reaches a
 * browser.
 *
 * POST { submission_id: string }
 */
import { clientForRequest, fail, json, corsHeaders, requireRole } from '../_shared/http.ts';

interface Suggestion {
  category: string | null;
  project_hint: string | null;
  title: string | null;
  description: string | null;
  tags: string[];
  visibility: 'public' | 'internal' | null;
  reasoning: string | null;
}

interface Flag {
  kind: string;
  severity: 'info' | 'warning' | 'high';
  detail: string;
}

const SYSTEM_PROMPT = `You assist a student club administrator who is reviewing a file
submitted to a public digital archive. You never approve anything. You only describe what
you see and suggest improvements a human will accept or reject.

Reply with JSON only, matching exactly this shape:
{
  "category": "<one of the allowed category slugs, or null>",
  "project_hint": "<the project this most likely belongs to, or null>",
  "title": "<a clearer archive title, or null if the given one is already good>",
  "description": "<one or two factual sentences describing the file, or null>",
  "tags": ["short", "lowercase", "tags"],
  "visibility": "public" | "internal" | null,
  "reasoning": "<one sentence on why you suggested this visibility>",
  "flags": [
    { "kind": "student_id" | "personal_information" | "credentials" | "unverified_claim"
              | "possible_duplicate" | "needs_manual_check",
      "severity": "info" | "warning" | "high",
      "detail": "<what the admin should look at>" }
  ]
}

Be conservative about visibility. If anything suggests the file contains student IDs,
email addresses, phone numbers, grades, names of participants, internal planning notes,
or credentials, suggest "internal" and raise a flag. When you are unsure, say so with a
"needs_manual_check" flag rather than guessing.`;

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return fail('POST only', 405, origin);

  const supabase = clientForRequest(req);
  if (!supabase) return fail('Sign in required.', 401, origin);

  const caller = await requireRole(supabase, ['reviewer', 'club_admin']);
  if (!caller) return fail('Reviewer access required.', 403, origin);

  const accountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID');
  const token = Deno.env.get('CLOUDFLARE_AI_TOKEN');
  if (!accountId || !token) {
    return fail(
      'Workers AI is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN ' +
      'as Edge Function secrets — see docs/SETUP.md step 4.',
      503, origin,
    );
  }

  let submissionId: string;
  try {
    ({ submission_id: submissionId } = await req.json());
  } catch {
    return fail('Expected JSON body { submission_id }.', 400, origin);
  }
  if (!submissionId) return fail('submission_id is required.', 400, origin);

  // Read through the caller's client: a non-reviewer could not see this row.
  const { data: submission, error } = await supabase
    .from('archive_submissions')
    .select(`
      id, title, description, notes, category, file_name, mime_type, size_bytes,
      external_url, occurred_on, contributor_names, suggested_visibility,
      project:projects ( id, title, slug )
    `)
    .eq('id', submissionId)
    .single();

  if (error || !submission) return fail('Submission not found.', 404, origin);

  const [{ data: categories }, { data: projects }, { data: similar }] = await Promise.all([
    supabase.from('archive_categories').select('slug, label').eq('is_active', true),
    supabase.from('projects').select('slug, title').is('deleted_at', null).limit(50),
    // Candidate duplicates: same-ish name already in the archive.
    supabase.from('archive_items')
      .select('id, name, project_id')
      .ilike('name', `%${submission.title.slice(0, 24)}%`)
      .is('deleted_at', null)
      .limit(5),
  ]);

  const model = Deno.env.get('CLOUDFLARE_AI_MODEL') ?? '@cf/meta/llama-3.1-8b-instruct';

  const userPrompt = [
    `Allowed category slugs: ${(categories ?? []).map((c) => c.slug).join(', ')}`,
    `Known projects: ${(projects ?? []).map((p) => `${p.slug} (${p.title})`).join('; ')}`,
    '',
    'Submission under review:',
    `  title: ${submission.title}`,
    `  submitted category: ${submission.category ?? '(none)'}`,
    `  stated project: ${(submission.project as { title?: string } | null)?.title ?? '(none)'}`,
    `  description: ${submission.description ?? '(none)'}`,
    `  member notes: ${submission.notes ?? '(none)'}`,
    `  file name: ${submission.file_name ?? '(link submission)'}`,
    `  mime type: ${submission.mime_type ?? 'n/a'}`,
    `  size: ${submission.size_bytes ?? 'n/a'} bytes`,
    `  external url: ${submission.external_url ?? '(none)'}`,
    `  date: ${submission.occurred_on ?? '(none)'}`,
    `  named contributors: ${(submission.contributor_names ?? []).join(', ') || '(none)'}`,
    `  member suggested visibility: ${submission.suggested_visibility}`,
    '',
    similar?.length
      ? `Existing archive items with similar names (possible duplicates): ${similar.map((s) => s.name).join('; ')}`
      : 'No similarly named items already in the archive.',
  ].join('\n');

  let suggestions: Suggestion | null = null;
  let flags: Flag[] = [];
  let raw = '';
  let failure: string | null = null;

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 800,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.errors?.[0]?.message ?? `HTTP ${response.status}`);

    raw = payload?.result?.response ?? '';
    // Models wrap JSON in prose or fences often enough to be worth handling.
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : null;

    if (parsed) {
      suggestions = {
        category: typeof parsed.category === 'string' ? parsed.category : null,
        project_hint: typeof parsed.project_hint === 'string' ? parsed.project_hint : null,
        title: typeof parsed.title === 'string' ? parsed.title : null,
        description: typeof parsed.description === 'string' ? parsed.description : null,
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t: unknown) => typeof t === 'string').slice(0, 8) : [],
        visibility: parsed.visibility === 'public' || parsed.visibility === 'internal' ? parsed.visibility : null,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : null,
      };
      flags = Array.isArray(parsed.flags)
        ? parsed.flags
            .filter((f: Flag) => f && typeof f.kind === 'string')
            .map((f: Flag) => ({
              kind: f.kind,
              severity: ['info', 'warning', 'high'].includes(f.severity) ? f.severity : 'info',
              detail: String(f.detail ?? ''),
            }))
            .slice(0, 10)
        : [];
    } else {
      failure = 'The model did not return usable JSON.';
    }
  } catch (e) {
    failure = e instanceof Error ? e.message : 'Workers AI request failed.';
  }

  // A duplicate check the model cannot get wrong, added regardless of its answer.
  if (similar?.length) {
    flags.unshift({
      kind: 'possible_duplicate',
      severity: 'warning',
      detail: `Archive already contains: ${similar.map((s) => s.name).join('; ')}`,
    });
  }

  const { error: writeError } = await supabase
    .from('archive_submission_ai')
    .upsert({
      submission_id: submissionId,
      model,
      suggestions: suggestions ?? {},
      flags,
      raw_response: raw.slice(0, 8000),
      generated_by: caller.userId,
      generated_at: new Date().toISOString(),
      error: failure,
    }, { onConflict: 'submission_id' });

  if (writeError) return fail(writeError.message, 500, origin);

  // Record that a suggestion was offered, as the assistant. The audit_log
  // constraint forbids an ai_assistant entry from carrying a decision, so this
  // can never read as an approval — the admin's own entry does that, and names
  // which suggestions they accepted.
  await supabase.rpc('record_ai_suggestion', {
    submission_id: submissionId,
    model,
    suggestion_summary: failure
      ? `Assistant could not produce suggestions: ${failure}`
      : `Suggested ${[
          suggestions?.category && 'a category',
          suggestions?.title && 'a title',
          suggestions?.description && 'a description',
          suggestions?.visibility && `${suggestions.visibility} visibility`,
        ].filter(Boolean).join(', ') || 'no changes'}` +
        (flags.length ? `; raised ${flags.length} flag(s)` : ''),
    flags,
  });

  return json({ suggestions, flags, model, error: failure, advisory: true }, failure ? 502 : 200, origin);
});
