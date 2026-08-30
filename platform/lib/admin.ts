/**
 * Admin-side data access.
 *
 * Split from api.ts so the two audiences are legible apart: everything here
 * either reads a queue or calls an RPC that changes an official record. Each
 * of those RPCs re-checks the caller's role inside the database, so nothing in
 * this file is what grants permission.
 */
import { requireClient, callFunction } from './supabase.js';
import { unwrap, bestEffortFunctionSync } from './api.js';
import type {
  AdminAssignment, AdminRole, Application, ApplicationNote, AuditEntry,
  ContentVisibility, MembershipStatus, MemberRequest, PositionChangeRequest,
  ReviewStatus,
} from './types.js';

/* ------------------------------------------------------------------ counts */

export interface Overview {
  applications: number;
  members: number;
  positionRequests: number;
  contributions: number;
  submissions: number;
  memberRequests: number;
  eventRequests: number;
  activeProjects: number;
}

export async function overview(): Promise<Overview> {
  const client = requireClient();
  const head = { count: 'exact' as const, head: true };

  const [apps, members, posReq, contrib, subs, reqs, eventReqs, projects] = await Promise.all([
    client.from('applications').select('*', head).in('status', ['submitted', 'interview']),
    client.from('memberships').select('*', head).eq('status', 'active'),
    client.from('position_change_requests').select('*', head).eq('status', 'pending'),
    client.from('contributions').select('*', head).eq('status', 'submitted').is('deleted_at', null),
    client.from('archive_submissions').select('*', head).eq('status', 'submitted'),
    client.from('member_requests').select('*', head).eq('status', 'pending'),
    client.from('event_position_applications').select('*', head).eq('status', 'pending'),
    client.from('projects').select('*', head).in('status', ['planning', 'active']).is('deleted_at', null),
  ]);

  return {
    applications: apps.count ?? 0,
    members: members.count ?? 0,
    positionRequests: posReq.count ?? 0,
    contributions: contrib.count ?? 0,
    submissions: subs.count ?? 0,
    memberRequests: reqs.count ?? 0,
    eventRequests: eventReqs.count ?? 0,
    activeProjects: projects.count ?? 0,
  };
}

/* ------------------------------------------------------------ applications */

export type ApplicationRow = Application & {
  applicant: { full_name: string; email: string } | null;
};

export async function applications(statuses: string[]): Promise<ApplicationRow[]> {
  return unwrap(await requireClient().from('applications')
    .select('*, applicant:app_users!applications_user_id_fkey(full_name, email)')
    .in('status', statuses)
    .order('created_at')) ?? [];
}

export async function applicationNotes(applicationId: string): Promise<ApplicationNote[]> {
  return unwrap(await requireClient().from('application_notes').select('*')
    .eq('application_id', applicationId).order('created_at')) ?? [];
}

export async function addApplicationNote(applicationId: string, body: string): Promise<void> {
  const { error } = await requireClient().rpc('add_application_note', {
    application: applicationId, body,
  });
  if (error) throw new Error(error.message);
}

export async function markForInterview(
  applicationId: string, reason: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('mark_application_for_interview', {
    application: applicationId, reason,
  });
  if (error) throw new Error(error.message);
}

export async function approveApplication(
  applicationId: string, positionId: string | null, startDate: string,
  reason: string | null, internal: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('approve_application', {
    application: applicationId,
    position_id: positionId,
    start_date: startDate,
    reason,
    internal,
  });
  if (error) throw new Error(error.message);
  void refreshMembersSheet();
}

/** A reason is mandatory — the database refuses the call without one. */
export async function rejectApplication(
  applicationId: string, reason: string, internal: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('reject_application', {
    application: applicationId, reason, internal,
  });
  if (error) throw new Error(error.message);
}

/* ----------------------------------------------------------------- members */

async function refreshMembersSheet(): Promise<void> {
  const { error } = await requireClient().functions.invoke('club-records-sheet-sync', {
    body: { sheets: ['people', 'members'] },
  });
  if (error) console.error('Could not refresh the Members worksheet:', error);
}

