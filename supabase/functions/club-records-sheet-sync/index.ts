/** Canonical Supabase -> Google Sheets mirror for the private club workbook. */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { clientForRequest, corsHeaders, fail, json, requireRole } from '../_shared/http.ts';
import { pushToGoogleSheet, WORKBOOK_NAME, type RowTint } from '../_shared/google_sheets.ts';

type SheetKey = 'people' | 'membership_applications' | 'members' | 'club_positions' |
  'opportunity_positions' | 'position_applications' | 'event_participation' |
  'contributions' | 'inquiries' | 'university_export_log';
type Matrix = unknown[][];
type Row = Record<string, any>;

const ORDER: SheetKey[] = ['people', 'membership_applications', 'members', 'club_positions',
  'opportunity_positions', 'position_applications', 'event_participation', 'contributions',
  'inquiries', 'university_export_log'];
const NAMES: Record<SheetKey, string> = {
  people: 'People', membership_applications: 'Membership Applications',
  members: 'Members', club_positions: 'Club Positions',
  opportunity_positions: 'Opportunity Positions', position_applications: 'Position Applications',
  event_participation: 'Event Participation', contributions: 'Contributions', inquiries: 'Inquiries',
  university_export_log: 'University Export Log',
};

/**
 * Where each worksheet sits in the records browser's folder tree.
 *
 * Ten flat tabs made finding one a matter of reading every label. The grouping
 * is stated here, next to the collectors, so the page draws the workbook's
 * shape rather than inventing its own — and so a worksheet added later gets
 * filed by the same hand that writes it.
 */
const FOLDERS: Record<SheetKey, string[]> = {
  people: ['People'], members: ['People'], membership_applications: ['People'],
  opportunity_positions: ['Events'], position_applications: ['Events'],
  event_participation: ['Events'], contributions: ['Events'],
  club_positions: ['Admin'], inquiries: ['Admin'], university_export_log: ['Admin'],
};

/** The folder public event signups appear in, one worksheet per event. */
const REGISTRATION_FOLDER = ['Events', 'Registrations'];
const TIMESTAMP_HEADER = 'Timestamp';

type RegistrationForm = { event_key: string; label: string; headers: string[] };

/**
 * Public event registrations, one worksheet per event.
 *
 * These are not a mirror of anything in Supabase — they are collected by the
 * Apps Script registration workbook and copied here by
 * event-registration-intake. They appear in the website view only: pushing
 * them into the club records workbook would make this platform a second writer
 * of a spreadsheet Apps Script owns, which is how two copies start disagreeing.
 */
async function registrationSheets(
  client: SupabaseClient,
): Promise<Array<{ name: string; columns: unknown[]; rows: unknown[][] }>> {
  const { data: formData, error: formError } = await client
    .from('event_registration_forms')
    .select('event_key, label, headers').eq('is_active', true).order('rank');
  if (formError) throw new Error(`event_registration_forms: ${formError.message}`);
  const forms = (formData ?? []) as RegistrationForm[];
  if (!forms.length) return [];

  const registrations = await rows(client, 'event_registrations');
  return forms.map((form) => {
    // 'Registered At' replaces the worksheet's own Timestamp column: the
    // mirror stores it as a real timestamp, which is what dates the row by
    // semester here.
    const headings = form.headers.filter((header) => header !== TIMESTAMP_HEADER);
    const mine = registrations
      .filter((row) => row.event_key === form.event_key)
      .sort((a, b) => String(b.registered_at).localeCompare(String(a.registered_at)));
    return {
      name: form.label,
      columns: ['Registered At', ...headings, 'Source'],
      rows: mine.map((row) => [
        row.registered_at,
        ...headings.map((header) => (row.fields ?? {})[header] ?? ''),
        row.source === 'sheet_import' ? 'Imported from sheet' : 'Live registration',
      ]),
    };
  });
}

async function rows(client: SupabaseClient, table: string, columns = '*'): Promise<Row[]> {
  const { data, error } = await client.from(table).select(columns);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as Row[];
}
const byId = (items: Row[]) => new Map(items.map((item) => [item.id, item]));
const byUser = (items: Row[]) => new Map(items.map((item) => [item.user_id, item]));
const join = (values: Array<string | null | undefined>) => [...new Set(values.filter(Boolean))].join(' · ');

