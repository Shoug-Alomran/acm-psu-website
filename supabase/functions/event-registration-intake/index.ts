/**
 * event-registration-intake — the second copy of a public event signup.
 *
 * Public registration is collected by the Apps Script web app in
 * apps-script/EventRegistration.gs, which appends a row to the jam26/ctf30
 * tabs of the "ACM PSU — Club Records" workbook. Those tabs are Apps Script's
 * — the Supabase snapshot sync excludes them by name — and they remain the
 * intake surface. This function exists so the same registration also lands in
 * Supabase, where the admin records backup can show it and where it survives
 * anything that happens to the spreadsheet.
 *
 * Two ways in, and they are authorized completely differently:
 *
 *   mirror  Called by the Apps Script for each accepted registration, with no
 *           Supabase user behind it. Authorized by a shared secret header, so
 *           this function is deployed with --no-verify-jwt and must therefore
 *           check every caller itself.
 *
 *   import  Called by a club admin from the records backup page to recover the
 *           registrations already sitting in the worksheet — everything from
 *           before the mirror existed. Authorized by the caller's own JWT.
 *
 * Both paths are idempotent: a registration is identified by a hash of its
 * answers, so re-posting a mirror or re-running an import writes nothing.
 * The mirror is best-effort on the Apps Script side, which means a failure
 * here loses no registration — the worksheet row is already written, and the
 * import recovers it later.
 *
 * Required secrets:
 *   EVENT_REGISTRATION_TOKEN           shared with the Apps Script
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY  (import only)
 *
 * The import reads GOOGLE_SHEETS_SPREADSHEET_ID — the club records workbook,
 * which is where the registration tabs are. EVENT_REGISTRATION_SPREADSHEET_ID
 * overrides it, and exists only for the day those tabs move to a file of their
 * own; setting it is not part of ordinary setup.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { clientForRequest, corsHeaders, fail, json, requireRole } from '../_shared/http.ts';
import { readGoogleSheet } from '../_shared/google_sheets.ts';

/** The worksheet column that dates a row rather than identifying it. */
const TIMESTAMP_HEADER = 'Timestamp';

type Form = { event_key: string; label: string; headers: string[]; is_active: boolean };

/**
 * Sheets treats a leading apostrophe as "store the rest as text", so a value
 * the Apps Script guarded against formula injection comes back without it.
 * Stripping one on both sides keeps the live mirror's hash and the imported
 * row's hash equal for the same registration.
 */
