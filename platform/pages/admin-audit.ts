/**
 * Admin audit and decision history.
 *
 * The page a future ACM committee opens to answer "who decided this, and why".
 * Every row carries the actor as they were at the time — name, ACM position
 * and admin role — because resolving an old decision against a current profile
 * would misattribute it the moment anyone's role changes.
 *
 * Nothing on this page can edit or delete an entry. The audit log rejects both
 * at the database level, for every role, so there is no such control to build.
 */
import { h, render } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statRow, statusPill, dataTable, loading, dialog,
  metaList, notice, emptyState, toast, action,
} from '../lib/ui.js';
import { requireAdmin, isClubAdmin } from '../lib/session.js';
import {
  auditEntries, auditSummary, auditActors, exportAuditCsv, actorLine,
  CATEGORY_LABELS, DECISION_LABELS,
} from '../lib/audit.js';
import { changeList, historyEntry } from '../lib/history.js';
import { projects } from '../lib/api.js';
import { archiveDateTime, relativeTime, enumLabel } from '../lib/format.js';
import type {
  AuditCategory, AuditDecision, AuditEntry, AuditFilters, Project,
} from '../lib/types.js';

const CATEGORIES: Array<AuditCategory | ''> = [
  '', 'membership', 'positions', 'events', 'projects', 'contributions',
  'archive', 'requests', 'administration', 'exports',
];

