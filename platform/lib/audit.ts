/**
 * Reading the audit log.
 *
 * Nothing here writes. Entries are created inside the database functions that
 * perform the actions, in the same transaction, so an action can never exist
 * without its record. See supabase/migrations/*_audit.sql.
 */
import { requireClient } from './supabase.js';
import { unwrap } from './api.js';
import type {
  AuditCategory, AuditDecision, AuditEntry, AuditFilters, AuditSummary,
  MemberDecision,
} from './types.js';

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  membership: 'Membership',
  positions: 'Positions',
  events: 'Events',
  projects: 'Projects',
  contributions: 'Contributions',
  archive: 'Archive',
  requests: 'Requests',
  administration: 'Administration',
  exports: 'Exports',
};

export const DECISION_LABELS: Record<AuditDecision, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  interview: 'Interview',
  published: 'Published',
  unpublished: 'Unpublished',
  granted: 'Granted',
  revoked: 'Revoked',
  created: 'Created',
  updated: 'Updated',
  archived: 'Archived',
  restored: 'Restored',
  deleted: 'Deleted',
  exported: 'Exported',
  noted: 'Noted',
};

/** Field names as a person would read them, for the before/after diff. */
const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  membership_status: 'Membership',
  position: 'Position',
  visibility: 'Visibility',
  title: 'Title',
  category: 'Category',
  description: 'Description',
  account_state: 'Sign-in',
  role: 'Admin role',
  active: 'Active',
  verified: 'Verified',
  folder: 'Folder',
  section: 'Section',
  deleted: 'Deleted',
  storage_bucket: 'Storage',
  effective_from: 'Effective from',
  start_date: 'Start date',
  type: 'Type',
  is_open: 'Open',
  openings: 'Openings',
  chapter_year: 'Chapter',
  ended_on: 'Ended',
  started_on: 'Started',
  title_snapshot: 'Position',
  is_active: 'Active',
  is_featured: 'Featured',
  sort_index: 'Order',
  name: 'Name',
  full_name: 'Name',
  value: 'Value',
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ??
    key.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Renders a stored state value as a short readable string. */
export function stateValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface FieldChange { field: string; before: string; after: string }

/**
 * Turns before/after state into the "Position: Member → Events Coordinator"
 * rows the detail view shows, so nobody has to read raw JSON.
 */
export function fieldChanges(entry: AuditEntry): FieldChange[] {
  const before = entry.before_state ?? {};
  const after = entry.after_state ?? {};
  const keys = entry.changed_fields.length
    ? entry.changed_fields
    : [...new Set([...Object.keys(before), ...Object.keys(after)])];

  return keys
    .filter((key) => !['updated_at', 'created_at'].includes(key))
    .map((key) => ({
      field: fieldLabel(key),
      before: stateValue(before[key]),
      after: stateValue(after[key]),
    }))
    .filter((change) => change.before !== change.after);
}

/** How the actor should be named — "Shoug Alomran · Vice President". */
export function actorLine(entry: {
  actor_kind?: string; actor_name: string | null; actor_position: string | null;
}): string {
  if (entry.actor_kind === 'system') return 'System';
  if (entry.actor_kind === 'migration') return 'Migration';
  if (entry.actor_kind === 'ai_assistant') return 'Review assistant (suggestion only)';
  const name = entry.actor_name ?? 'Unknown';
  return entry.actor_position ? `${name} · ${entry.actor_position}` : name;
}

/* -------------------------------------------------------------- querying */

export async function auditEntries(filters: AuditFilters = {}): Promise<AuditEntry[]> {
  let query = requireClient().from('audit_log').select('*')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.category) query = query.eq('category', filters.category);
  if (filters.decision) query = query.eq('decision', filters.decision);
  if (filters.actorId) query = query.eq('actor_id', filters.actorId);
  if (filters.projectId) query = query.eq('related_project_id', filters.projectId);
  if (filters.from) query = query.gte('created_at', filters.from);
  // The `to` filter is a calendar day; include the whole of it.
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59.999Z`);

  if (filters.search) {
    const term = filters.search.replaceAll('%', '').replaceAll(',', ' ');
    query = query.or(
      `summary.ilike.%${term}%,entity_label.ilike.%${term}%,` +
      `actor_name.ilike.%${term}%,reason.ilike.%${term}%,action.ilike.%${term}%`);
  }

  return unwrap(await query) ?? [];
}

export async function auditSummary(days = 30): Promise<AuditSummary> {
  const { data, error } = await requireClient().rpc('audit_summary', { since_days: days });
  if (error) throw new Error(error.message);
  const row = (data as AuditSummary[] | null)?.[0];
  return row ?? {
    total_actions: 0, approvals: 0, rejections: 0,
    changes_requested: 0, active_admins: 0, reasons_recorded: 0,
  };
}

/** Everything that happened to one record, for the History panel on its page. */
export async function recordHistory(
  entityType: string, entityId: string, memberId?: string | null,
): Promise<AuditEntry[]> {
  const { data, error } = await requireClient().rpc('record_history', {
    entity: entityType,
    entity_key: entityId,
    member: memberId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditEntry[];
}

/** The signed-in member's own decision history. Column-limited by the view. */
export async function myDecisions(limit = 40): Promise<MemberDecision[]> {
  return unwrap(await requireClient().from('my_decision_history').select('*')
    .order('created_at', { ascending: false }).limit(limit)) ?? [];
}

/** Distinct admins who appear in the log, for the actor filter. */
export async function auditActors(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await requireClient().from('audit_log')
    .select('actor_id, actor_name')
    .not('actor_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);

  const seen = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ actor_id: string; actor_name: string | null }>) {
    if (!seen.has(row.actor_id)) seen.set(row.actor_id, row.actor_name ?? row.actor_id);
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/* --------------------------------------------------------------- exporting */

const EXPORT_COLUMNS: Array<[string, (e: AuditEntry) => string]> = [
  ['Audit ID', (e) => String(e.id)],
  ['Timestamp', (e) => e.created_at],
  ['Actor kind', (e) => e.actor_kind],
  ['Admin', (e) => e.actor_name ?? ''],
  ['Position at the time', (e) => e.actor_position ?? ''],
  ['Admin role at the time', (e) => e.actor_role ?? ''],
  ['Chapter', (e) => e.actor_chapter_year ?? ''],
  ['Category', (e) => e.category],
  ['Action', (e) => e.action],
  ['Decision', (e) => e.decision ?? ''],
  ['Target type', (e) => e.entity_type ?? ''],
  ['Target', (e) => e.entity_label ?? ''],
  ['Target ID', (e) => e.entity_id ?? ''],
  ['Summary', (e) => e.summary],
  ['Reason', (e) => e.reason ?? ''],
  ['Internal note', (e) => e.internal_note ?? ''],
  ['Changed fields', (e) => e.changed_fields.join('; ')],
  ['Before', (e) => (e.before_state ? JSON.stringify(e.before_state) : '')],
  ['After', (e) => (e.after_state ? JSON.stringify(e.after_state) : '')],
];

/** A cell beginning with = + - @ is executed as a formula by Excel. */
function csvCell(value: string): string {
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Downloads the currently filtered entries.
 *
 * Admin only, and deliberately separate from the university export: internal
 * ACM accountability and university reporting are different systems, and the
 * audit log must never end up in the university's spreadsheet.
 */
export function exportAuditCsv(entries: AuditEntry[]): void {
  const rows = [
    EXPORT_COLUMNS.map(([header]) => header),
    ...entries.map((entry) => EXPORT_COLUMNS.map(([, read]) => read(entry))),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');

  // BOM so Excel reads Arabic names correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `acm-psu-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
