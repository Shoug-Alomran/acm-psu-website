/** Canonical Supabase -> Google Sheets mirror for the private club workbook. */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { clientForRequest, corsHeaders, fail, json, requireRole } from '../_shared/http.ts';
import { pushToGoogleSheet, WORKBOOK_NAME } from '../_shared/google_sheets.ts';

type SheetKey = 'people' | 'members' | 'club_positions' | 'opportunity_positions' |
  'position_applications' | 'event_participation' | 'contributions' | 'inquiries' |
  'university_export_log';
type Matrix = unknown[][];
type Row = Record<string, any>;

const ORDER: SheetKey[] = ['people', 'members', 'club_positions', 'opportunity_positions',
  'position_applications', 'event_participation', 'contributions', 'inquiries',
  'university_export_log'];
const NAMES: Record<SheetKey, string> = {
  people: 'People', members: 'Members', club_positions: 'Club Positions',
  opportunity_positions: 'Opportunity Positions', position_applications: 'Position Applications',
  event_participation: 'Event Participation', contributions: 'Contributions', inquiries: 'Inquiries',
  university_export_log: 'University Export Log',
};

async function rows(client: SupabaseClient, table: string, columns = '*'): Promise<Row[]> {
  const { data, error } = await client.from(table).select(columns);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as Row[];
}
const byId = (items: Row[]) => new Map(items.map((item) => [item.id, item]));
const byUser = (items: Row[]) => new Map(items.map((item) => [item.user_id, item]));
const join = (values: Array<string | null | undefined>) => [...new Set(values.filter(Boolean))].join(' · ');

async function core(client: SupabaseClient) {
  const [users, profiles, memberships, history, positions, admins, organizers, projects] = await Promise.all([
    rows(client, 'app_users'), rows(client, 'member_profiles'), rows(client, 'memberships'),
    rows(client, 'position_history'), rows(client, 'positions'), rows(client, 'admin_assignments'),
    rows(client, 'project_organizers'), rows(client, 'projects'),
  ]);
  const liveUsers = users.filter((u) => !u.deleted_at);
  return { users: liveUsers, userMap: byId(liveUsers), profiles: byUser(profiles),
    memberships: byUser(memberships), history, positions, positionMap: byId(positions),
    admins: admins.filter((a) => !a.revoked_at), organizers, projectMap: byId(projects) };
}

async function people(client: SupabaseClient): Promise<Matrix> {
  const c = await core(client);
  const current = new Map(c.history.filter((h) => !h.ended_on).map((h) => [h.user_id, h]));
  return [['Name', 'PSU Email', 'Person Type', 'University Role', 'ACM Role', 'Project Roles',
    'Account State', 'Admin/System Roles', 'Student ID', 'Major', 'Academic Year', 'Membership Status'],
  ...c.users.sort((a, b) => a.full_name.localeCompare(b.full_name)).map((u) => {
    const membership = c.memberships.get(u.id); const assignment = current.get(u.id);
    const systemRoles = c.admins.filter((a) => a.user_id === u.id).map((a) => a.role);
    const projectRoles = c.organizers.filter((o) => o.user_id === u.id)
      .map((o) => `${c.projectMap.get(o.project_id)?.title ?? 'Project'}: ${o.role_text}`);
    const acmRole = assignment?.title_snapshot ?? '';
    const personType = u.university_role === 'instructor'
      ? (/faculty advisor/i.test(acmRole) || systemRoles.includes('advisory_instructor') ? 'Faculty Advisor' : 'Instructor')
      : u.university_role === 'staff' ? 'University Staff'
      : u.university_role === 'alumni' ? 'Alumni'
      : u.university_role === 'student' ? (membership ? 'Student Member' : 'Student Account')
      : 'Other Affiliate';
    const student = u.university_role === 'student';
    return [u.full_name, u.email, personType, u.university_role, acmRole, join(projectRoles),
      u.account_state, join(systemRoles), student ? u.student_id ?? '' : '',
      student ? u.major ?? '' : '', student ? c.profiles.get(u.id)?.academic_year ?? '' : '',
      student ? membership?.status ?? '' : ''];
  })];
}