const PSU_TERMS = [
  ['251', 'First Semester 2025–2026', '2025-08-17', '2025-12-20'],
  ['252', 'Second Semester 2025–2026', '2025-12-21', '2026-06-06'],
  ['253', 'Summer Semester 2025–2026', '2026-06-07', '2026-08-08'],
  ['261', 'First Semester 2026–2027', '2026-08-09', '2026-12-12'],
  ['262', 'Second Semester 2026–2027', '2026-12-13', '2027-05-29'],
  ['263', 'Summer Semester 2026–2027', '2027-05-30', '2027-08-21'],
  ['271', 'First Semester 2027–2028', '2027-08-22', '2027-12-25'],
  ['272', 'Second Semester 2027–2028', '2027-12-26', '2028-06-17'],
  ['273', 'Summer Semester 2027–2028', '2028-06-18', '2028-08-19'],
  ['281', 'First Semester 2028–2029', '2028-08-20', '2028-12-23'],
  ['282', 'Second Semester 2028–2029', '2028-12-24', '2029-06-16'],
  ['283', 'Summer Semester 2028–2029', '2029-06-17', '2029-08-16'],
] as const;
const PSU_ACADEMIC_CALENDAR = 'https://psu.edu.sa/en/academiccalendar';

function registrationSemester(value: unknown): string {
  const date = String(value ?? '').slice(0, 10);
  const term = PSU_TERMS.find((entry) => entry[2] <= date && date <= entry[3]);
  return term ? `${term[0]} — ${term[1]}` : '';
}

async function core(client: SupabaseClient) {
  const [users, profiles, memberships, history, positions, admins, organizers, projects] = await Promise.all([
    rows(client, 'app_users'), rows(client, 'member_profiles'), rows(client, 'memberships'),
    rows(client, 'position_history'), rows(client, 'positions'), rows(client, 'admin_assignments'),
    rows(client, 'project_organizers'), rows(client, 'projects'),
  ]);
  const liveUsers = users.filter((u) => !u.deleted_at);
  return {
    users: liveUsers, userMap: byId(liveUsers), profiles: byUser(profiles),
    memberships: byUser(memberships), history, positions, positionMap: byId(positions),
    admins: admins.filter((a) => !a.revoked_at), organizers, projectMap: byId(projects)
  };
}

async function people(client: SupabaseClient): Promise<Matrix> {
  const [c, applications] = await Promise.all([core(client), rows(client, 'applications')]);
  const current = new Map(c.history.filter((h) => !h.ended_on).map((h) => [h.user_id, h]));
  const registered = new Map<string, string>();
  for (const application of applications.sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)))) {
    if (!registered.has(application.user_id)) registered.set(application.user_id, application.created_at);
  }
  return [['Name', 'PSU Email', 'Person Type', 'University Role', 'ACM Role', 'Project Roles',
    'Registration Date', 'Registration Semester', 'Account State', 'Admin/System Roles',
    'Student ID', 'Major', 'Academic Year', 'Membership Status'],
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
    const registrationDate = registered.get(u.id) ?? u.created_at ?? membership?.started_on ?? '';
    return [u.full_name, u.email, personType, u.university_role, acmRole, join(projectRoles),
      registrationDate, registrationSemester(registrationDate), u.account_state, join(systemRoles),
    student ? u.student_id ?? '' : '',
    student ? u.major ?? '' : '', student ? c.profiles.get(u.id)?.academic_year ?? '' : '',
    student ? membership?.status ?? '' : ''];
  })];
}

/**
 * Membership applications — the club's intake record.
 *
 * Distinct from 'Position Applications', which mirrors applications for a role
 * on an event. This is the request to join the club itself, and until now it
 * was the one intake record with no mirror in the workbook.
 *
 * application_notes is deliberately not joined in: those interview notes are
 * kept out of the applications table on purpose (migration 0004).
 */
