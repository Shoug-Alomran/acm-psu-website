/**
 * Inquiries — questions sent through the website.
 *
 * Supabase is the source of truth. The Google Sheet is an export of this
 * table and is never read back, so the two cannot diverge.
 *
 * Submission goes through the submit_inquiry() RPC rather than a table insert.
 * That is deliberate: a plain INSERT policy would let anyone holding the anon
 * key set status, assignment or response on the row they created, and would
 * leave rate limiting with nowhere to live.
 */
import { requireClient, readableError } from './supabase.js';
import { unwrap, bestEffortFunctionSync } from './api.js';
import type {
  Inquiry, InquiryCategory, InquiryCounts, InquiryNote, InquiryStatus, MyInquiry,
} from './types.js';

export const STATUS_LABELS: Record<InquiryStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  answered: 'Answered',
  closed: 'Closed',
};

export async function inquiryCategories(): Promise<InquiryCategory[]> {
  return unwrap(await requireClient().from('inquiry_categories')
    .select('*').eq('is_active', true).order('rank')) ?? [];
}

/* ------------------------------------------------------------ submitting */

export interface InquiryDraft {
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
  /** Honeypot. Real people never see this field, so it must arrive empty. */
  website?: string;
}

/** Returns the reference the sender should quote, e.g. INQ-2026-0042. */
export async function submitInquiry(draft: InquiryDraft): Promise<string> {
  const { data, error } = await requireClient().rpc('submit_inquiry', {
    sender_name: draft.name,
    sender_email: draft.email,
    category: draft.category,
    subject: draft.subject,
    message: draft.message,
    website: draft.website ?? null,
    // Only enough to tell a browser from a script. No IP is recorded.
    user_agent: navigator.userAgent.slice(0, 300),
  });

  if (error) throw new Error(readableError(error));
  void bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['inquiries'] });
  return data as string;
}

/* ------------------------------------------------------------- the queue */

export type InquiryRow = Inquiry & {
  assignee: { full_name: string; email: string } | null;
  responder: { full_name: string } | null;
};

export interface InquiryFilters {
  status?: InquiryStatus | '';
  category?: string;
  assignedTo?: string;
  search?: string;
  from?: string;
  to?: string;
  unassignedOnly?: boolean;
}

export async function inquiries(filters: InquiryFilters = {}): Promise<InquiryRow[]> {
  let query = requireClient().from('inquiries')
    .select(`
      *,
      assignee:app_users!inquiries_assigned_to_fkey(full_name, email),
      responder:app_users!inquiries_responded_by_fkey(full_name)
    `)
    .order('created_at', { ascending: false })
    .limit(300);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
  if (filters.unassignedOnly) query = query.is('assigned_to', null);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59.999Z`);

  if (filters.search) {
    const term = filters.search.replaceAll('%', '').replaceAll(',', ' ');
    query = query.or(
      `subject.ilike.%${term}%,message.ilike.%${term}%,` +
      `sender_name.ilike.%${term}%,sender_email.ilike.%${term}%,reference.ilike.%${term}%`);
  }

  return unwrap(await query) ?? [];
}

export async function inquiryCounts(): Promise<InquiryCounts> {
  const { data, error } = await requireClient().rpc('inquiry_counts');
  if (error) throw new Error(error.message);
  const row = (data as InquiryCounts[] | null)?.[0];
  return row ?? {
    new_count: 0, in_progress_count: 0, answered_count: 0, closed_count: 0,
    unassigned_count: 0, mine_count: 0, awaiting_send: 0,
  };
}

/** Internal discussion. Staff-only by RLS; the sender has no path to it. */
export async function inquiryNotes(inquiryId: string): Promise<InquiryNote[]> {
  return unwrap(await requireClient().from('inquiry_notes').select('*')
    .eq('inquiry_id', inquiryId).order('created_at')) ?? [];
}

export async function addInquiryNote(inquiryId: string, body: string): Promise<void> {
  const { error } = await requireClient().rpc('add_inquiry_note', {
    inquiry_id: inquiryId, body,
  });
  if (error) throw new Error(error.message);
}

export async function assignInquiry(
  inquiryId: string, assignee: string | null, reason: string | null = null,
): Promise<void> {
  const { error } = await requireClient().rpc('assign_inquiry', {
    inquiry_id: inquiryId, assignee, reason,
  });
  if (error) throw new Error(error.message);
  await bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['inquiries'] });
}

export async function setInquiryStatus(
  inquiryId: string, status: InquiryStatus, reason: string | null = null,
): Promise<void> {
  const { error } = await requireClient().rpc('set_inquiry_status', {
    inquiry_id: inquiryId, new_status: status, reason,
  });
  if (error) throw new Error(error.message);
  await bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['inquiries'] });
}

/**
 * Records the reply to the sender.
 *
 * This stores the response; it does not send email. No mail provider is
 * configured, so `markDelivered` is the admin confirming they sent it
 * themselves. Nothing in the interface may describe this as "sent" until an
 * email function sets that flag.
 */
export async function respondToInquiry(
  inquiryId: string,
  response: string,
  options: { markAnswered?: boolean; markDelivered?: boolean; deliveryNote?: string | null } = {},
): Promise<void> {
  const { error } = await requireClient().rpc('respond_to_inquiry', {
    inquiry_id: inquiryId,
    response,
    mark_answered: options.markAnswered ?? true,
    mark_delivered: options.markDelivered ?? false,
    delivery_note: options.deliveryNote ?? null,
  });
  if (error) throw new Error(error.message);
  await bestEffortFunctionSync('club-records-sheet-sync', { sheets: ['inquiries'] });
}

/* ------------------------------------------------------------ the sender */

/** A member's own inquiries. The view omits every internal column. */
export async function myInquiries(): Promise<MyInquiry[]> {
  return unwrap(await requireClient().from('my_inquiries').select('*')
    .order('created_at', { ascending: false })) ?? [];
}

/**
 * A mailto: link carrying the recorded response.
 *
 * Until an email provider is configured this is how a reply actually reaches
 * the sender — the admin's own mail client. Honest and usable beats a Send
 * button that silently does nothing.
 */
export function replyMailto(inquiry: Inquiry, response: string): string {
  const subject = `Re: ${inquiry.subject} [${inquiry.reference}]`;
  const body =
    `Hi ${inquiry.sender_name.split(/\s+/)[0] ?? ''},\n\n` +
    `${response}\n\n` +
    `— ACM PSU\nReference: ${inquiry.reference}\n`;
  return `mailto:${encodeURIComponent(inquiry.sender_email)}` +
    `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