async function members(client: SupabaseClient): Promise<Matrix> {
  const c = await core(client);
  const current = new Map(c.history.filter((h) => !h.ended_on).map((h) => [h.user_id, h.title_snapshot]));
  return [['Name', 'PSU Email', 'Student ID', 'Major', 'Academic Year', 'Membership Status',
    'Membership Start', 'Membership End', 'Member Number', 'Chapter Year', 'Club Position', 'Account State'],
  ...c.users.filter((u) => u.university_role === 'student' && c.memberships.has(u.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name)).map((u) => {
      const m = c.memberships.get(u.id)!; return [u.full_name, u.email, u.student_id ?? '', u.major ?? '',
        c.profiles.get(u.id)?.academic_year ?? '', m.status, m.started_on ?? '', m.ended_on ?? '',
        m.member_no ?? '', m.chapter_year ?? '', current.get(u.id) ?? '', u.account_state];
    })];
}

async function clubPositions(client: SupabaseClient): Promise<Matrix> {
  const c = await core(client); const out: unknown[][] = [];
  for (const p of c.positions.sort((a, b) => a.rank - b.rank)) {
    const assignments = c.history.filter((h) => h.position_id === p.id);
    if (!assignments.length) out.push([p.id, p.slug, p.title, p.category, p.rank, p.is_active, '', '', '', '', '', '', '']);
    for (const h of assignments) { const u = c.userMap.get(h.user_id); out.push([p.id, p.slug, p.title,
      p.category, p.rank, p.is_active, u?.full_name ?? '', u?.email ?? '', u?.university_role ?? '',
      h.started_on, h.ended_on ?? '', h.chapter_year ?? '', h.ended_on ? 'Past' : 'Current']); }
  }
  for (const h of c.history.filter((h) => !h.position_id)) { const u = c.userMap.get(h.user_id);
    out.push(['', '', h.title_snapshot, 'custom', '', false, u?.full_name ?? '', u?.email ?? '',
      u?.university_role ?? '', h.started_on, h.ended_on ?? '', h.chapter_year ?? '', h.ended_on ? 'Past' : 'Current']); }
  return [['Position ID', 'Slug', 'Position Name', 'Category', 'Rank', 'Active', 'Holder Name',
    'Holder Email', 'University Role', 'Assignment Start', 'Assignment End', 'Chapter Year', 'Assignment Status'], ...out];
}

async function opportunityPositions(client: SupabaseClient): Promise<Matrix> {
  const [positions, projects, applications] = await Promise.all([rows(client, 'event_positions'), rows(client, 'projects'), rows(client, 'event_position_applications')]);
  const pm = byId(projects); return [['Opportunity ID', 'Project', 'Project Kind', 'Project Status', 'Position',
    'Description', 'Openings', 'Approved', 'Pending', 'Remaining', 'Open', 'Closes On', 'Created At'],
  ...positions.map((p) => { const apps = applications.filter((a) => a.event_position_id === p.id);
    const approved = apps.filter((a) => a.status === 'approved').length; const pending = apps.filter((a) => a.status === 'pending').length;
    const project = pm.get(p.project_id); return [p.id, project?.title ?? '', project?.kind ?? '', project?.status ?? '',
      p.title, p.description ?? '', p.openings, approved, pending, Math.max(p.openings - approved, 0), p.is_open, p.closes_on ?? '', p.created_at]; })];
}

