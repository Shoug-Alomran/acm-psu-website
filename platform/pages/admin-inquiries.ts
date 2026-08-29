/**
 * Inquiry queue.
 *
 * Two things are kept visibly apart on this page, because confusing them is
 * the expensive mistake: the RESPONSE goes to the person who wrote in, and
 * INTERNAL NOTES never leave the committee. They are different colours,
 * different tables, and the notes have no read policy for the sender.
 *
 * The platform records a response; it does not send email. No mail provider is
 * configured, so the page hands the admin a pre-filled mailto: link and asks
 * them to confirm they sent it. Saying "Sent" when nothing was sent would be
 * worse than saying nothing.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, dataTable, loading, dialog, field,
  metaList, notice, toast, action, emptyState, reasonField, checkReason,
} from '../lib/ui.js';
import { historyPanel } from '../lib/history.js';
import { requireAdmin, isClubAdmin } from '../lib/session.js';
import {
  inquiries, inquiryCounts, inquiryCategories, inquiryNotes, addInquiryNote,
  assignInquiry, setInquiryStatus, respondToInquiry, replyMailto,
  STATUS_LABELS, type InquiryFilters, type InquiryRow,
} from '../lib/inquiries.js';
import { adminTeam } from '../lib/admin.js';
import { archiveDate, archiveDateTime, relativeTime } from '../lib/format.js';
import type { InquiryCategory, InquiryStatus } from '../lib/types.js';

const STATUSES: InquiryStatus[] = ['new', 'in_progress', 'answered', 'closed'];

async function start(): Promise<void> {
  const viewer = await requireAdmin('reviewer');
  const content = shell(viewer, 'admin', 'Inquiries');
  render(content, loading('LOADING INQUIRIES'));

  const [categories, team] = await Promise.all([
    inquiryCategories().catch((): InquiryCategory[] => []),
    adminTeam(false).catch(() => []),
  ]);

  // Assignment is only meaningful to people who can act on the queue.
  const assignable = [...new Map(
    team.map((row) => [row.user_id, row.member?.full_name ?? row.user_id]),
  )].map(([id, name]) => ({ value: id, label: name }));

  const categoryLabel = new Map(categories.map((c) => [c.slug, c.label]));
  const filters: InquiryFilters = {};

  /* ---------------------------------------------------------------- detail */
  async function open(row: InquiryRow): Promise<void> {
    const notes = await inquiryNotes(row.id).catch(() => []);

    const responseBox = field({
      label: 'Response to sender',
      name: 'response',
      type: 'textarea',
      rows: 7,
      value: row.response,
      hint: 'This is what the person who wrote in will read. Keep internal ' +
            'discussion out of it — use the notes below for that.',
    });

    const noteBox = field({
      label: 'Add an internal note',
      name: 'note',
      type: 'textarea',
      rows: 3,
      hint: 'Committee only. The sender can never read these.',
    });

    const currentResponse = () =>
      (responseBox.querySelector('textarea') as HTMLTextAreaElement).value.trim();

    const modal = dialog(`${row.reference} — ${row.subject}`,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.5rem' } },

        metaList([
          ['Status', statusPill(row.status)],
          ['From', row.sender_name],
          ['Email', h('a', { href: `mailto:${row.sender_email}` }, row.sender_email)],
          ['Category', categoryLabel.get(row.category ?? '') ?? row.category ?? '—'],
          ['Received', archiveDateTime(row.created_at)],
          ['Assigned to', row.assignee?.full_name ?? 'Nobody yet'],
          ['Account', row.submitted_by ? 'Signed-in member' : 'Visitor (no account)'],
          ['Response', row.responded_at
            ? `${row.responder?.full_name ?? 'Recorded'} · ${archiveDate(row.responded_at)}`
            : 'None yet'],
          ['Actually sent', row.response
            ? (row.response_delivered ? 'Yes' : 'Not yet — see below')
            : '—'],
        ]),

        panel('Their message',
          h('p', { style: { whiteSpace: 'pre-wrap' } }, row.message)),

        /* ------------------------------------------------ response to sender */
        panel('Response to sender',
          responseBox,
          notice('info',
            'Saving records the response. It does not email anyone — the ' +
            'platform has no mail provider yet. Use the button below to send ' +
            'it from your own mail client, then mark it as sent.'),
          h('div', { class: 'button-row' },
            action('Save response', async () => {
              const response = currentResponse();
              if (response.length < 10) {
                toast('Write a response of at least a sentence.', 'err');
                return;
              }
              await respondToInquiry(row.id, response, { markAnswered: true });
              modal.close();
              toast('Response recorded. Send it, then mark it as sent.');
              await draw();
            }, 'primary'),

            h('a', {
              class: 'btn-ghost',
              href: replyMailto(row, row.response ?? ''),
              onclick: (event: Event) => {
                const typed = currentResponse();
                if (typed.length < 10) {
                  event.preventDefault();
                  toast('Save the response first, then open your mail client.', 'err');
                  return;
                }
                (event.currentTarget as HTMLAnchorElement).href = replyMailto(row, typed);
              },
            }, 'Open in mail client'),

            row.response && !row.response_delivered
              ? action('Mark as sent', async () => {
                  await respondToInquiry(row.id, row.response!, {
                    markAnswered: true,
                    markDelivered: true,
                    deliveryNote: `Sent manually by ${viewer.user.full_name}`,
                  });
                  modal.close();
                  toast('Marked as sent.');
                  await draw();
                })
              : null)),

        /* -------------------------------------------------- internal notes */
        panel('Internal notes',
          notes.length
            ? h('div', { class: 'history-trail' },
                notes.map((note) => h('div', { class: 'history-entry' },
                  h('span', { class: 'mono-meta' }, archiveDateTime(note.created_at)),
                  h('p', { class: 'history-internal' }, note.body))))
            : h('p', { class: 'mono-meta dim-text' }, 'NONE YET'),
          noteBox,
          h('div', { class: 'button-row' },
            action('Add note', async () => {
              const body = (noteBox.querySelector('textarea') as HTMLTextAreaElement).value.trim();
              if (!body) return;
              await addInquiryNote(row.id, body);
              modal.close();
              toast('Note added.');
              await draw();
            }))),

        historyPanel('inquiry', row.id),
      ),

      /* ------------------------------------------------------- queue actions */
      h('div', { class: 'button-row' },
        h('select', {
          'aria-label': 'Assign to',
          onchange: async (event: Event) => {
            const value = (event.target as HTMLSelectElement).value;
            try {
              await assignInquiry(row.id, value || null);
              modal.close();
              toast(value ? 'Assigned.' : 'Unassigned.');
              await draw();
            } catch (error) {
              toast(error instanceof Error ? error.message : String(error), 'err');
            }
          },
        },
          h('option', { value: '', selected: !row.assigned_to }, 'Unassigned'),
          assignable.map((person) =>
            h('option', { value: person.value, selected: person.value === row.assigned_to },
              person.label))),

        row.status !== 'in_progress' && row.status !== 'closed'
          ? action('Mark in progress', async () => {
              await setInquiryStatus(row.id, 'in_progress');
              modal.close();
              toast('Marked in progress.');
              await draw();
            })
          : null,

        // These open a second dialog rather than performing work, so they are
        // plain buttons; action() is for awaiting an RPC.
        row.status !== 'closed'
          ? h('button', { type: 'button', class: 'btn-ghost btn-danger',
              onclick: () => closeDialog(row, modal) }, 'Close')
          : h('button', { type: 'button', class: 'btn-ghost',
              onclick: () => reopenDialog(row, modal) }, 'Reopen'),
      ));
  }

  /* Closing an unanswered inquiry, and reopening a closed one, both need an
     explanation — the database requires one too. */
  function closeDialog(row: InquiryRow, parent: HTMLDialogElement): void {
    const needsReason = row.status !== 'answered';
    const form = h('form', { class: 'portal-form' },
      notice(needsReason ? 'warn' : 'info',
        needsReason
          ? 'This inquiry has not been answered. Closing it without a reply ' +
            'needs a reason on the record.'
          : 'Closing an answered inquiry. A reason is optional.'),
      reasonField({ required: needsReason }),
    ) as HTMLFormElement;

    const modal = dialog(`Close ${row.reference}`, form,
      h('div', { class: 'button-row' },
        action('Close inquiry', async () => {
          const typed = textOf(formValues(form), 'reason');
          const reason = needsReason
            ? checkReason(typed, 'close an inquiry that was never answered')
            : typed || null;
          if (needsReason && !reason) return;
          await setInquiryStatus(row.id, 'closed', reason);
          modal.close();
          parent.close();
          toast('Inquiry closed.');
          await draw();
        }, 'danger')));
  }

  function reopenDialog(row: InquiryRow, parent: HTMLDialogElement): void {
    const form = h('form', { class: 'portal-form' },
      notice('info', 'Reopening a closed inquiry is recorded with your reason.'),
      reasonField({ label: 'Why is this being reopened?' }),
    ) as HTMLFormElement;

    const modal = dialog(`Reopen ${row.reference}`, form,
      h('div', { class: 'button-row' },
        action('Reopen', async () => {
          const reason = checkReason(textOf(formValues(form), 'reason'),
            'reopen a closed inquiry');
          if (!reason) return;
          await setInquiryStatus(row.id, 'in_progress', reason);
          modal.close();
          parent.close();
          toast('Reopened.');
          await draw();
        }, 'primary')));
  }

  /* ------------------------------------------------------------------ draw */
  async function draw(): Promise<void> {
    const [rows, counts] = await Promise.all([
      inquiries(filters),
      inquiryCounts().catch(() => null),
    ]);

    const searchInput = h('input', {
      type: 'search', placeholder: 'Reference, subject, sender…',
      value: filters.search ?? '', 'aria-label': 'Search inquiries',
    }) as HTMLInputElement;

    let timer = 0;
    searchInput.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        filters.search = searchInput.value.trim() || undefined;
        void draw();
      }, 300);
    });

    const select = (
      label: string, value: string | undefined,
      options: Array<{ value: string; label: string }>,
      onChange: (v: string) => void,
    ) => {
      const el = h('select', { 'aria-label': label },
        options.map((o) => h('option', { value: o.value, selected: o.value === (value ?? '') },
          o.label))) as HTMLSelectElement;
      el.addEventListener('change', () => onChange(el.value));
      return el;
    };

    const dateInput = (label: string, current: string | undefined,
                       apply: (v: string | undefined) => void) => {
      const el = h('input', { type: 'date', value: current ?? '', 'aria-label': label }) as HTMLInputElement;
      el.addEventListener('change', () => { apply(el.value || undefined); void draw(); });
      return el;
    };

    render(content,
      pageHeader('ADMIN / INQUIRIES', 'Inquiries',
        isClubAdmin(viewer)
          ? h('a', { class: 'btn-ghost', href: '/admin/university-records.html' },
              'Export to Club Records')
          : null),

      counts
        ? h('div', { class: 'stat-row' },
            ([
              ['new', counts.new_count, 'New'],
              ['in_progress', counts.in_progress_count, 'In progress'],
              ['answered', counts.answered_count, 'Answered'],
              ['closed', counts.closed_count, 'Closed'],
            ] as Array<[InquiryStatus, number, string]>).map(([status, value, label]) =>
              h('button', {
                type: 'button',
                class: 'stat-tile',
                style: { textAlign: 'left', cursor: 'pointer',
                         background: filters.status === status ? 'var(--accent-blue-dim)' : 'none',
                         border: 'none', color: 'inherit', font: 'inherit' },
                onclick: () => {
                  filters.status = filters.status === status ? '' : status;
                  void draw();
                },
              },
                h('strong', { class: 'stat-value' }, String(value)),
                h('span', { class: 'mono-meta' }, label.toUpperCase()))))
        : null,

      counts && counts.awaiting_send > 0
        ? notice('warn',
            `${counts.awaiting_send} response${counts.awaiting_send === 1 ? '' : 's'} ` +
            'written but not yet marked as sent. The platform does not email ' +
            'anyone — open each one and send it from your mail client.')
        : null,

      h('div', { class: 'browser-toolbar' },
        searchInput,
        select('Status', filters.status,
          [{ value: '', label: 'All statuses' },
           ...STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))],
          (v) => { filters.status = v as InquiryStatus | ''; void draw(); }),
        select('Category', filters.category,
          [{ value: '', label: 'All categories' },
           ...categories.map((c) => ({ value: c.slug, label: c.label }))],
          (v) => { filters.category = v || undefined; void draw(); }),
        select('Assigned to', filters.assignedTo,
          [{ value: '', label: 'Anyone' },
           { value: viewer.userId, label: 'Assigned to me' },
           ...assignable.filter((a) => a.value !== viewer.userId)],
          (v) => { filters.assignedTo = v || undefined; void draw(); }),
        dateInput('From', filters.from, (v) => { filters.from = v; }),
        dateInput('To', filters.to, (v) => { filters.to = v; }),
        h('button', { type: 'button', class: 'btn-ghost',
          onclick: () => {
            filters.search = undefined; filters.status = ''; filters.category = undefined;
            filters.assignedTo = undefined; filters.from = undefined; filters.to = undefined;
            void draw();
          } }, 'Reset'),
        h('span', { class: 'mono-meta dim-text' }, `${rows.length} SHOWN`)),

      panel('Queue',
        rows.length
          ? dataTable(
              ['Received', 'Reference', 'From', 'Subject', 'Category', 'Assigned', 'Status', ''],
              rows.map((row) => [
                h('div', { class: 'audit-actor' },
                  h('span', { class: 'mono-meta' }, archiveDate(row.created_at)),
                  h('span', { class: 'mono-meta' }, relativeTime(row.created_at))),
                h('span', { class: 'mono-meta accent-text' }, row.reference),
                h('div', {},
                  h('strong', row.sender_name),
                  h('p', { class: 'mono-meta dim-text' }, row.sender_email)),
                h('div', {},
                  h('strong', row.subject),
                  h('p', { class: 'mono-meta dim-text' }, row.message.slice(0, 90) + '…')),
                h('span', { class: 'mono-meta' },
                  (categoryLabel.get(row.category ?? '') ?? row.category ?? '—').toUpperCase()),
                h('span', { class: 'mono-meta' },
                  row.assignee?.full_name ?? h('span', { class: 'dim-text' }, 'NOBODY')),
                h('div', {},
                  statusPill(row.status),
                  row.response && !row.response_delivered
                    ? h('p', { class: 'mono-meta', style: { color: 'var(--pill-warn)' } },
                        'NOT SENT')
                    : null),
                h('button', { type: 'button', class: 'link-button',
                  onclick: () => void open(row) }, 'OPEN'),
              ]))
          : emptyState('No inquiries match these filters.',
              'Messages sent through the contact page arrive here.')),

      notice('info',
        'Responses are recorded here and read by the sender only when you send ' +
        'them. Internal notes are never visible to the sender or through any ' +
        'public interface.'),
    );

    if (filters.search) {
      searchInput.focus();
      searchInput.setSelectionRange(filters.search.length, filters.search.length);
    }
  }

  await draw();
}

void start();