async function membershipApplications(client: SupabaseClient): Promise<Matrix> {
  const [apps, users, positions] = await Promise.all([
    rows(client, 'applications'), rows(client, 'app_users'), rows(client, 'positions'),
  ]);
  const um = byId(users), pm = byId(positions);
  return [['Application ID', 'Applicant Name', 'Student ID', 'PSU Email', 'Major', 'Academic Year',
    'Interests', 'Goal', 'Status', 'Chapter Year', 'Reviewed By', 'Reviewed At', 'Decision Note',
    'Internal Note', 'Approved Position', 'Membership Start Date', 'Registration Date',
    'Registration Semester', 'Academic Calendar', 'Updated At'],
  ...apps.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((a) => [
    a.id, a.full_name, a.student_id, a.psu_email, a.major, a.academic_year,
    join(a.interests ?? []), a.goal_text ?? '', a.status, a.chapter_year,
    um.get(a.reviewed_by)?.full_name ?? '', a.reviewed_at ?? '', a.decision_note ?? '',
    a.internal_note ?? '', pm.get(a.approved_position_id)?.title ?? '',
    a.membership_start_date ?? '', a.created_at, registrationSemester(a.created_at),
    PSU_ACADEMIC_CALENDAR, a.updated_at])];
}

async function members(client: SupabaseClient): Promise<Matrix> {
  const [c, applications] = await Promise.all([core(client), rows(client, 'applications')]);
  const current = new Map(c.history.filter((h) => !h.ended_on).map((h) => [h.user_id, h.title_snapshot]));
  const registered = new Map<string, string>();
  for (const application of applications.sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)))) {
    // The first application is when this person originally entered the club's
    // intake process; a later re-application must not rewrite their join term.
    if (!registered.has(application.user_id)) registered.set(application.user_id, application.created_at);
  }
  return [['Name', 'PSU Email', 'Student ID', 'Major', 'Academic Year', 'Membership Status',
    'Registration Date', 'Registration Semester', 'Membership Start', 'Membership End', 'Member Number',
    'Chapter Year', 'Club Position', 'Account State'],
  ...c.users.filter((u) => u.university_role === 'student' && c.memberships.has(u.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name)).map((u) => {
      const m = c.memberships.get(u.id)!;
      // Imported members may predate the application workflow. Their account
      // creation date is the most faithful registration timestamp available.
      const registrationDate = registered.get(u.id) ?? u.created_at ?? m.started_on ?? '';
      return [u.full_name, u.email, u.student_id ?? '', u.major ?? '',
      c.profiles.get(u.id)?.academic_year ?? '', m.status, registrationDate,
      registrationSemester(registrationDate), m.started_on ?? '', m.ended_on ?? '',
      m.member_no ?? '', m.chapter_year ?? '', current.get(u.id) ?? '', u.account_state];
    })];
}

async function clubPositions(client: SupabaseClient): Promise<Matrix> {
  const c = await core(client); const out: unknown[][] = [];
  for (const p of c.positions.sort((a, b) => a.rank - b.rank)) {
    const assignments = c.history.filter((h) => h.position_id === p.id);
    if (!assignments.length) out.push([p.id, p.slug, p.title, p.category, p.rank, p.is_active, '', '', '', '', '', '', '']);
    for (const h of assignments) {
      const u = c.userMap.get(h.user_id); out.push([p.id, p.slug, p.title,
      p.category, p.rank, p.is_active, u?.full_name ?? '', u?.email ?? '', u?.university_role ?? '',
      h.started_on, h.ended_on ?? '', h.chapter_year ?? '', h.ended_on ? 'Past' : 'Current']);
    }
  }
  for (const h of c.history.filter((h) => !h.position_id)) {
    const u = c.userMap.get(h.user_id);
    out.push(['', '', h.title_snapshot, 'custom', '', false, u?.full_name ?? '', u?.email ?? '',
      u?.university_role ?? '', h.started_on, h.ended_on ?? '', h.chapter_year ?? '', h.ended_on ? 'Past' : 'Current']);
  }
  return [['Position ID', 'Slug', 'Position Name', 'Category', 'Rank', 'Active', 'Holder Name',
    'Holder Email', 'University Role', 'Assignment Start', 'Assignment End', 'Chapter Year', 'Assignment Status'], ...out];
}