async function positionApplications(client: SupabaseClient): Promise<Matrix> {
  const [apps, users, positions, projects] = await Promise.all([rows(client, 'event_position_applications'), rows(client, 'app_users'), rows(client, 'event_positions'), rows(client, 'projects')]);
  const um = byId(users), pm = byId(positions), projectsMap = byId(projects);
  return [['Application ID', 'Applicant Name', 'Email', 'University Role', 'Project', 'Position', 'Availability',
    'Note', 'Status', 'Admin Note', 'Decided By', 'Decided At', 'Applied At'], ...apps.map((a) => {
      const u = um.get(a.user_id), p = pm.get(a.event_position_id); return [a.id, u?.full_name ?? '', u?.email ?? '',
        u?.university_role ?? '', projectsMap.get(p?.project_id)?.title ?? '', p?.title ?? '', a.availability ?? '',
        a.note ?? '', a.status, a.admin_note ?? '', um.get(a.decided_by)?.full_name ?? '', a.decided_at ?? '', a.created_at]; })];
}

async function participation(client: SupabaseClient): Promise<Matrix> {
  const [items, users, projects, positions] = await Promise.all([rows(client, 'participations'), rows(client, 'app_users'), rows(client, 'projects'), rows(client, 'event_positions')]);
  const um = byId(users), pm = byId(projects), epm = byId(positions);
  return [['Participation ID', 'Person Name', 'Email', 'University Role', 'Project', 'Project Kind',
    'Opportunity Position', 'Role', 'Status', 'Started', 'Ended', 'Verified At', 'Verified By', 'Updated At'],
  ...items.map((i) => { const u = um.get(i.user_id), p = pm.get(i.project_id); return [i.id, u?.full_name ?? '',
    u?.email ?? '', u?.university_role ?? '', p?.title ?? '', p?.kind ?? '', epm.get(i.event_position_id)?.title ?? '',
    i.role_text, i.status, i.started_on ?? '', i.ended_on ?? '', i.verified_at ?? '', um.get(i.verified_by)?.full_name ?? '', i.updated_at]; })];
}

async function contributions(client: SupabaseClient): Promise<Matrix> {
  const [items, users, projects, types] = await Promise.all([rows(client, 'contributions'), rows(client, 'app_users'), rows(client, 'projects'), rows(client, 'contribution_types')]);
  const um = byId(users), pm = byId(projects), tm = new Map(types.map((t) => [t.slug, t.label]));
  return [['Contribution ID', 'Person Name', 'Email', 'University Role', 'Project', 'Title', 'Type', 'Role',
    'Description', 'Occurred On', 'Status', 'Verified At', 'Reviewed By', 'Review Note', 'Created At'],
  ...items.filter((i) => !i.deleted_at).map((i) => { const u = um.get(i.user_id); return [i.id, u?.full_name ?? '',
    u?.email ?? '', u?.university_role ?? '', pm.get(i.project_id)?.title ?? '', i.title, tm.get(i.type_slug) ?? i.type_slug,
    i.role_text ?? '', i.description ?? '', i.occurred_on ?? '', i.status, i.verified_at ?? '',
    um.get(i.reviewed_by)?.full_name ?? '', i.review_note ?? '', i.created_at]; })];
}

async function inquiries(client: SupabaseClient): Promise<Matrix> {
  const [items, users] = await Promise.all([rows(client, 'inquiries'), rows(client, 'app_users')]); const um = byId(users);
  return [['Reference', 'Received', 'From', 'Email', 'Category', 'Subject', 'Message', 'Status', 'Assigned To',
    'Responded At', 'Response Delivered', 'Closed At'], ...items.map((i) => [i.reference, i.created_at, i.sender_name,
    i.sender_email, i.category ?? '', i.subject, i.message, i.status, um.get(i.assigned_to)?.full_name ?? '',
    i.responded_at ?? '', i.response_delivered, i.closed_at ?? ''])];
}

async function exportLog(client: SupabaseClient): Promise<Matrix> {
  const [items, users] = await Promise.all([rows(client, 'university_exports'), rows(client, 'app_users')]); const um = byId(users);
  return [['Generated At', 'Dataset', 'Format', 'Rows', 'Generated By', 'Destination'],
    ...items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 500)
      .map((i) => [i.created_at, i.dataset, i.format, i.row_count, um.get(i.generated_by)?.full_name ?? '', i.destination ?? ''])];
}

