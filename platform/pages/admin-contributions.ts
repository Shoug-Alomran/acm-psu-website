/**
 * Contribution review.
 *
 * Four outcomes, matching how review actually goes: approve, edit and approve,
 * ask for changes, or decline. "Edit and approve" exists because the common
 * case is a real contribution described too vaguely — rejecting that would be
 * the wrong answer.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, dataTable, loading, dialog, field,
  metaList, notice, toast, action, emptyState, reasonField, internalNoteField,
  checkReason,
} from '../lib/ui.js';
import { historyPanel } from '../lib/history.js';
import { requireAdmin } from '../lib/session.js';
import { verifyContribution, decideContribution } from '../lib/admin.js';
import { reviewQueue, contributionTypes, projects, signedUrl } from '../lib/api.js';
import { requireClient } from '../lib/supabase.js';
import { archiveDate, enumLabel } from '../lib/format.js';
import type { ContributionType, Project, ReviewStatus } from '../lib/types.js';

const FILTERS: Array<[string, ReviewStatus[]]> = [
  ['Awaiting review', ['submitted']],
  ['Changes requested', ['changes_requested']],
  ['Verified', ['approved']],
  ['Declined', ['rejected']],
];

interface Evidence {
  id: string; storage_bucket: string | null; storage_path: string | null;
  external_url: string | null; file_name: string | null;
}

async function start(): Promise<void> {
  const viewer = await requireAdmin('reviewer');
  const content = shell(viewer, 'admin', 'Contribution review');
  render(content, loading());

  const [types, projectList] = await Promise.all([contributionTypes(), projects()]);
  const projectTitle = new Map(projectList.map((p: Project) => [p.id, p.title]));
  let filter = 0;

  async function review(row: Awaited<ReturnType<typeof reviewQueue>>[number]): Promise<void> {
    const { data: evidenceRows } = await requireClient().from('contribution_evidence')
      .select('*').eq('contribution_id', row.id);
    const evidence = (evidenceRows ?? []) as Evidence[];

    const form = h('form', { class: 'portal-form' },
      field({ label: 'Title', name: 'title', value: row.title, maxlength: 200 }),
      h('div', { class: 'field-pair' },
        field({ label: 'Type', name: 'type_slug', type: 'select', value: row.type_slug,
                options: types.map((t: ContributionType) => ({ value: t.slug, label: t.label })) }),
        field({ label: 'Project', name: 'project_id', type: 'select',
                value: row.project_id ?? '',
                options: [{ value: '', label: '— none —' },
                  ...projectList.map((p: Project) => ({ value: p.id, label: p.title }))] })),
      field({ label: 'Role', name: 'role_text', value: row.role_text, maxlength: 120 }),
      field({ label: 'Description', name: 'description', type: 'textarea', rows: 4,
              value: row.description }),
      reasonField({
        hint: 'Required when asking for changes or declining. Shown to the ' +
              'member and kept on the audit record.',
      }),
      internalNoteField(),
    ) as HTMLFormElement;

    const edits = () => {
      const values = formValues(form);
      return {
        title: textOf(values, 'title'),
        type: textOf(values, 'type_slug'),
        role: textOf(values, 'role_text') || null,
        description: textOf(values, 'description') || null,
        project: textOf(values, 'project_id') || null,
      };
    };

    const modal = dialog(`Review — ${row.title}`,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.5rem' } },
        metaList([
          ['Member', row.member?.full_name ?? '—'],
          ['Email', row.member?.email ?? '—'],
          ['Submitted', archiveDate(row.created_at)],
          ['Date of work', archiveDate(row.occurred_on)],
          ['Status', statusPill(row.status)],
          ['Links', row.links.length
            ? h('div', {}, row.links.map((link) =>
                h('p', h('a', { href: link, rel: 'noopener noreferrer', target: '_blank' }, link))))
            : '—'],
          ['Member note', row.member_note ?? '—'],
        ]),

        evidence.length
          ? h('div', {},
              h('p', { class: 'mono-meta dim-text' }, 'EVIDENCE'),
              h('div', { class: 'button-row' },
                evidence.map((file) => action(file.file_name ?? 'OPEN FILE', async () => {
                  const url = file.external_url ?? (file.storage_bucket && file.storage_path
                    ? await signedUrl(file.storage_bucket, file.storage_path) : null);
                  if (url) window.open(url, '_blank', 'noopener');
                  else toast('Could not open that file.', 'err');
                }))))
          : null,

        h('p', { class: 'mono-meta dim-text' },
          'CORRECT ANYTHING BELOW BEFORE APPROVING — THE EDITED TEXT IS WHAT GETS VERIFIED'),
        form,
        historyPanel('contribution', row.id, row.user_id)),

      h('div', { class: 'button-row' },
        action('Verify', async () => {
          const values = formValues(form);
          await verifyContribution(row.id, edits(), textOf(values, 'reason') || null);
          modal.close();
          toast('Contribution verified.');
          await draw();
        }, 'primary'),

        action('Request changes', async () => {
          const values = formValues(form);
          const reason = checkReason(textOf(values, 'reason'), 'ask for changes');
          if (!reason) return;
          await decideContribution(row.id, 'changes_requested', reason,
            textOf(values, 'internal') || null);
          modal.close();
          toast('Sent back to the member.');
          await draw();
        }),

        action('Decline', async () => {
          const values = formValues(form);
          const reason = checkReason(textOf(values, 'reason'), 'decline this contribution');
          if (!reason) return;
          await decideContribution(row.id, 'rejected', reason,
            textOf(values, 'internal') || null);
          modal.close();
          toast('Declined.');
          await draw();
        }, 'danger')));
  }

  async function draw(): Promise<void> {
    const rows = await reviewQueue(FILTERS[filter]![1]);

    render(content,
      pageHeader('ADMIN / CONTRIBUTIONS', 'Contribution review'),

      h('div', { class: 'browser-toolbar' },
        FILTERS.map(([label], index) =>
          h('button', {
            type: 'button', class: 'btn-ghost',
            style: index === filter
              ? { borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' } : {},
            onclick: () => { filter = index; void draw(); },
          }, label))),

      panel(`${rows.length} in this queue`,
        rows.length
          ? dataTable(['Member', 'Contribution', 'Type', 'Project', 'Date', 'Status', ''],
              rows.map((row) => [
                h('div', {},
                  h('strong', row.member?.full_name ?? '—'),
                  h('p', { class: 'mono-meta dim-text' }, row.member?.email ?? '')),
                h('div', {},
                  h('strong', row.title),
                  row.description
                    ? h('p', { class: 'mono-meta dim-text' }, row.description.slice(0, 120))
                    : null),
                h('span', { class: 'mono-meta' }, enumLabel(row.type_slug)),
                row.project_id ? projectTitle.get(row.project_id) ?? '—' : '—',
                h('span', { class: 'mono-meta' }, archiveDate(row.occurred_on)),
                statusPill(row.status),
                h('button', { type: 'button', class: 'link-button',
                  onclick: () => void review(row) }, 'REVIEW'),
              ]))
          : emptyState('This queue is clear.')),

      notice('info',
        'Verifying a contribution puts it on the member’s permanent ACM record. ' +
        'Correct the wording rather than declining work that genuinely happened.'),
    );
  }

  await draw();
}

void start();
