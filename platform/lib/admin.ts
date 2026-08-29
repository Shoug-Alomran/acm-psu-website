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
  contributions: number;
  submissions: number;
  inquiries: number;
  positionApplications: number;
}

export async function overviewCounts(): Promise<Overview> {
  const client = requireClient();
  const [applications, contributions, submissions, inquiries, positionApplications] = await Promise.all([
    client.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    client.from('contributions').select('id', { count: 'exact', head: true }).eq('status', 'submitted').is('deleted_at', null),
    client.from('archive_submissions').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    client.from('inquiries').select('id', { count: 'exact', head: true }).in('status', ['new', 'in_progress']),
    client.from('event_position_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  return {
    applications: applications.count ?? 0,
    contributions: contributions.count ?? 0,
    submissions: submissions.count ?? 0,
    inquiries: inquiries.count ?? 0,
    positionApplications: positionApplications.count ?? 0,
  };
}

/* -------------------------------------------------------------- applications */

export async function applications(statuses: string[]): Promise<Application[]> {
  return unwrap(await requireClient().from('applications')
    .select('*').in('status', statuses).order('created_at')) ?? [];
}

export async function application(applicationId: string): Promise<Application | null> {
  return unwrap(await requireClient().from('applications')
    .select('*').eq('id', applicationId).maybeSingle());
}

export async function applicationNotes(applicationId: string): Promise<ApplicationNote[]> {
  return unwrap(await requireClient().from('application_notes')
    .select('*').eq('application_id', applicationId).order('created_at')) ?? [];
}

export async function addApplicationNote(
  applicationId: string, body: string, isInternal = true,
): Promise<void> {
  unwrap(await requireClient().from('application_notes').insert({
    application_id: applicationId,
    body,
    is_internal: isInternal,
  }).select('id'));
}

export async function decideApplication(
  applicationId: string, status: ReviewStatus, note: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('decide_application', {
    application_id: applicationId,
    new_status: status,
    note,
  });
  if (error) throw new Error(error.message);
}

/* ----------------------------------------------------------- member requests */

export async function memberRequests(statuses: string[]): Promise<MemberRequest[]> {
  return unwrap(await requireClient().from('member_requests')
    .select('*').in('status', statuses).order('created_at')) ?? [];
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

export async function decideEventRequest(
  requestId: string, approve: boolean, reason: string | null,
): Promise<void> {
  const client = requireClient();

  if (approve) {
    const { error } = await client
      .rpc('approve_event_position_application', { request_id: requestId, reason });
    if (error) throw new Error(error.message);
  } else {
    // Declining is recorded by the event_position_applications path in the
    // requests queue; the row trigger picks up the change.
    const { data } = await client.auth.getSession();
    const decidedBy = data.session?.user.id ?? null;

    unwrap(await client.from('event_position_applications').update({
      status: 'rejected',
      admin_note: reason,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
    }).eq('id', requestId).select('id'));
  }

  /*
   * Refresh the Position Applications worksheet after any decision.
   * Google Sheets failures are best-effort and do not affect the decision.
   */
  await bestEffortFunctionSync('position-application-sheet-sync');
}

export async function eventRequests(statuses: string[]) {
  return unwrap(await requireClient().from('event_position_applications')
    .select('*, member:app_users!event_position_applications_user_id_fkey(full_name, email), position:event_positions(title, project_id, openings)')
    .in('status', statuses).order('created_at')) ?? [];
}

/* -------------------------------------------------------- position requests */

export async function positionChangeRequests(statuses: string[]): Promise<PositionChangeRequest[]> {
  return unwrap(await requireClient().from('position_change_requests')
    .select('*').in('status', statuses).order('created_at')) ?? [];
}

export async function decidePositionChangeRequest(
  requestId: string, approve: boolean, reason: string | null,
): Promise<void> {
  const { error } = await requireClient().rpc('resolve_position_change_request', {
    request_id: requestId,
    approve,
    reason,
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------- members/admin */

export async function adminAssignments(): Promise<AdminAssignment[]> {
  return unwrap(await requireClient().from('admin_assignments')
    .select('*').order('created_at')) ?? [];
}

export async function grantAdminRole(
  userId: string, role: AdminRole, note: string | null = null,
): Promise<void> {
  const { error } = await requireClient().rpc('grant_admin_role', {
    target_user_id: userId,
    new_role: role,
    note,
  });
  if (error) throw new Error(error.message);
}

export async function revokeAdminRole(userId: string, note: string | null = null): Promise<void> {
  const { error } = await requireClient().rpc('revoke_admin_role', {
    target_user_id: userId,
    note,
  });
  if (error) throw new Error(error.message);
}

export async function updateMembership(
  userId: string, status: MembershipStatus, note: string | null = null,
): Promise<void> {
  const { error } = await requireClient().rpc('set_membership_status', {
    target_user_id: userId,
    new_status: status,
    note,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ projects */

export async function updateProjectVisibility(
  projectId: string, visibility: ContentVisibility,
): Promise<void> {
  unwrap(await requireClient().from('projects')
    .update({ visibility }).eq('id', projectId).select('id'));
}

/* --------------------------------------------------------------------- audit */

export async function auditEntries(limit = 100): Promise<AuditEntry[]> {
  return unwrap(await requireClient().from('audit_log')
    .select('*').order('created_at', { ascending: false }).limit(limit)) ?? [];
}

/* --------------------------------------------------------------- edge funcs */

export async function syncMemberSheet(): Promise<void> {
  await callFunction('member-sheet-sync');
}