async function opportunityPositions(client: SupabaseClient): Promise<Matrix> {
  const [positions, projects, applications] = await Promise.all([rows(client, 'event_positions'), rows(client, 'projects'), rows(client, 'event_position_applications')]);
  const pm = byId(projects); return [['Opportunity ID', 'Project', 'Project Kind', 'Project Status', 'Position',
    'Description', 'Openings', 'Approved', 'Pending', 'Remaining', 'Open', 'Closes On', 'Created At'],
  ...positions.map((p) => {
    const apps = applications.filter((a) => a.event_position_id === p.id);
    const approved = apps.filter((a) => a.status === 'approved').length; const pending = apps.filter((a) => a.status === 'pending').length;
    const project = pm.get(p.project_id); return [p.id, project?.title ?? '', project?.kind ?? '', project?.status ?? '',
    p.title, p.description ?? '', p.openings, approved, pending, Math.max(p.openings - approved, 0), p.is_open, p.closes_on ?? '', p.created_at];
  })];
}

async function positionApplications(client: SupabaseClient): Promise<Matrix> {
  const [apps, users, positions, projects] = await Promise.all([rows(client, 'event_position_applications'), rows(client, 'app_users'), rows(client, 'event_positions'), rows(client, 'projects')]);
  const um = byId(users), pm = byId(positions), projectsMap = byId(projects);
  return [['Application ID', 'Applicant Name', 'Email', 'University Role', 'Project', 'Position', 'Availability',
    'Note', 'Status', 'Admin Note', 'Decided By', 'Decided At', 'Applied At'], ...apps.map((a) => {
      const u = um.get(a.user_id), p = pm.get(a.event_position_id); return [a.id, u?.full_name ?? '', u?.email ?? '',
      u?.university_role ?? '', projectsMap.get(p?.project_id)?.title ?? '', p?.title ?? '', a.availability ?? '',
      a.note ?? '', a.status, a.admin_note ?? '', um.get(a.decided_by)?.full_name ?? '', a.decided_at ?? '', a.created_at];
    })];
}

async function participation(client: SupabaseClient): Promise<Matrix> {
  const [items, users, projects, positions] = await Promise.all([rows(client, 'participations'), rows(client, 'app_users'), rows(client, 'projects'), rows(client, 'event_positions')]);
  const um = byId(users), pm = byId(projects), epm = byId(positions);
  return [['Participation ID', 'Person Name', 'Email', 'University Role', 'Project', 'Project Kind',
    'Opportunity Position', 'Role', 'Status', 'Started', 'Ended', 'Verified At', 'Verified By', 'Updated At'],
  ...items.map((i) => {
    const u = um.get(i.user_id), p = pm.get(i.project_id); return [i.id, u?.full_name ?? '',
    u?.email ?? '', u?.university_role ?? '', p?.title ?? '', p?.kind ?? '', epm.get(i.event_position_id)?.title ?? '',
    i.role_text, i.status, i.started_on ?? '', i.ended_on ?? '', i.verified_at ?? '', um.get(i.verified_by)?.full_name ?? '', i.updated_at];
  })];
}

