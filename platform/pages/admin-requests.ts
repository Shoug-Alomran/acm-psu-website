/**
 * All member requests in one queue.
 *
 * Withdrawal, position change, profile removal, account deletion and event
 * volunteering arrive here. Each resolves through the RPC written for it, so
 * the side effects — closing a position, setting a membership status, creating
 * a verified participation record — happen the same way every time.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, dataTable, loading, dialog, field,
  metaList, notice, toast, action, emptyState, reasonField, internalNoteField,
  checkReason,
} from '../lib/ui.js';
import { historyPanel } from '../lib/history.js';
import { requireAdmin } from '../lib/session.js';
import {
  memberRequests, positionRequests, eventRequests, resolveWithdrawal,
  resolveProfileRemoval, resolvePositionRequest, decideMemberRequest, decideEventRequest,
  type MemberRequestRow, type PositionRequestRow,
} from '../lib/admin.js';
import { positions } from '../lib/api.js';
import { archiveDate, enumLabel } from '../lib/format.js';
import type { MembershipStatus, Position } from '../lib/types.js';

async function start(): Promise<void> {
  const viewer = await requireAdmin('club_admin');
  const content = shell(viewer, 'admin', 'Requests');
  render(content, loading());

  const positionList = await positions();
  let showResolved = false;

  /* ------------------------------------------------------------ withdrawal */
  function withdrawalDialog(request: MemberRequestRow): void {
    const preferred = String(request.payload.preferred_outcome ?? '');
    const form = h('form', { class: 'portal-form' },
      notice('info',
        'Position history and verified contributions are kept whatever you choose. ' +
        'This only changes the person’s standing.'),
      field({ label: 'Resulting status', name: 'status', type: 'select',
              value: preferred || 'alumni',
              options: [
                { value: 'alumni', label: 'Alumni — finished their time here' },
                { value: 'inactive', label: 'Inactive — may return' },
                { value: 'withdrawn', label: 'Withdrawn' },
              ] }),
      field({ label: 'Close their current position?', name: 'close_position', type: 'select',
              value: 'yes',
              options: [{ value: 'yes', label: 'Yes — end the current term' },
                        { value: 'no', label: 'No — leave it open' }] }),
      reasonField({
        label: 'Reason for this outcome',
        hint: 'Required. Shown to the member and kept on the permanent record.',
      }),
    ) as HTMLFormElement;

    const modal = dialog(`Withdrawal — ${request.member?.full_name ?? ''}`,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.25rem' } },
        metaList([
          ['Requested', archiveDate(request.created_at)],
          ['Preferred outcome', preferred ? enumLabel(preferred) : 'Left to the admins'],
          ['Their message', request.message ?? '—'],
        ]),
        form,
        historyPanel('member', request.user_id, request.user_id)),
      h('div', { class: 'button-row' },
        action('Confirm withdrawal', async () => {
          const values = formValues(form);
          const reason = checkReason(textOf(values, 'reason'),
            'end this membership');
          if (!reason) return;
          await resolveWithdrawal(request.id,
            textOf(values, 'status') as MembershipStatus,
            textOf(values, 'close_position') === 'yes',
            reason);
          modal.close();
          toast('Membership updated.');
          await draw();
        }, 'primary'),
        action('Decline', async () => {
          const reason = checkReason(textOf(formValues(form), 'reason'),
            'decline this request');
          if (!reason) return;
          await decideMemberRequest(request.id, false, reason);
          modal.close();
          toast('Request declined.');
          await draw();
        }, 'danger')));
  }

  /* -------------------------------------------------------- profile removal */
  function removalDialog(request: MemberRequestRow): void {
    const form = h('form', { class: 'portal-form' },
      notice('info',
        'Approving sets their profile to private. Their membership, record and ' +
        'position history are untouched, and nothing is deleted.'),
      reasonField({ required: false,
        hint: 'Optional when granting the request; required if you decline it.' }),
    ) as HTMLFormElement;

    const modal = dialog(`Profile removal — ${request.member?.full_name ?? ''}`,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.25rem' } },
        metaList([
          ['Requested', archiveDate(request.created_at)],
          ['Their message', request.message ?? '—'],
        ]),
        form),
      h('div', { class: 'button-row' },
        action('Remove public profile', async () => {
          await resolveProfileRemoval(request.id, true,
            textOf(formValues(form), 'reason') || null);
          modal.close();
          toast('Profile hidden from the public site.');
          await draw();
        }, 'primary'),
        action('Decline', async () => {
          const reason = checkReason(textOf(formValues(form), 'reason'),
            'decline a profile removal request');
          if (!reason) return;
          await resolveProfileRemoval(request.id, false, reason);
          modal.close();
          toast('Request declined.');
          await draw();
        }, 'danger')));
  }

  /* ---------------------------------------------------------------- generic */
  function genericDialog(request: MemberRequestRow): void {
    const form = h('form', { class: 'portal-form' },
      request.kind === 'account_deletion'
        ? notice('warn',
            'Deleting an account removes sign-in only. Official records — position ' +
            'history, verified contributions, published archive items — are club ' +
            'records and stay. Talk to the person before doing anything irreversible; ' +
            'disabling the account from Members is usually the right first step.')
        : null,
      reasonField({
        hint: 'Required for account deletion requests and whenever you decline. ' +
              'Shown to the member.',
      }),
      internalNoteField(),
    ) as HTMLFormElement;

    const modal = dialog(`${enumLabel(request.kind)} — ${request.member?.full_name ?? ''}`,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.25rem' } },
        metaList([
          ['Requested', archiveDate(request.created_at)],
          ['Email', request.member?.email ?? '—'],
          ['Their message', request.message ?? '—'],
        ]),
        form),
      h('div', { class: 'button-row' },
        action('Mark handled', async () => {
          const values = formValues(form);
          // Account deletion always needs an account of what was agreed.
          const needsReason = request.kind === 'account_deletion';
          const reason = needsReason
            ? checkReason(textOf(values, 'reason'), 'resolve an account deletion request')
            : textOf(values, 'reason') || null;
          if (needsReason && !reason) return;
          await decideMemberRequest(request.id, true, reason,
            textOf(values, 'internal') || null);
          modal.close();
          toast('Request closed.');
          await draw();
        }, 'primary'),
        action('Decline', async () => {
          const values = formValues(form);
          const reason = checkReason(textOf(values, 'reason'), 'decline this request');
          if (!reason) return;
          await decideMemberRequest(request.id, false, reason,
            textOf(values, 'internal') || null);
          modal.close();
          toast('Request declined.');
          await draw();
        }, 'danger')));
  }

  /* ------------------------------------------------------- position change */
  function positionDialog(request: PositionRequestRow): void {
    const form = h('form', { class: 'portal-form' },
      notice('info',
        'Approving closes their current position and opens a new one. Nothing in ' +
        'their history is overwritten.'),
      h('div', { class: 'field-pair' },
        field({ label: 'Position to grant', name: 'position_id', type: 'select',
                value: request.requested_position_id ?? '',
                options: [{ value: '', label: 'Select…' },
                  ...positionList.map((p: Position) => ({ value: p.id, label: p.title }))] }),
        field({ label: 'Effective from', name: 'effective_on', type: 'date',
                value: new Date().toISOString().slice(0, 10) })),
      reasonField({ required: false,
        hint: 'Optional when approving; required if you decline. Shown to the member.' }),
    ) as HTMLFormElement;

    const modal = dialog(`Position request — ${request.member?.full_name ?? ''}`,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.25rem' } },
        metaList([
          ['Requested', archiveDate(request.created_at)],
          ['They asked for', request.requested?.title ?? request.requested_title ?? '—'],
          ['Why', request.reason ?? '—'],
        ]),
        form),
      h('div', { class: 'button-row' },
        action('Approve', async () => {
          const values = formValues(form);
          const positionId = textOf(values, 'position_id');
          if (!positionId) { toast('Choose the position being granted.', 'err'); return; }
          await resolvePositionRequest(request.id, true, positionId,
            textOf(values, 'effective_on') || new Date().toISOString().slice(0, 10),
            textOf(values, 'reason') || null);
          modal.close();
          toast('Position granted.');
          await draw();
        }, 'primary'),
        action('Decline', async () => {
          const reason = checkReason(textOf(formValues(form), 'reason'),
            'decline this position request');
          if (!reason) return;
          await resolvePositionRequest(request.id, false, null,
            new Date().toISOString().slice(0, 10), reason);
          modal.close();
          toast('Request declined.');
          await draw();
        }, 'danger')));
  }

  /* ------------------------------------------------------------------ event */
  function eventDialog(request: Record<string, unknown>): void {
    const member = request.member as { full_name: string; email: string } | null;
    const position = request.position as { title: string; openings: number } | null;

    const form = h('form', { class: 'portal-form' },
      notice('info',
        'Approving records verified participation on the event, which becomes part ' +
        'of their ACM record. Capacity is checked when you approve.'),
      reasonField({ required: false,
        hint: 'Optional. Shown to the member with the outcome.' }),
    ) as HTMLFormElement;

    const modal = dialog(`Event position — ${member?.full_name ?? ''}`,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.25rem' } },
        metaList([
          ['Role', position?.title ?? '—'],
          ['Openings', String(position?.openings ?? '—')],
          ['Availability', String(request.availability ?? '—')],
          ['Their note', String(request.note ?? '—')],
        ]),
        form),
      h('div', { class: 'button-row' },
        action('Approve', async () => {
          await decideEventRequest(String(request.id), true,
            textOf(formValues(form), 'reason') || null);
          modal.close();
          toast('Assigned.');
          await draw();
        }, 'primary'),
        action('Decline', async () => {
          await decideEventRequest(String(request.id), false,
            textOf(formValues(form), 'reason') || null);
          modal.close();
          toast('Declined.');
          await draw();
        }, 'danger')));
  }

  async function draw(): Promise<void> {
    const statuses = showResolved
      ? ['pending', 'approved', 'rejected', 'cancelled'] : ['pending'];

    const [general, position, event] = await Promise.all([
      memberRequests(statuses), positionRequests(statuses), eventRequests(statuses),
    ]);

    render(content,
      pageHeader('ADMIN / REQUESTS', 'Member requests',
        h('button', { type: 'button', class: 'btn-ghost',
          onclick: () => { showResolved = !showResolved; void draw(); } },
          showResolved ? 'Show pending only' : 'Include resolved')),

      panel(`Membership and privacy — ${general.length}`,
        general.length
          ? dataTable(['Member', 'Request', 'Message', 'Raised', 'Status', ''],
              general.map((request) => [
                h('div', {},
                  h('strong', request.member?.full_name ?? '—'),
                  h('p', { class: 'mono-meta dim-text' }, request.member?.email ?? '')),
                h('span', { class: 'mono-meta accent-text' }, enumLabel(request.kind)),
                h('span', { class: 'mono-meta dim-text' },
                  (request.message ?? '').slice(0, 90) || '—'),
                h('span', { class: 'mono-meta' }, archiveDate(request.created_at)),
                statusPill(request.status),
                request.status === 'pending'
                  ? h('button', { type: 'button', class: 'link-button',
                      onclick: () => {
                        if (request.kind === 'withdrawal') withdrawalDialog(request);
                        else if (request.kind === 'profile_removal') removalDialog(request);
                        else genericDialog(request);
                      } }, 'RESOLVE')
                  : h('span', { class: 'mono-meta dim-text' }, request.admin_note ?? ''),
              ]))
          : emptyState('Nothing waiting.')),

      panel(`Position changes — ${position.length}`,
        position.length
          ? dataTable(['Member', 'Asked for', 'Why', 'Raised', 'Status', ''],
              position.map((request) => [
                request.member?.full_name ?? '—',
                request.requested?.title ?? request.requested_title ?? '—',
                h('span', { class: 'mono-meta dim-text' },
                  (request.reason ?? '').slice(0, 90) || '—'),
                h('span', { class: 'mono-meta' }, archiveDate(request.created_at)),
                statusPill(request.status),
                request.status === 'pending'
                  ? h('button', { type: 'button', class: 'link-button',
                      onclick: () => positionDialog(request) }, 'RESOLVE')
                  : h('span', { class: 'mono-meta dim-text' }, request.admin_note ?? ''),
              ]))
          : emptyState('Nothing waiting.')),

      panel(`Event positions — ${event.length}`,
        event.length
          ? dataTable(['Member', 'Role', 'Availability', 'Raised', 'Status', ''],
              (event as Array<Record<string, unknown>>).map((request) => {
                const member = request.member as { full_name: string } | null;
                const position2 = request.position as { title: string } | null;
                return [
                  member?.full_name ?? '—',
                  position2?.title ?? '—',
                  h('span', { class: 'mono-meta dim-text' },
                    String(request.availability ?? '—').slice(0, 60)),
                  h('span', { class: 'mono-meta' }, archiveDate(String(request.created_at))),
                  statusPill(String(request.status)),
                  request.status === 'pending'
                    ? h('button', { type: 'button', class: 'link-button',
                        onclick: () => eventDialog(request) }, 'RESOLVE')
                    : h('span', { class: 'mono-meta dim-text' },
                        String(request.admin_note ?? '')),
                ];
              }))
          : emptyState('Nothing waiting.')),

      notice('info',
        'Leaving ACM, hiding a public profile and deleting an account are three ' +
        'separate requests, and none of them erases verified work.'),
    );
  }

  await draw();
}

void start();
