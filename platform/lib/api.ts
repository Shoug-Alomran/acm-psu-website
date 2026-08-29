/**
 * Data access.
 *
 * Every query the portal makes goes through here, so the set of things the
 * browser asks the database for is readable in one file. None of these
 * functions grant anything: row level security decides what comes back.
 */
import { requireClient, readableError } from './supabase.js';
import type {
  Application, ArchiveCategory, ArchiveFolder, ArchiveItem, ArchiveSubmission,
  ArchiveSubmissionAi, ContentVisibility, Contribution, ContributionType,
  EventPositionAvailability, MemberProfile, MemberRequest, MemberRequestKind,
  MemberStats, Position, PositionChangeRequest, PositionHistoryRow, Project,
  ReviewStatus,
} from './types.js';

/** Throws a readable Error when PostgREST reports a failure. */
function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw new Error(readableError(result.error));
  return result.data as T;
}

/* ----------------------------------------------------------------- settings */

let settingsCache: Map<string, unknown> | null = null;

export async function settings(): Promise<Map<string, unknown>> {
  if (settingsCache) return settingsCache;
  const { data } = await requireClient().from('app_settings').select('key, value');
  settingsCache = new Map((data ?? []).map((r) => [r.key as string, r.value]));
  return settingsCache;
}

export async function setting<T>(key: string, fallback: T): Promise<T> {
  const value = (await settings()).get(key);
  return value === undefined ? fallback : (value as T);
}

/**
 * Settings go through an RPC so the change and its audit entry are one
 * transaction. Some keys — the feature switches and the accepted PSU email
 * domains — require a reason; the database enforces which.
 */
export async function saveSetting(
  key: string, value: unknown, reason: string | null = null,
): Promise<void> {
  const { error } = await requireClient().rpc('save_setting', {
    setting_key: key, new_value: value, reason,
  });
  if (error) throw new Error(error.message);
  settingsCache = null;
}

/* ------------------------------------------------------------- reference data */

export async function positions(includeArchived = false): Promise<Position[]> {
  let query = requireClient().from('positions').select('*').order('rank');
  if (!includeArchived) query = query.eq('is_active', true);
  return unwrap(await query) ?? [];
}

export async function contributionTypes(): Promise<ContributionType[]> {
  return unwrap(await requireClient().from('contribution_types')
    .select('*').eq('is_active', true).order('rank')) ?? [];
}

export async function archiveCategories(): Promise<ArchiveCategory[]> {
  return unwrap(await requireClient().from('archive_categories')
    .select('*').eq('is_active', true).order('rank')) ?? [];
}

export async function projects(): Promise<Project[]> {
  return unwrap(await requireClient().from('projects').select('*')
    .is('deleted_at', null).order('sort_index').order('starts_on', { ascending: false })) ?? [];
}

/* -------------------------------------------------------------- application */

export async function myApplication(userId: string): Promise<Application | null> {
  const { data } = await requireClient().from('applications').select('*')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data as Application | null;
}

export async function submitApplication(input: {
  user_id: string; full_name: string; student_id: string; psu_email: string;
  major: string; academic_year: string; interests: string[]; goal_text: string | null;
}): Promise<Application> {
  return unwrap(await requireClient().from('applications')
    .insert(input).select('*').single());
}

/* ------------------------------------------------------------------ profile */

export async function saveProfile(
  userId: string, patch: Partial<MemberProfile>,
): Promise<MemberProfile> {
  return unwrap(await requireClient().from('member_profiles')
    .update(patch).eq('user_id', userId).select('*').single());
}

export async function saveName(userId: string, fullName: string): Promise<void> {
  unwrap(await requireClient().from('app_users')
    .update({ full_name: fullName }).eq('id', userId).select('id'));
}

export async function memberStats(userId: string): Promise<MemberStats> {
  const { data } = await requireClient().from('member_stats').select('*')
    .eq('user_id', userId).maybeSingle();
  return (data as MemberStats | null) ?? {
    user_id: userId, events_count: 0, projects_count: 0, workshops_count: 0,
    verified_contributions: 0, submissions_count: 0, positions_held: 0,
  };
}