async function start(): Promise<void> {
  const viewer = await requireAdmin('reviewer');
  const content = shell(viewer, 'admin', 'Audit history');
  render(content, loading('LOADING AUDIT HISTORY'));

  const fullAccess = isClubAdmin(viewer);
  const [actors, projectList] = await Promise.all([
    auditActors().catch(() => []),
    projects().catch((): Project[] => []),
  ]);
  const projectTitle = new Map(projectList.map((p) => [p.id, p.title]));

  const filters: AuditFilters = { limit: 300 };
  let loaded: AuditEntry[] = [];

  /* ------------------------------------------------------------- detail */
  function openEntry(entry: AuditEntry): void {
    const related: Array<[string, string]> = [];
    if (entry.related_member_id) related.push(['Member', entry.related_member_id]);
    if (entry.related_project_id) {
      related.push(['Project', projectTitle.get(entry.related_project_id)
        ?? entry.related_project_id]);
    }
    if (entry.related_request_id) related.push(['Request', entry.related_request_id]);

    const changes = changeList(entry);

    dialog(entry.summary || enumLabel(entry.action),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.5rem' } },

        h('div', { class: 'audit-detail-section', style: { borderTop: 'none', paddingTop: '0' } },
          h('span', { class: 'mono-meta' }, 'WHO'),
          metaList([
            ['Name', entry.actor_name ?? enumLabel(entry.actor_kind)],
            ['Position at the time', entry.actor_position ?? '—'],
            ['Admin role at the time', entry.actor_role ? enumLabel(entry.actor_role) : '—'],
            ['Chapter', entry.actor_chapter_year ?? '—'],
            ['Acting as', enumLabel(entry.actor_kind)],
          ]),
          entry.actor_kind === 'ai_assistant'
            ? notice('warn',
                'This entry records a suggestion, not a decision. The assistant ' +
                'cannot approve or publish anything — look for the admin entry ' +
                'that follows it.')
            : null),

        h('div', { class: 'audit-detail-section' },
          h('span', { class: 'mono-meta' }, 'WHAT'),
          metaList([
            ['Action', h('span', { class: 'mono-meta accent-text' }, entry.action)],
            ['Category', CATEGORY_LABELS[entry.category] ?? entry.category],
            ['Target', entry.entity_label ?? '—'],
            ['Target type', entry.entity_type ?? '—'],
            ['Decision', entry.decision ? statusPill(entry.decision) : '—'],
          ])),

        h('div', { class: 'audit-detail-section' },
          h('span', { class: 'mono-meta' }, 'WHY'),
          entry.reason
            ? h('p', { class: 'history-reason' }, entry.reason)
            : h('p', { class: 'mono-meta dim-text' }, 'NO REASON RECORDED'),
          // Reviewers only ever see their own entries, so the internal note
          // on one of those is already theirs.
          entry.internal_note
            ? h('p', { class: 'history-internal' },
                h('span', { class: 'mono-meta' }, 'INTERNAL  '), entry.internal_note)
            : null),

        changes
          ? h('div', { class: 'audit-detail-section' },
              h('span', { class: 'mono-meta' }, 'CHANGES'), changes)
          : null,

        related.length
          ? h('div', { class: 'audit-detail-section' },
              h('span', { class: 'mono-meta' }, 'CONTEXT'),
              metaList(related.map(([label, value]) =>
                [label, h('span', { class: 'mono-meta' }, value)] as [string, HTMLElement])))
          : null,

        h('div', { class: 'audit-detail-section' },
          h('span', { class: 'mono-meta' }, 'SYSTEM'),
          metaList([
            ['Audit ID', h('span', { class: 'mono-meta' }, String(entry.id))],
            ['Timestamp', archiveDateTime(entry.created_at)],
            ['Visible to the member', entry.member_visible ? 'Yes' : 'No'],
            ['Correlation', h('span', { class: 'mono-meta dim-text' },
              entry.correlation_id ?? '—')],
          ]),
          Object.keys(entry.metadata).length
            ? h('pre', {
                class: 'mono-meta dim-text',
                style: { whiteSpace: 'pre-wrap', marginTop: '0.75rem', fontSize: '0.7rem' },
              }, JSON.stringify(entry.metadata, null, 2))
            : null),

        entry.correlation_id
          ? h('div', { class: 'audit-detail-section' },
              h('span', { class: 'mono-meta' }, 'SAME TRANSACTION'),
              h('div', { class: 'history-trail' },
                loaded
                  .filter((other) => other.correlation_id === entry.correlation_id
                                     && other.id !== entry.id)
                  .map((other) => historyEntry(other, { compact: true }))),
              loaded.filter((o) => o.correlation_id === entry.correlation_id).length < 2
                ? h('p', { class: 'mono-meta dim-text' }, 'NO OTHER CHANGES IN THIS TRANSACTION')
                : null)
          : null,
      ));
  }

  /* --------------------------------------------------------------- draw */
  async function draw(): Promise<void> {
    const [entries, summary] = await Promise.all([
      auditEntries(filters),
      auditSummary(30).catch(() => null),
    ]);
    loaded = entries;

    const searchInput = h('input', {
      type: 'search', placeholder: 'Search actions, people, reasons…',
      value: filters.search ?? '', 'aria-label': 'Search the audit history',
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
      onChange: (value: string) => void,
    ): HTMLSelectElement => {
      const el = h('select', { 'aria-label': label },
        options.map((option) =>
          h('option', { value: option.value, selected: option.value === (value ?? '') },
            option.label))) as HTMLSelectElement;
      el.addEventListener('change', () => onChange(el.value));
      return el;
    };

    const fromInput = h('input', {
      type: 'date', value: filters.from ?? '', 'aria-label': 'From date',
    }) as HTMLInputElement;
    fromInput.addEventListener('change', () => {
      filters.from = fromInput.value || undefined; void draw();
    });

    const toInput = h('input', {
      type: 'date', value: filters.to ?? '', 'aria-label': 'To date',
    }) as HTMLInputElement;
    toInput.addEventListener('change', () => {
      filters.to = toInput.value || undefined; void draw();
    });

    render(content,
      pageHeader('ADMIN / AUDIT', 'Audit & decision history',
        fullAccess
          ? action('Export CSV', async () => {
              if (!loaded.length) { toast('Nothing to export with these filters.', 'err'); return; }
              exportAuditCsv(loaded);
              toast(`Exported ${loaded.length} entries.`);
            })
          : null),

      fullAccess
        ? null
        : notice('info',
            'You are signed in as a reviewer, so this page shows the actions you ' +
            'performed. Club admins see the full history.'),

      summary
        ? statRow([
            [summary.total_actions, 'Actions this month'],
            [summary.approvals, 'Approvals'],
            [summary.rejections, 'Rejections'],
            [summary.changes_requested, 'Changes requested'],
            [summary.active_admins, 'Admins active'],
          ])
        : null,

      h('div', { class: 'browser-toolbar' },
        searchInput,
        select('Category', filters.category,
          CATEGORIES.map((c) => ({ value: c, label: c ? CATEGORY_LABELS[c] : 'All categories' })),
          (value) => { filters.category = value as AuditCategory | ''; void draw(); }),
        select('Decision', filters.decision,
          [{ value: '', label: 'All decisions' },
           ...Object.entries(DECISION_LABELS).map(([value, label]) => ({ value, label }))],
          (value) => { filters.decision = value as AuditDecision | ''; void draw(); }),
        fullAccess
          ? select('Admin', filters.actorId,
              [{ value: '', label: 'All admins' },
               ...actors.map((a) => ({ value: a.id, label: a.name }))],
              (value) => { filters.actorId = value || undefined; void draw(); })
          : null,
        select('Project', filters.projectId,
          [{ value: '', label: 'All projects' },
           ...projectList.map((p) => ({ value: p.id, label: p.title }))],
          (value) => { filters.projectId = value || undefined; void draw(); }),
        fromInput, toInput,
        h('button', { type: 'button', class: 'btn-ghost',
          onclick: () => {
            filters.search = undefined; filters.category = ''; filters.decision = '';
            filters.actorId = undefined; filters.projectId = undefined;
            filters.from = undefined; filters.to = undefined;
            void draw();
          } }, 'Reset'),
        h('span', { class: 'mono-meta dim-text' }, `${entries.length} ENTRIES`)),

      panel('History',
        entries.length
          ? dataTable(
              ['When', 'Admin', 'Action', 'Target', 'Decision', 'Reason'],
              entries.map((entry) => [
                h('div', { class: 'audit-actor' },
                  h('span', { class: 'mono-meta' }, archiveDateTime(entry.created_at)),
                  h('span', { class: 'mono-meta' }, relativeTime(entry.created_at))),
                h('div', { class: 'audit-actor' },
                  h('strong', entry.actor_name ?? enumLabel(entry.actor_kind)),
                  h('span', { class: 'mono-meta' },
                    [entry.actor_position, entry.actor_role ? enumLabel(entry.actor_role) : null]
                      .filter(Boolean).join(' · ') || enumLabel(entry.actor_kind))),
                h('div', {},
                  h('span', { class: 'mono-meta accent-text' }, entry.action),
                  h('p', { class: 'mono-meta dim-text' },
                    CATEGORY_LABELS[entry.category] ?? entry.category)),
                h('div', {},
                  h('strong', entry.entity_label ?? '—'),
                  h('p', { class: 'mono-meta dim-text' }, entry.summary.slice(0, 90))),
                entry.decision ? statusPill(entry.decision)
                  : h('span', { class: 'mono-meta dim-text' }, '—'),
                h('div', {},
                  entry.reason
                    ? h('span', entry.reason.slice(0, 80) +
                        (entry.reason.length > 80 ? '…' : ''))
                    : h('span', { class: 'mono-meta dim-text' }, 'NONE'),
                  h('p', {},
                    h('button', { type: 'button', class: 'link-button',
                      onclick: () => openEntry(entry) }, 'DETAILS'))),
              ]))
          : emptyState('No entries match these filters.',
              'Try widening the date range or clearing the category filter.')),

      notice('info',
        'The audit log is append-only. Entries cannot be edited or deleted by ' +
        'anyone, including super admins — the database rejects both. To correct ' +
        'a record, perform the corrective action so it is recorded in turn.'),
    );

    if (filters.search) {
      searchInput.focus();
      searchInput.setSelectionRange(filters.search.length, filters.search.length);
    }
  }

  await draw();
}

void start();