export interface MemberRow {
  id: string;
  full_name: string;
  email: string;
  student_id: string | null;
  major: string | null;
  account_state: string;
  current_position: string | null;
  membership: {
    status: MembershipStatus; started_on: string | null; ended_on: string | null;
    member_no: string | null; chapter_year: string | null;
    internal_note: string | null
  } | null;
  profile: { visibility: string; academic_year: string | null } | null;
}

export async function members(search = '', status = ''): Promise<MemberRow[]> {
  const client = requireClient();

  let usersQuery = client
    .from('app_users')
    .select(`
      id,
      full_name,
      email,
      student_id,
      major,
      account_state
    `)
    .is('deleted_at', null)
    .order('full_name')
    .limit(500);

  if (search) {
    const term = search
      .replaceAll('%', '')
      .replaceAll(',', ' ');

    usersQuery = usersQuery.or(
      `full_name.ilike.%${term}%,email.ilike.%${term}%,student_id.ilike.%${term}%`
    );
  }

  const [
    usersResult,
    membershipsResult,
    profilesResult,
    positionsResult,
  ] = await Promise.all([
    usersQuery,

    client
      .from('memberships')
      .select(`
        user_id,
        status,
        started_on,
        ended_on,
        member_no,
        chapter_year,
        internal_note
      `),

    client
      .from('member_profiles')
      .select(`
        user_id,
        visibility,
        academic_year
      `),

    client
      .from('position_history')
      .select('user_id, title_snapshot, ended_on')
      .is('ended_on', null),
  ]);

  const users = unwrap(usersResult) ?? [];
  const membershipRows = unwrap(membershipsResult) ?? [];
  const profileRows = unwrap(profilesResult) ?? [];
  const positionRows = unwrap(positionsResult) ?? [];

  const membershipByUser = new Map(
    membershipRows.map((membership) => [
      membership.user_id,
      membership,
    ]),
  );

  const profileByUser = new Map(
    profileRows.map((profile) => [
      profile.user_id,
      profile,
    ]),
  );
  const positionByUser = new Map(
    positionRows.map((position) => [position.user_id, position.title_snapshot]),
  );

  const rows = users.map((user) => {
    const membership = membershipByUser.get(user.id) ?? null;
    const profile = profileByUser.get(user.id) ?? null;

    return {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      student_id: user.student_id,
      major: user.major,
      account_state: user.account_state,
      current_position: positionByUser.get(user.id) ?? null,

      membership: membership
        ? {
            status: membership.status as MembershipStatus,
            started_on: membership.started_on,
            ended_on: membership.ended_on,
            member_no: membership.member_no,
            chapter_year: membership.chapter_year,
            internal_note: membership.internal_note,
          }
        : null,

      profile: profile
        ? {
            visibility: profile.visibility,
            academic_year: profile.academic_year,
          }
        : null,
    } satisfies MemberRow;
  });

  if (!status) return rows;
  return rows.filter((member) => member.membership?.status === status);
}

/**
 * One RPC rather than an UPDATE followed by a separate audit call. The change
 * and its record are the same transaction: if the entry cannot be written, the
 * status does not change.
 */
export async function setMembershipStatus(
  userId: string, status: MembershipStatus, reason: string | null,
  internal: string | null = null, closePosition: boolean | null = null,
): Promise<void> {
  const { error } = await requireClient().rpc('set_membership_status', {
    target_user: userId, new_status: status, reason,
    internal, close_position: closePosition,
  });
  if (error) throw new Error(error.message);
  void bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['people', 'members'] });
  if (closePosition) {
    void bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['club_positions'] });
  }
}

export async function setAccountState(
  userId: string, state: 'active' | 'disabled', reason: string,
): Promise<void> {
  const { error } = await requireClient().rpc('set_account_state', {
    target_user: userId, new_state: state, reason,
  });
  if (error) throw new Error(error.message);
  void bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['people', 'members'] });
}

