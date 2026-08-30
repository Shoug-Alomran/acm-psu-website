/**
 * Domain types.
 *
 * Hand-written to mirror supabase/migrations/. Once the project exists, the
 * generated types can replace this file with:
 *
 *     npm run types:pull
 *
 * Keeping a hand-written copy means the portal type-checks before anyone has
 * provisioned a database, and it documents the shape in one readable place.
 */

export type MembershipStatus =
  | 'applicant' | 'active' | 'alumni' | 'withdrawn' | 'inactive' | 'rejected';

export type AccountState = 'active' | 'disabled';

export type UniversityRole = 'student' | 'instructor' | 'staff' | 'alumni' | 'other';

export type ApplicationStatus =
  | 'submitted' | 'interview' | 'approved' | 'rejected' | 'withdrawn';

export type ReviewStatus =
  | 'draft' | 'submitted' | 'changes_requested' | 'approved' | 'rejected';

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type AdminRole =
  | 'super_admin' | 'club_admin' | 'reviewer' | 'advisory_instructor';

export type ProfileVisibility = 'public' | 'private';

export type ContentVisibility = 'public' | 'internal';

export type ProjectKind = 'event' | 'project' | 'workshop_series' | 'initiative';

export type ProjectStatus = 'planning' | 'active' | 'completed' | 'archived';

export type ParticipationStatus =
  | 'registered' | 'confirmed' | 'completed' | 'withdrawn' | 'no_show';

export type MemberRequestKind =
  | 'withdrawal' | 'profile_removal' | 'account_deletion' | 'data_export' | 'other';

export type ArchiveItemKind = 'file' | 'link' | 'embed';

export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  student_id: string | null;
  major: string | null;
  university_role: UniversityRole;
  account_state: AccountState;
  created_at: string;
  deleted_at: string | null;
}

export interface MemberProfile {
  user_id: string;
  bio: string;
  academic_year: string | null;
  interests: string[];
  linkedin_url: string | null;
  github_url: string | null;
  website_url: string | null;
  extra_links: Array<{ label: string; url: string }>;
  avatar_path: string | null;
  visibility: ProfileVisibility;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  user_id: string;
  status: MembershipStatus;
  started_on: string | null;
  ended_on: string | null;
  member_no: string | null;
  chapter_year: string | null;
  approved_at: string | null;
  internal_note: string | null;
}

export interface Position {
  id: string;
  slug: string;
  title: string;
  title_ar: string | null;
  description: string | null;
  category: string;
  rank: number;
  /** Maximum simultaneous holders; null means unlimited. */
  max_holders: number | null;
  is_active: boolean;
  archived_at: string | null;
}

export interface PositionHistoryRow {
  id: string;
  user_id: string;
  position_id: string | null;
  title_snapshot: string;
  started_on: string;
  ended_on: string | null;
  chapter_year: string | null;
  note: string | null;
}