export async function positionHistory(userId: string): Promise<PositionHistoryRow[]> {
  return unwrap(await requireClient().from('position_history').select('*')
    .eq('user_id', userId).order('started_on', { ascending: false })) ?? [];
}

/* ------------------------------------------------------------ contributions */

export async function myContributions(userId: string): Promise<Contribution[]> {
  return unwrap(await requireClient().from('contributions').select('*')
    .eq('user_id', userId).is('deleted_at', null)
    .order('created_at', { ascending: false })) ?? [];
}

export async function saveContribution(
  input: Partial<Contribution> & { user_id: string; title: string; type_slug: string },
): Promise<Contribution> {
  const client = requireClient();
  if (input.id) {
    const { id, ...patch } = input;
    return unwrap(await client.from('contributions')
      .update(patch).eq('id', id).select('*').single());
  }
  return unwrap(await client.from('contributions').insert(input).select('*').single());
}

export async function reviewQueue(statuses: ReviewStatus[] = ['submitted']): Promise<
  Array<Contribution & { member: { full_name: string; email: string } | null;
                        project: { title: string } | null }>
> {
  return unwrap(await requireClient().from('contributions')
    .select('*, member:app_users!contributions_user_id_fkey(full_name, email), project:projects(title)')
    .in('status', statuses).is('deleted_at', null)
    .order('created_at')) ?? [];
}

/* ------------------------------------------------------------------ archive */

export async function archiveFolders(projectId?: string): Promise<ArchiveFolder[]> {
  let query = requireClient().from('archive_folders').select('*')
    .is('deleted_at', null).order('sort_index').order('name');
  if (projectId) query = query.eq('project_id', projectId);
  return unwrap(await query) ?? [];
}

export async function archiveItems(options: {
  projectId?: string; folderId?: string | null; search?: string; featured?: boolean;
} = {}): Promise<ArchiveItem[]> {
  let query = requireClient().from('archive_items').select('*').is('deleted_at', null);

  if (options.projectId) query = query.eq('project_id', options.projectId);
  if (options.folderId !== undefined) {
    query = options.folderId === null
      ? query.is('folder_id', null)
      : query.eq('folder_id', options.folderId);
  }
  if (options.featured) query = query.eq('is_featured', true);
  if (options.search) {
    const term = options.search.replaceAll('%', '').replaceAll(',', ' ');
    query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
  }
  return unwrap(await query.order('sort_index').order('name').limit(500)) ?? [];
}

export async function mySubmissions(userId: string): Promise<ArchiveSubmission[]> {
  return unwrap(await requireClient().from('archive_submissions').select('*')
    .eq('submitted_by', userId).order('created_at', { ascending: false })) ?? [];
}

export async function submissionQueue(statuses: ReviewStatus[] = ['submitted']): Promise<
  Array<ArchiveSubmission & { member: { full_name: string; email: string } | null;
                              project: { id: string; title: string } | null }>
> {
  return unwrap(await requireClient().from('archive_submissions')
    .select('*, member:app_users!archive_submissions_submitted_by_fkey(full_name, email), project:projects(id, title)')
    .in('status', statuses).order('created_at')) ?? [];
}

export async function submissionAi(submissionId: string): Promise<ArchiveSubmissionAi | null> {
  const { data } = await requireClient().from('archive_submission_ai').select('*')
    .eq('submission_id', submissionId).maybeSingle();
  return data as ArchiveSubmissionAi | null;
}

/* ------------------------------------------------------------ opportunities */

export async function openOpportunities(): Promise<
  Array<EventPositionAvailability & { project: Project | null }>
> {
  return unwrap(await requireClient().from('event_position_availability')
    .select('*, project:projects(*)').eq('is_open', true).order('title')) ?? [];
}

export async function myEventApplications(userId: string) {
  return unwrap(await requireClient().from('event_position_applications')
    .select('*, position:event_positions(title, project_id)')
    .eq('user_id', userId).order('created_at', { ascending: false })) ?? [];
}