export async function grantPosition(
  userId: string, positionId: string, effectiveOn: string, reason: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('grant_position', {
    target_user: userId,
    new_position: positionId,
    effective_on: effectiveOn,
    fallback_title: null,
    reason,
  });
  if (error) throw new Error(error.message);
  void bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['people', 'club_positions'] });
}

/* --------------------------------------------------------------- decisions */

export async function verifyContribution(
  id: string, edits: {
    title?: string | null; type?: string | null; role?: string | null;
    description?: string | null; project?: string | null;
  }, reason: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('verify_contribution', {
    contribution_id: id,
    new_title: edits.title ?? null,
    new_type: edits.type ?? null,
    new_role: edits.role ?? null,
    new_description: edits.description ?? null,
    new_project: edits.project ?? null,
    reason,
  });
  if (error) throw new Error(error.message);
  void bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['contributions'] });
}

/** Both outcomes require a reason; the database enforces it. */
export async function decideContribution(
  id: string, decision: Extract<ReviewStatus, 'rejected' | 'changes_requested'>,
  reason: string, internal: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('decide_contribution', {
    contribution_id: id, decision, reason, internal,
  });
  if (error) throw new Error(error.message);
  void bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['contributions'] });
}

/**
 * Taking something off a member's permanent record. Among the most
 * consequential actions available, so the reason is mandatory.
 */
export async function revokeVerification(
  id: string, reason: string, internal: string | null = null,
): Promise<void> {
  const { error } = await requireClient().rpc('revoke_contribution_verification', {
    contribution_id: id, reason, internal,
  });
  if (error) throw new Error(error.message);
}

/**
 * Moves a submitted file out of the private `submissions` bucket and into the
 * bucket that matches the visibility it is being published with.
 */
async function relocateForPublishing(
  bucket: string, path: string, visibility: ContentVisibility,
): Promise<{ bucket: string; path: string }> {
  const target = visibility === 'public' ? 'public-archive' : 'internal-archive';
  if (bucket === target) return { bucket, path };

  const storage = requireClient().storage;
  const name = path.split('/').slice(1).join('/') || path;
  const destination = `${new Date().getFullYear()}/${name}`;

  const { error: copyError } = await storage.from(bucket)
    .copy(path, destination, { destinationBucket: target });

  if (copyError) {
    const { data: file, error: downloadError } = await storage.from(bucket).download(path);
    if (downloadError || !file) {
      throw new Error(`Could not move the file into the archive: ${copyError.message}`);
    }
    const { error: uploadError } = await storage.from(target)
      .upload(destination, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      throw new Error(`Could not write the file into ${target}: ${uploadError.message}`);
    }
  }

  await storage.from(bucket).remove([path]);
  return { bucket: target, path: destination };
}

