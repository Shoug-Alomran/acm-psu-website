/** Refreshes the private Members worksheet after an authenticated signup/profile sync. */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, fail, json } from '../_shared/http.ts';
import { pushToGoogleSheet } from '../_shared/google_sheets.ts';

const HEADERS = [
  'Name', 'Student ID', 'PSU Email', 'Major', 'Academic Year',
  'Position', 'Membership Status', 'Join Date',
];
const COLUMNS = [
  'full_name', 'student_id', 'psu_email', 'major', 'academic_year',
  'position_title', 'membership_status', 'join_date',
] as const;

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return fail('POST only', 405, origin);

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return fail('Sign in required.', 401, origin);

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: identity } = await caller.auth.getUser();
  if (!identity.user) return fail('Sign in required.', 401, origin);

  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: enabled } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'google_sheets_enabled')
    .maybeSingle();
  if (enabled?.value !== true) return json({ ok: true, skipped: 'disabled' }, 200, origin);

  const { data: allowed, error: gateError } = await service.rpc('begin_member_sheet_sync');
  if (gateError) return fail('Could not schedule the Members worksheet refresh.', 503, origin);
  if (!allowed) return json({ ok: true, skipped: 'recently_synced' }, 200, origin);

  const { data, error } = await service.rpc('export_members_for_sheet_sync');
  if (error) return fail('Could not collect member records.', 503, origin);

  const records = (data ?? []) as Array<Record<string, unknown>>;
  const matrix = [HEADERS, ...records.map((row) => COLUMNS.map((key) => row[key] ?? ''))];

  try {
    await pushToGoogleSheet('Members', matrix);
    await service.rpc('finish_member_sheet_sync', {
      succeeded: true,
      failure_message: null,
      synced_rows: records.length,
    });
    return json({ ok: true, rows: records.length }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Sheets sync failed.';
    console.error('[member-sheet-sync] Google Sheets sync failed:', error);
    await service.rpc('finish_member_sheet_sync', {
      succeeded: false,
      failure_message: message.slice(0, 500),
      synced_rows: records.length,
    });
    return json({ ok: false, skipped: 'sheet_failed', error: message }, 200, origin);
  }
});