export interface PositionChangeRequest {
  id: string;
  user_id: string;
  requested_position_id: string | null;
  requested_title: string | null;
  reason: string | null;
  status: RequestStatus;
  approved_position_id: string | null;
  effective_date: string | null;
  admin_note: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface Application {
  id: string;
  user_id: string;
  full_name: string;
  student_id: string;
  psu_email: string;
  major: string;
  academic_year: string;
  interests: string[];
  goal_text: string | null;
  status: ApplicationStatus;
  chapter_year: string;
  decision_note: string | null;
  internal_note: string | null;
  approved_position_id: string | null;
  membership_start_date: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface ApplicationNote {
  id: string;
  application_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  summary: string | null;
  description: string | null;
  starts_on: string | null;
  ends_on: string | null;
  chapter_year: string | null;
  site_path: string | null;
  external_url: string | null;
  repo_url: string | null;
  visibility: ContentVisibility;
  category: string | null;
  sort_index: number;
}

export interface EventPositionAvailability {
  event_position_id: string;
  project_id: string;
  title: string;
  description: string | null;
  openings: number;
  is_open: boolean;
  closes_on: string | null;
  filled: number;
  remaining: number;
  pending: number;
}

export interface EventPositionApplication {
  id: string;
  event_position_id: string;
  user_id: string;
  availability: string | null;
  note: string | null;
  status: RequestStatus;
  admin_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One row of my_event_position_applications(): the member's own request plus
 * the position/project labels needed to display it. The RPC resolves these
 * even when the opening has since closed, which a PostgREST embed cannot.
 */
export interface MyEventApplication {
  id: string;
  event_position_id: string;
  status: RequestStatus;
  availability: string | null;
  note: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  position_title: string;
  position_is_open: boolean;
  position_closes_on: string | null;
  project_id: string | null;
  project_title: string;
  project_starts_on: string | null;
  has_active_assignment: boolean;
  can_unregister: boolean;
  unregister_block: 'window_closed' | null;
}

export interface Participation {
  id: string;
  user_id: string;
  project_id: string;
  role_text: string;
  status: ParticipationStatus;
  verified_at: string | null;
  started_on: string | null;
}

export interface ContributionType {
  slug: string;
  label: string;
  rank: number;
  is_active: boolean;
}

export interface Contribution {
  id: string;
  user_id: string;
  project_id: string | null;
  type_slug: string;
  title: string;
  role_text: string | null;
  description: string | null;
  occurred_on: string | null;
  links: string[];
  member_note: string | null;
  status: ReviewStatus;
  review_note: string | null;
  reviewed_at: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface ArchiveCategory {
  slug: string;
  label: string;
  rank: number;
  is_active: boolean;
}

export interface ArchiveFolder {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  name: string;
  slug: string;
  section: string;
  description: string | null;
  visibility: ContentVisibility;
  sort_index: number;
}

export interface ArchiveItem {
  id: string;
  project_id: string | null;
  folder_id: string | null;
  name: string;
  kind: ArchiveItemKind;
  category: string | null;
  section: string;
  description: string | null;
  kind_label: string | null;
  format: string | null;
  size_label: string | null;
  state: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  site_path: string | null;
  external_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  tags: string[];
  occurred_on: string | null;
  visibility: ContentVisibility;
  is_featured: boolean;
  published_at: string | null;
  created_at: string;
}

export interface ArchiveSubmission {
  id: string;
  submitted_by: string;
  project_id: string | null;
  folder_id: string | null;
  title: string;
  category: string | null;
  description: string | null;
  occurred_on: string | null;
  notes: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  external_url: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  contributor_names: string[];
  suggested_visibility: ContentVisibility;
  status: ReviewStatus;
  review_note: string | null;
  reviewed_at: string | null;
  published_item_id: string | null;
  created_at: string;
}

export interface AiSuggestions {
  category: string | null;
  project_hint: string | null;
  title: string | null;
  description: string | null;
  tags: string[];
  visibility: ContentVisibility | null;
  reasoning: string | null;
}

export interface AiFlag {
  kind: string;
  severity: 'info' | 'warning' | 'high';
  detail: string;
}

export interface ArchiveSubmissionAi {
  submission_id: string;
  model: string;
  suggestions: AiSuggestions | Record<string, never>;
  flags: AiFlag[];
  generated_at: string;
  error: string | null;
}

export interface MemberRequest {
  id: string;
  user_id: string;
  kind: MemberRequestKind;
  message: string | null;
  payload: Record<string, unknown>;
  status: RequestStatus;
  resolution: Record<string, unknown>;
  admin_note: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface MemberStats {
  user_id: string;
  events_count: number;
  projects_count: number;
  workshops_count: number;
  verified_contributions: number;
  submissions_count: number;
  positions_held: number;
}

export interface AdminAssignment {
  id: string;
  user_id: string;
  role: AdminRole;
  granted_at: string;
  revoked_at: string | null;
  note: string | null;
}

export interface PublicMember {
  user_id: string;
  name: string;
  person_slug?: string;
  status: MembershipStatus;
  member_no: string | null;
  chapter_year: string | null;
  started_on: string | null;
  bio: string;
  academic_year: string | null;
  interests: string[];
  linkedin_url: string | null;
  github_url: string | null;
  website_url: string | null;
  extra_links: Array<{ label: string; url: string }>;
  avatar_path: string | null;
  major: string | null;
  current_position: string | null;
  position_rank: number | null;
  position_category: string | null;
}

/* -------------------------------------------------------------- audit log */

export type AuditActorKind = 'admin' | 'member' | 'system' | 'migration' | 'ai_assistant';

export type AuditCategory =
  | 'membership' | 'positions' | 'events' | 'projects' | 'contributions'
  | 'archive' | 'requests' | 'administration' | 'exports' | 'inquiries';

export type AuditDecision =
  | 'approved' | 'rejected' | 'changes_requested' | 'interview' | 'published'
  | 'unpublished' | 'granted' | 'revoked' | 'created' | 'updated' | 'archived'
  | 'restored' | 'deleted' | 'exported' | 'noted';

/**
 * One audit entry.
 *
 * actor_name / actor_position / actor_role are the SNAPSHOT taken when the
 * action happened — never resolve them against the person's current profile.
 * Someone who approved an application as Vice President in 2026 must still
 * read as Vice President in 2026 after they become an alumnus.
 */
export interface AuditEntry {
  id: number;
  actor_kind: AuditActorKind;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  actor_position: string | null;
  actor_role: string | null;
  actor_member_no: string | null;
  actor_chapter_year: string | null;
  category: AuditCategory;
  action: string;
  decision: AuditDecision | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  summary: string;
  reason: string | null;
  internal_note: string | null;
  member_visible: boolean;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  changed_fields: string[];
  related_project_id: string | null;
  related_member_id: string | null;
  related_request_id: string | null;
  metadata: Record<string, unknown>;
  correlation_id: string | null;
  user_agent: string | null;
  created_at: string;
}

/** The member-safe projection. Deliberately far smaller than AuditEntry. */
export interface MemberDecision {
  id: number;
  created_at: string;
  category: AuditCategory;
  action: string;
  decision: AuditDecision | null;
  entity_type: string | null;
  entity_label: string | null;
  summary: string;
  reason: string | null;
  actor_name: string | null;
  actor_position: string | null;
  related_project_id: string | null;
}

export interface AuditSummary {
  total_actions: number;
  approvals: number;
  rejections: number;
  changes_requested: number;
  active_admins: number;
  reasons_recorded: number;
}

export interface AuditFilters {
  search?: string;
  category?: AuditCategory | '';
  decision?: AuditDecision | '';
  actorId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/* -------------------------------------------------------------- inquiries */

export type InquiryStatus = 'new' | 'in_progress' | 'answered' | 'closed';

export interface InquiryCategory {
  slug: string;
  label: string;
  label_ar: string | null;
  rank: number;
  is_active: boolean;
}

/** The staff view of an inquiry. Internal notes live in their own table. */
export interface Inquiry {
  id: string;
  reference: string;
  sender_name: string;
  sender_email: string;
  category: string | null;
  subject: string;
  message: string;
  submitted_by: string | null;
  status: InquiryStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  response: string | null;
  responded_by: string | null;
  responded_at: string | null;
  response_delivered: boolean;
  delivery_note: string | null;
  closed_at: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface InquiryNote {
  id: string;
  inquiry_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface InquiryCounts {
  new_count: number;
  in_progress_count: number;
  answered_count: number;
  closed_count: number;
  unassigned_count: number;
  mine_count: number;
  awaiting_send: number;
}

/** What a member sees of an inquiry they sent. Far smaller than Inquiry. */
export interface MyInquiry {
  id: string;
  reference: string;
  created_at: string;
  category: string | null;
  subject: string;
  message: string;
  status: InquiryStatus;
  response: string | null;
  responded_at: string | null;
}