function cell(value: unknown): string {
  return String(value ?? '').replace(/^'/, '').trim();
}

/**
 * Identity of a submission: its answers in the worksheet's own column order,
 * with the timestamp left out. Two registrations with identical answers are
 * the same submission — the Apps Script already rejects a second person with
 * a repeated email or university ID before any row is written.
 */
async function identityHash(headers: string[], fields: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(headers
    .filter((header) => header !== TIMESTAMP_HEADER)
    .map((header) => [header, cell(fields[header])]));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent comparison, so a wrong token leaks no timing signal. */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < given.length; i += 1) difference |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

/**
 * A worksheet timestamp as written by Apps Script, in the club's timezone.
 * Anything unparseable falls back to now(): the registration is real and
 * belongs in the mirror even when its cell was edited by hand into something
 * Date cannot read.
 */
function registeredAt(value: unknown): string {
  const text = cell(value);
  if (text) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Edge Function configuration error: Supabase credentials are unavailable.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function forms(service: SupabaseClient): Promise<Form[]> {
  const { data, error } = await service.from('event_registration_forms')
    .select('event_key, label, headers, is_active').order('rank');
  if (error) throw new Error(`Registration forms could not be read: ${error.message}`);
  return (data ?? []) as Form[];
}

/**
 * Inserts one registration unless the same answers are already recorded.
 * Returns whether a row was added, so the import can report honestly instead
 * of claiming to have recovered rows it merely re-saw.
 */
async function record(
  service: SupabaseClient, form: Form,
  fields: Record<string, unknown>, source: 'apps_script' | 'sheet_import',
  requestId: string | null,
): Promise<boolean> {
  // Only the worksheet's own columns are stored. A payload carrying an extra
  // key writes nothing beyond the agreed shape.
  const stored: Record<string, string> = {};
  for (const header of form.headers) {
    if (header !== TIMESTAMP_HEADER) stored[header] = cell(fields[header]);
  }

  const { error } = await service.from('event_registrations').insert({
    event_key: form.event_key,
    registered_at: registeredAt(fields[TIMESTAMP_HEADER]),
    fields: stored,
    request_id: requestId,
    identity_hash: await identityHash(form.headers, fields),
    source,
  });

  // 23505 is the unique constraint doing its job: this registration is
  // already mirrored, which is a success for an idempotent endpoint.
  if (error && (error as { code?: string }).code === '23505') return false;
  if (error) throw new Error(error.message);
  return true;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...corsHeaders(origin),
        'Access-Control-Allow-Headers':
          'authorization, x-client-info, apikey, content-type, x-registration-token',
      },
    });
  }
  if (req.method !== 'POST') return fail('POST only', 405, origin);

  let body: { mode?: string; event?: string; requestId?: string; fields?: Record<string, unknown> } = {};
  try { body = await req.json(); } catch { return fail('Expected a JSON body.', 400, origin); }

  let service: SupabaseClient;
  try { service = serviceClient(); } catch (error) {
    return fail(error instanceof Error ? error.message : 'Configuration error.', 500, origin);
  }

  // ---- import: recover what the worksheet already holds ------------------
  if (body.mode === 'import') {
    const caller = clientForRequest(req);
    if (!caller) return fail('Sign in required.', 401, origin);
    if (!await requireRole(caller, ['club_admin'])) return fail('Club admin access required.', 403, origin);

    // Same workbook as the rest of the club records, different tabs.
    const spreadsheetId = Deno.env.get('EVENT_REGISTRATION_SPREADSHEET_ID')
      ?? Deno.env.get('GOOGLE_SHEETS_SPREADSHEET_ID');
    if (!spreadsheetId) {
      return fail('GOOGLE_SHEETS_SPREADSHEET_ID is not set — see docs/SETUP.md step 5.', 500, origin);
    }

    const imported: Record<string, { added: number; already: number; error?: string }> = {};
    for (const form of await forms(service)) {
      try {
        const matrix = await readGoogleSheet(spreadsheetId, form.event_key);
        const headers = (matrix[0] ?? []).map(cell);
        if (!headers.length) { imported[form.label] = { added: 0, already: 0 }; continue; }

        let added = 0, already = 0;
        for (const row of matrix.slice(1)) {
          const fields: Record<string, string> = {};
          headers.forEach((header, index) => { fields[header] = row[index] ?? ''; });
          // A blank trailing row is spreadsheet padding, not a registration.
          if (!form.headers.some((h) => h !== TIMESTAMP_HEADER && cell(fields[h]))) continue;
          if (await record(service, form, fields, 'sheet_import', null)) added += 1; else already += 1;
        }
        imported[form.label] = { added, already };
      } catch (error) {
        imported[form.label] = {
          added: 0, already: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return json({ imported }, 200, origin);
  }

  // ---- mirror: one live registration from the Apps Script ----------------
  const expected = Deno.env.get('EVENT_REGISTRATION_TOKEN');
  if (!expected) return fail('EVENT_REGISTRATION_TOKEN is not set — see docs/SETUP.md step 5.', 500, origin);
  if (!secretMatches(req.headers.get('x-registration-token') ?? '', expected)) {
    return fail('Not authorized.', 401, origin);
  }

  const eventKey = String(body.event ?? '');
  const form = (await forms(service)).find((f) => f.event_key === eventKey);
  if (!form) return fail(`Unknown event "${eventKey}".`, 400, origin);
  if (!form.is_active) return fail(`Registration for "${eventKey}" is closed.`, 409, origin);
  if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) {
    return fail('Expected fields to be an object of worksheet headings.', 400, origin);
  }

  const requestId = String(body.requestId ?? '');
  try {
    const added = await record(service, form, body.fields,
      'apps_script', /^[a-f0-9]{32}$/.test(requestId) ? requestId : null);
    return json({ stored: added, duplicate: !added }, 200, origin);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Registration could not be mirrored.', 500, origin);
  }
});