const COLLECT: Record<SheetKey, (client: SupabaseClient) => Promise<Matrix>> = {
  people, members, club_positions: clubPositions, opportunity_positions: opportunityPositions,
  position_applications: positionApplications, event_participation: participation,
  contributions, inquiries, university_export_log: exportLog,
};

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return fail('POST only', 405, origin);
  const caller = clientForRequest(req); if (!caller) return fail('Sign in required.', 401, origin);
  const { data: auth } = await caller.auth.getUser(); if (!auth.user) return fail('Sign in required.', 401, origin);

  // Workbook synchronization exposes and rewrites a private administrative
  // record. Do not let ordinary members trigger it indirectly: every sync is
  // restricted to operational admins or assigned faculty advisors.
  const synchronizer = await requireRole(caller, ['super_admin', 'club_admin', 'advisory_instructor']);
  if (!synchronizer) return fail('Club admin or advisory instructor access required.', 403, origin);

  let body: { mode?: string; sheets?: SheetKey[] } = {}; try { body = await req.json(); } catch { /* defaults */ }
  const full = body.mode === 'full';
  let requested = full ? ORDER : (body.sheets ?? []);
  requested = [...new Set(requested)].filter((key): key is SheetKey => ORDER.includes(key));
  if (!requested.length) return fail('No supported worksheets requested.', 400, origin);
  if (!full && requested.length > 2) return fail('Targeted refreshes may update at most two worksheets.', 400, origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl) return fail('Edge Function configuration error: SUPABASE_URL is unavailable.', 500, origin);
  if (!serviceRoleKey) return fail('Edge Function configuration error: SUPABASE_SERVICE_ROLE_KEY is unavailable.', 500, origin);

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sheetsEnabled, error: sheetsEnabledError } = await caller.rpc('setting_bool', {
    setting_key: 'google_sheets_enabled',
    fallback: false,
  });
  if (sheetsEnabledError) {
    return fail(`Could not read Google Sheets setting: ${sheetsEnabledError.message}`, 500, origin);
  }
  if (sheetsEnabled !== true) return fail('Google Sheets export is disabled in settings.', 409, origin);

  const { error: serviceCheckError } = await service
    .from('app_settings')
    .select('key')
    .eq('key', 'google_sheets_enabled')
    .maybeSingle();
  if (serviceCheckError) {
    return fail(`Supabase service connection failed: ${serviceCheckError.message}`, 500, origin);
  }

  const results: Record<string, { rows: number; status: 'updated' | 'failed'; error?: string }> = {};
  let workbookUrl = '';
  for (const key of requested.filter((key) => key !== 'university_export_log')) {
    try {
      const matrix = await COLLECT[key](service);
      workbookUrl = await pushToGoogleSheet(NAMES[key], matrix);
      results[NAMES[key]] = { rows: Math.max(matrix.length - 1, 0), status: 'updated' };
      if (full) {
        // Export logging may remain unavailable to advisory instructors because
        // that RPC is intentionally an admin-only audit write. A failed log
        // entry must not make an otherwise successful workbook refresh fail.
        const { error: logError } = await caller.rpc('record_university_export', {
          dataset: key,
          format: 'google_sheet',
          row_count: Math.max(matrix.length - 1, 0),
          destination: workbookUrl,
          reason: 'Manual full club records refresh',
        });
        if (logError) console.warn(`Could not record ${key} workbook export: ${logError.message}`);
      }
    } catch (error) {
      results[NAMES[key]] = {
        rows: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (requested.includes('university_export_log')) {
    try {
      const matrix = await exportLog(service);
      workbookUrl = await pushToGoogleSheet(NAMES.university_export_log, matrix);
      results[NAMES.university_export_log] = { rows: Math.max(matrix.length - 1, 0), status: 'updated' };
    } catch (error) {
      results[NAMES.university_export_log] = {
        rows: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const success = Object.values(results).every((result) => result.status === 'updated');
  return json({ success, workbook: WORKBOOK_NAME, url: workbookUrl, sheets: results }, success ? 200 : 207, origin);
});