async function contributions(client: SupabaseClient): Promise<Matrix> {
  const [items, users, projects, types] = await Promise.all([rows(client, 'contributions'), rows(client, 'app_users'), rows(client, 'projects'), rows(client, 'contribution_types')]);
  const um = byId(users), pm = byId(projects), tm = new Map(types.map((t) => [t.slug, t.label]));
  return [['Contribution ID', 'Person Name', 'Email', 'University Role', 'Project', 'Title', 'Type', 'Role',
    'Description', 'Occurred On', 'Status', 'Verified At', 'Reviewed By', 'Review Note', 'Created At'],
  ...items.filter((i) => !i.deleted_at).map((i) => {
    const u = um.get(i.user_id); return [i.id, u?.full_name ?? '',
    u?.email ?? '', u?.university_role ?? '', pm.get(i.project_id)?.title ?? '', i.title, tm.get(i.type_slug) ?? i.type_slug,
    i.role_text ?? '', i.description ?? '', i.occurred_on ?? '', i.status, i.verified_at ?? '',
    um.get(i.reviewed_by)?.full_name ?? '', i.review_note ?? '', i.created_at];
  })];
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

/**
 * Applications an admin still has to act on. 'submitted' means nobody has
 * contacted this person yet; 'interview' means they are part-way through.
 * The same two states are coloured on the website fallback, so the workbook
 * and the site agree about what is outstanding.
 */
const APPLICATION_TINTS: Record<string, RowTint> = {
  submitted: 'new',
  interview: 'interview',
};

function tintsFor(key: SheetKey, matrix: Matrix): Array<RowTint | null> {
  if (key !== 'membership_applications') return [];
  const status = (matrix[0] ?? []).indexOf('Status');
  if (status < 0) return [];
  return matrix.slice(1).map((row) => APPLICATION_TINTS[String(row[status])] ?? null);
}

const COLLECT: Record<SheetKey, (client: SupabaseClient) => Promise<Matrix>> = {
  people, membership_applications: membershipApplications, members,
  club_positions: clubPositions, opportunity_positions: opportunityPositions,
  position_applications: positionApplications, event_participation: participation,
  contributions, inquiries, university_export_log: exportLog,
};

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return fail('POST only', 405, origin);
  const caller = clientForRequest(req); if (!caller) return fail('Sign in required.', 401, origin);
  const { data: auth } = await caller.auth.getUser(); if (!auth.user) return fail('Sign in required.', 401, origin);

  let body: { mode?: string; sheets?: SheetKey[] } = {}; try { body = await req.json(); } catch { /* defaults */ }
  const applicationSubmitted = body.mode === 'application_submitted';

  // A newly submitted applicant may request only the canonical membership-
  // applications refresh. RLS proves that the caller owns a currently
  // submitted application; they cannot choose another worksheet or supply
  // any sheet data. Every other operation remains staff-only.
  const synchronizer = await requireRole(caller, ['super_admin', 'club_admin', 'advisory_instructor']);
  if (!synchronizer && applicationSubmitted) {
    const { data: ownApplication } = await caller.from('applications').select('id')
      .eq('user_id', auth.user.id).eq('status', 'submitted').limit(1).maybeSingle();
    if (!ownApplication) return fail('A submitted membership application is required.', 403, origin);
  } else if (!synchronizer) {
    return fail('Club admin or advisory instructor access required.', 403, origin);
  }

  const website = body.mode === 'website';
  const full = body.mode === 'full';
  let requested = applicationSubmitted ? ['people', 'membership_applications'] as SheetKey[]
    : (full || website) ? ORDER : (body.sheets ?? []);
  requested = [...new Set(requested)].filter((key): key is SheetKey => ORDER.includes(key));
  if (!requested.length) return fail('No supported worksheets requested.', 400, origin);
  if (!full && !website && requested.length > 2) return fail('Targeted refreshes may update at most two worksheets.', 400, origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl) return fail('Edge Function configuration error: SUPABASE_URL is unavailable.', 500, origin);
  if (!serviceRoleKey) return fail('Edge Function configuration error: SUPABASE_SERVICE_ROLE_KEY is unavailable.', 500, origin);

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The website view is the independent fallback for the Google workbook. It
  // uses the exact same collectors and headings, but returns the current data
  // directly from Supabase without touching Google or consulting the Google
  // Sheets feature flag. The browser never receives service credentials.
  if (website) {
    const sheets: Record<string, { columns: unknown[]; rows: unknown[][]; folder: string[] }> = {};
    for (const key of requested) {
      const matrix = await COLLECT[key](service);
      sheets[NAMES[key]] = {
        columns: matrix[0] ?? [],
        rows: matrix.slice(1),
        folder: FOLDERS[key],
      };
    }

    // Registrations are additional to the ten canonical worksheets, so a
    // failure to read them must not take the whole backup down with it — the
    // page reports the gap and still shows everything else.
    let registrationError: string | undefined;
    try {
      for (const sheet of await registrationSheets(service)) {
        // A collision with a canonical worksheet name would silently replace
        // it. Keep both, and say which one this is.
        const name = sheets[sheet.name] ? `${sheet.name} (registrations)` : sheet.name;
        sheets[name] = { columns: sheet.columns, rows: sheet.rows, folder: REGISTRATION_FOLDER };
      }
    } catch (error) {
      registrationError = error instanceof Error ? error.message : String(error);
    }

    return json({
      source: 'supabase', generated_at: new Date().toISOString(), sheets,
      ...(registrationError ? { registration_error: registrationError } : {}),
    }, 200, origin);
  }

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
      workbookUrl = await pushToGoogleSheet(NAMES[key], matrix, tintsFor(key, matrix));
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
