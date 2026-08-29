/**
 * Member directory and management.
 *
 * Everything on this page writes to ACM-controlled records, so every action
 * goes through an audited path. Member-controlled fields — bio, links, chosen
 * visibility — are shown but not edited here; those belong to the member.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, dataTable, loading, dialog, field,
  metaList, notice, toast, action, emptyState, reasonField, internalNoteField,
  checkReason,
} from '../lib/ui.js';
import { historyPanel } from '../lib/history.js';
import { requireAdmin, isSuperAdmin } from '../lib/session.js';
import {
  members, setMembershipStatus, setAccountState, grantPosition,
  type MemberRow,
} from '../lib/admin.js';
import { positions, positionHistory, memberStats } from '../lib/api.js';
import { archiveDate, term, enumLabel } from '../lib/format.js';
import type { MembershipStatus, Position } from '../lib/types.js';

const STATUSES: MembershipStatus[] =
  ['active', 'applicant', 'alumni', 'inactive', 'withdrawn', 'rejected'];

async function start(): Promise<void> {
  const viewer = await requireAdmin('club_admin');
  const content = shell(viewer, 'admin', 'Members');
  render(content, loading());

  const positionList = await positions();
  let search = '';
  let statusFilter = 'active';

  async function openMember(member: MemberRow): Promise<void> {
    const [history, stats] = await Promise.all([
      positionHistory(member.id), memberStats(member.id),
    ]);

    const positionForm = h('form', { class: 'portal-form' },
      h('div', { class: 'field-pair' },
        field({ label: 'Grant position', name: 'position_id', type: 'select',
                options: [{ value: '', label: 'Select…' },
                  ...positionList.map((p: Position) => ({ value: p.id, label: p.title }))] }),
        field({ label: 'Effective from', name: 'effective_on', type: 'date',
                value: new Date().toISOString().slice(0, 10) })),
      reasonField({ label: 'Why this position?', required: false,
                    hint: 'Recorded on their position history and the audit record.' }),
    ) as HTMLFormElement;

    const statusForm = h('form', { class: 'portal-form' },
      field({ label: 'Membership status', name: 'status', type: 'select',
              value: member.membership?.status,
              options: STATUSES.map((s) => ({ value: s, label: enumLabel(s) })) }),
      reasonField({
        hint: 'Required when ending a membership (alumni, inactive, withdrawn ' +
              'or rejected). Shown to the member and kept permanently.',
      }),
      internalNoteField(member.membership?.internal_note),
    ) as HTMLFormElement;

    const modal = dialog(member.full_name,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.5rem' } },
        metaList([
          ['Membership', statusPill(member.membership?.status)],
          ['Account', statusPill(member.account_state)],
          ['Email', member.email],
          ['Student ID', member.student_id ?? '—'],
          ['Major', member.major ?? '—'],
          ['Academic year', member.profile?.academic_year ?? '—'],
          ['Member since', archiveDate(member.membership?.started_on)],
          ['Chapter', member.membership?.chapter_year ?? '—'],
          ['Public profile', member.profile?.visibility === 'public' ? 'Listed' : 'Private'],
          ['Verified contributions', String(stats.verified_contributions)],
          ['Events', String(stats.events_count)],
        ]),

        h('div', {},
          h('p', { class: 'mono-meta dim-text' }, 'POSITION HISTORY'),
          history.length
            ? h('div', { class: 'history-list' },
                history.map((row) => h('div', { class: 'history-row' },
                  h('span', { class: 'mono-meta' }, term(row.started_on, row.ended_on)),
                  h('strong', row.title_snapshot))))
            : h('p', { class: 'mono-meta dim-text' }, 'None recorded.')),

        historyPanel('member', member.id, member.id),

        panel('Grant a position', positionForm,
          h('p', { class: 'mono-meta dim-text' },
            'The current position is closed automatically; nothing is overwritten.'),
          h('div', { class: 'button-row' },
            action('Grant', async () => {
              const values = formValues(positionForm);
              const positionId = textOf(values, 'position_id');
              if (!positionId) { toast('Choose a position.', 'err'); return; }
              await grantPosition(member.id, positionId,
                textOf(values, 'effective_on') || new Date().toISOString().slice(0, 10),
                textOf(values, 'reason') || null);
              modal.close();
              toast('Position granted.');
              await draw();
            }, 'primary'))),

        panel('Membership status', statusForm,
          h('div', { class: 'button-row' },
            action('Update status', async () => {
              const values = formValues(statusForm);
              const status = textOf(values, 'status') as MembershipStatus;
              // Ending or refusing a membership needs an account of why;
              // reinstating does not. The database enforces the same rule.
              const needsReason =
                ['withdrawn', 'inactive', 'rejected', 'alumni'].includes(status);
              const reason = needsReason
                ? checkReason(textOf(values, 'reason'), `set this membership to ${status}`)
                : textOf(values, 'reason') || null;
              if (needsReason && !reason) return;
              await setMembershipStatus(member.id, status, reason,
                textOf(values, 'internal') || null);
              modal.close();
              toast('Status updated.');
              await draw();
            }, 'primary'))),

        isSuperAdmin(viewer)
          ? panel('Account access',
              h('p', { class: 'mono-meta dim-text' },
                'Disabling stops sign-in. It does not remove the person’s record, ' +
                'history or verified contributions. Write the reason in the ' +
                'Membership status box above — it is recorded permanently.'),
              h('div', { class: 'button-row' },
                action(member.account_state === 'active' ? 'Disable sign-in' : 'Re-enable sign-in',
                  async () => {
                    const next = member.account_state === 'active' ? 'disabled' : 'active';
                    const reason = checkReason(
                      textOf(formValues(statusForm), 'reason'),
                      `${next === 'disabled' ? 'disable' : 're-enable'} this account`);
                    if (!reason) return;
                    await setAccountState(member.id, next, reason);
                    modal.close();
                    toast('Account updated.');
                    await draw();
                  }, member.account_state === 'active' ? 'danger' : 'ghost')))
          : null,
      ));
  }

  async function draw(): Promise<void> {
    const rows = await members(search, statusFilter);

    const searchInput = h('input', {
      type: 'search', placeholder: 'Name, email or student ID…', value: search,
    }) as HTMLInputElement;

    let timer = 0;
    searchInput.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { search = searchInput.value.trim(); void draw(); }, 300);
    });

    const statusSelect = h('select', {},
      h('option', { value: '' }, 'All statuses'),
      STATUSES.map((s) =>
        h('option', { value: s, selected: s === statusFilter }, enumLabel(s)))) as HTMLSelectElement;
    statusSelect.addEventListener('change', () => { statusFilter = statusSelect.value; void draw(); });

    render(content,
      pageHeader('ADMIN / MEMBERS', 'Members',
        h('a', { class: 'btn-ghost', href: '/admin/university-records.html' }, 'University records')),

      h('div', { class: 'browser-toolbar' }, searchInput, statusSelect,
        h('span', { class: 'mono-meta dim-text' }, `${rows.length} SHOWN`)),

      panel('Directory',
        rows.length
          ? dataTable(
              ['Member', 'Student ID', 'Position', 'Status', 'Since', 'Profile', ''],
              rows.map((member) => [
                h('div', {},
                  h('strong', member.full_name),
                  h('p', { class: 'mono-meta dim-text' }, member.email)),
                h('span', { class: 'mono-meta' }, member.student_id ?? '—'),
                h('span', { class: 'mono-meta dim-text' }, member.major ?? '—'),
                statusPill(member.membership?.status),
                h('span', { class: 'mono-meta' }, archiveDate(member.membership?.started_on)),
                h('span', { class: 'mono-meta' },
                  member.profile?.visibility === 'public' ? 'PUBLIC' : 'PRIVATE'),
                h('button', { type: 'button', class: 'link-button',
                  onclick: () => void openMember(member) }, 'MANAGE'),
              ]))
          : emptyState('No members match that.',
              'Members appear here once their application is approved.')),

      notice('info',
        'Bios, links and profile visibility belong to the member and are not edited here. ' +
        'If someone asks for their public profile to be removed, that arrives as a request.'),
    );

    // Restore the caret after a redraw so typing in search is not interrupted.
    if (search) { searchInput.focus(); searchInput.setSelectionRange(search.length, search.length); }
  }

  await draw();
}

void start();