export async function registerInterest(input: {
  event_position_id: string; user_id: string; availability: string | null; note: string | null;
}): Promise<void> {
  unwrap(await requireClient().from('event_position_applications')
    .insert(input).select('id').single());
}

/* ----------------------------------------------------------------- requests */

export async function myRequests(userId: string): Promise<MemberRequest[]> {
  return unwrap(await requireClient().from('member_requests').select('*')
    .eq('user_id', userId).order('created_at', { ascending: false })) ?? [];
}

export async function createRequest(input: {
  user_id: string; kind: MemberRequestKind; message: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  unwrap(await requireClient().from('member_requests')
    .insert({ ...input, payload: input.payload ?? {} }).select('id').single());
}

export async function cancelRequest(id: string): Promise<void> {
  unwrap(await requireClient().from('member_requests')
    .update({ status: 'cancelled' }).eq('id', id).select('id'));
}

export async function myPositionRequest(userId: string): Promise<PositionChangeRequest | null> {
  const { data } = await requireClient().from('position_change_requests').select('*')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data as PositionChangeRequest | null;
}

export async function requestPositionChange(input: {
  user_id: string; requested_position_id: string | null;
  requested_title: string | null; reason: string | null;
}): Promise<void> {
  unwrap(await requireClient().from('position_change_requests')
    .insert(input).select('id').single());
}

/* -------------------------------------------------------------------- files */

const SAFE_NAME = /[^a-zA-Z0-9._-]+/g;

export interface UploadResult {
  bucket: string; path: string; fileName: string; mimeType: string; size: number;
}

/**
 * Uploads into the caller's own folder in a private bucket.
 *
 * The path always begins with the user's id, which is what the storage policy
 * checks, so a member cannot write anywhere but their own folder even by
 * crafting a path here.
 */
export async function uploadPrivate(
  bucket: 'submissions' | 'evidence', userId: string, file: File,
): Promise<UploadResult> {
  const maxBytes = await setting<number>('max_upload_bytes', 26_214_400);
  if (file.size > maxBytes) {
    throw new Error(`That file is ${Math.round(file.size / 1_048_576)} MB. ` +
      `The limit is ${Math.round(maxBytes / 1_048_576)} MB.`);
  }
  if (file.size === 0) throw new Error('That file is empty.');

  const clean = file.name.replace(SAFE_NAME, '-').slice(-80);
  const path = `${userId}/${crypto.randomUUID()}-${clean}`;

  const { error } = await requireClient().storage.from(bucket)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });

  if (error) {
    // The bucket's allowed_mime_types list is the authority; translate its
    // error into something the member can act on.
    if (/mime type|not supported/i.test(error.message)) {
      throw new Error(`Files of type "${file.type || 'unknown'}" are not accepted. ` +
        'Use PDF, DOCX, PPTX, XLSX, an image, or a ZIP.');
    }
    throw new Error(readableError(error));
  }

  return { bucket, path, fileName: file.name, mimeType: file.type, size: file.size };
}

/**
 * A short-lived link to a private file. Private buckets are not public, so
 * this is the only way to read one and the link expires on its own.
 */
export async function signedUrl(
  bucket: string, path: string, seconds = 300,
): Promise<string | null> {
  const { data, error } = await requireClient().storage.from(bucket)
    .createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}

/** Resolves any archive item to something a browser can open. */
export async function itemUrl(item: ArchiveItem): Promise<string | null> {
  if (item.external_url) return item.external_url;
  if (item.site_path) return item.site_path;
  if (!item.storage_path || !item.storage_bucket) return null;
  if (item.storage_bucket === 'public-archive') {
    const { data } = requireClient().storage.from(item.storage_bucket)
      .getPublicUrl(item.storage_path);
    return data.publicUrl;
  }
  return signedUrl(item.storage_bucket, item.storage_path);
}

/* -------------------------------------------------------------------- audit */

export async function audit(limit = 50, action?: string) {
  let query = requireClient().from('audit_log').select('*')
    .order('created_at', { ascending: false }).limit(limit);
  if (action) query = query.like('action', `${action}%`);
  return unwrap(await query) ?? [];
}

export { unwrap, type ContentVisibility };