export async function publishSubmission(id: string, final: {
  title?: string | null; category?: string | null; description?: string | null;
  folder?: string | null; project?: string | null;
  visibility?: ContentVisibility | null; section?: string | null; reason?: string | null;
  sourceBucket?: string | null; sourcePath?: string | null;
  aiAccepted?: string[] | null;
}): Promise<string> {
  let bucket: string | null = null;
  let path: string | null = null;

  if (final.sourceBucket && final.sourcePath) {
    const moved = await relocateForPublishing(
      final.sourceBucket, final.sourcePath, final.visibility ?? 'internal');
    bucket = moved.bucket;
    path = moved.path;
  }

  const { data, error } = await requireClient().rpc('publish_archive_submission', {
    submission_id: id,
    final_title: final.title ?? null,
    final_category: final.category ?? null,
    final_description: final.description ?? null,
    final_folder: final.folder ?? null,
    final_project: final.project ?? null,
    final_visibility: final.visibility ?? null,
    final_section: final.section ?? null,
    reason: final.reason ?? null,
    final_bucket: bucket,
    final_path: path,
    ai_accepted: final.aiAccepted ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function decideSubmission(
  id: string, decision: Extract<ReviewStatus, 'rejected' | 'changes_requested'>,
  reason: string, internal: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('decide_archive_submission', {
    submission_id: id, decision, reason, internal,
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------- published item lifecycle */

export async function setArchiveVisibility(
  itemId: string, visibility: ContentVisibility, reason: string,
  newBucket: string | null = null, newPath: string | null = null,
): Promise<void> {
  const { error } = await requireClient().rpc('set_archive_item_visibility', {
    item_id: itemId, new_visibility: visibility, reason,
    new_bucket: newBucket, new_path: newPath,
  });
  if (error) throw new Error(error.message);
}

export async function moveArchiveItem(
  itemId: string, folderId: string | null, projectId: string | null,
  section: string | null, reason: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('move_archive_item', {
    item_id: itemId, new_folder: folderId, new_project: projectId,
    new_section: section, reason,
  });
  if (error) throw new Error(error.message);
}

export async function deleteArchiveItem(itemId: string, reason: string): Promise<void> {
  const { error } = await requireClient().rpc('delete_archive_item', {
    item_id: itemId, reason,
  });
  if (error) throw new Error(error.message);
}

/** Asks Workers AI for review suggestions. Advisory only — it publishes nothing. */
export async function requestAiReview(submissionId: string): Promise<{
  suggestions: Record<string, unknown> | null;
  flags: Array<{ kind: string; severity: string; detail: string }>;
  error: string | null;
}> {
  const response = await callFunction('ai-review', { submission_id: submissionId });
  const payload = await response.json();
  if (!response.ok && !payload.suggestions) {
    throw new Error(payload.error ?? `AI review failed (${response.status}).`);
  }
  return payload;
}

/* ---------------------------------------------------------------- requests */

export type MemberRequestRow = MemberRequest & {
  member: { full_name: string; email: string } | null;
};

export async function memberRequests(statuses: string[]): Promise<MemberRequestRow[]> {
  return unwrap(await requireClient().from('member_requests')
    .select('*, member:app_users!member_requests_user_id_fkey(full_name, email)')
    .in('status', statuses).order('created_at')) ?? [];
}

export type PositionRequestRow = PositionChangeRequest & {
  member: { full_name: string; email: string } | null;
  requested: { title: string } | null;
};

export async function positionRequests(statuses: string[]): Promise<PositionRequestRow[]> {
  return unwrap(await requireClient().from('position_change_requests')
    .select('*, member:app_users!position_change_requests_user_id_fkey(full_name, email), requested:positions!position_change_requests_requested_position_id_fkey(title)')
    .in('status', statuses).order('created_at')) ?? [];
}

export async function resolveWithdrawal(
  requestId: string, finalStatus: MembershipStatus, closePosition: boolean, reason: string,
): Promise<void> {
  const { error } = await requireClient().rpc('resolve_withdrawal', {
    request_id: requestId, final_status: finalStatus,
    close_position: closePosition, reason,
  });
  if (error) throw new Error(error.message);
}

export async function resolveProfileRemoval(
  requestId: string, approve: boolean, reason: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('resolve_profile_removal', {
    request_id: requestId, approve, reason,
  });
  if (error) throw new Error(error.message);
}

export async function resolvePositionRequest(
  requestId: string, approve: boolean, positionId: string | null,
  effectiveOn: string, reason: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('resolve_position_request', {
    request_id: requestId, approve, position_id: positionId,
    effective_on: effectiveOn, reason,
  });
  if (error) throw new Error(error.message);
}

/** The request kinds with no side effects beyond being answered. */
export async function decideMemberRequest(
  requestId: string, approve: boolean, reason: string | null,
  internal: string | null = null,
): Promise<void> {
  const { error } = await requireClient().rpc('resolve_member_request', {
    request_id: requestId, approve, reason, internal,
  });
  if (error) throw new Error(error.message);
}

/**
 * Approve, reject or cancel one event-position request.
 *
 * Both branches are RPCs. Rejection used to be a direct table update, which
 * decided the request without releasing an assignment the member may already
 * hold — leaving the participation record saying "assigned" while the request
 * said "rejected". The RPC does the decision, the withdrawal and the audit
 * entry in one transaction.
 */
export async function decideEventRequest(
  requestId: string,
  approve: boolean,
  reason: string | null,
  cancel = false,
): Promise<void> {
  const client = requireClient();

  const { error } = approve
    ? await client.rpc('approve_event_position_application', {
      request_id: requestId, reason,
    })
    : await client.rpc('decide_event_position_application', {
      p_application_id: requestId,
      p_status: cancel ? 'cancelled' : 'rejected',
      p_reason: reason,
    });

  if (error) throw new Error(error.message);

  await bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['position_applications', 'event_participation'] });
}

export async function eventRequests(statuses: string[]) {
  return unwrap(await requireClient().from('event_position_applications')
    .select('*, member:app_users!event_position_applications_user_id_fkey(full_name, email), position:event_positions(title, project_id, openings)')
    .in('status', statuses).order('created_at')) ?? [];
}

/* -------------------------------------------------------------- admin team */

export type AdminRow = AdminAssignment & {
  member: { full_name: string; email: string } | null;
};

export async function adminTeam(includeRevoked = false): Promise<AdminRow[]> {
  let query = requireClient().from('admin_assignments')
    .select('*, member:app_users!admin_assignments_user_id_fkey(full_name, email)')
    .order('granted_at', { ascending: false });
  if (!includeRevoked) query = query.is('revoked_at', null);
  return unwrap(await query) ?? [];
}

export async function grantRole(
  userId: string, role: AdminRole, reason: string,
): Promise<void> {
  const { error } = await requireClient().rpc('grant_admin_role', {
    target_user: userId, new_role: role, reason,
  });
  if (error) throw new Error(error.message);
}

export async function revokeRole(assignmentId: string, reason: string): Promise<void> {
  const { error } = await requireClient().rpc('revoke_admin_role', {
    assignment_id: assignmentId, reason,
  });
  if (error) throw new Error(error.message);
}

export type AdminRevocationDisposition =
  | 'admin_only' | 'archive_public' | 'archive_private' | 'erase_personal_data';

export async function revokeAdminWithDisposition(
  assignmentId: string,
  disposition: AdminRevocationDisposition,
  reason: string,
): Promise<void> {
  const { error } = await requireClient().rpc('revoke_admin_with_disposition', {
    assignment_id: assignmentId,
    disposition,
    reason,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------- audit */

export async function auditLog(limit = 100): Promise<AuditEntry[]> {
  return unwrap(await requireClient().from('audit_log').select('*')
    .order('created_at', { ascending: false }).limit(limit)) ?? [];
}

/* ------------------------------------------------------------------ export */

export type Dataset = 'members' | 'participation' | 'contributions' | 'inquiries';
export type ExportFormat = 'csv' | 'xlsx';

export interface ClubRecordsSyncResult {
  success: boolean;
  workbook: string;
  url?: string;
  sheets: Record<string, { rows: number; status: 'updated' | 'failed'; error?: string }>;
}

export async function syncClubRecordsWorkbook(): Promise<ClubRecordsSyncResult> {
  const response = await callFunction('club-records-sheet-sync', { mode: 'full' });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok && response.status !== 207) throw new Error(payload.error ?? 'Workbook sync failed.');
  return payload as ClubRecordsSyncResult;
}

export async function runExport(
  dataset: Dataset, format: ExportFormat,
): Promise<{ url?: string; rows?: number; sheets?: Array<{ sheet: string; rows: number }> }> {
  const response = await callFunction('records-export', { dataset, format });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(payload.error ?? 'Export failed.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `acm-psu-${dataset}-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return {};
}

/**
 * One page of the export log, newest first, with the total row count so the
 * page can tell whether another page exists without fetching it.
 */
export async function exportHistory(
  limit = 25,
  offset = 0,
): Promise<{ rows: unknown[]; total: number }> {
  const result = await requireClient().from('university_exports')
    .select('*, admin:app_users!university_exports_generated_by_fkey(full_name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const rows = unwrap(result) ?? [];
  return { rows: rows as unknown[], total: result.count ?? rows.length };
}
