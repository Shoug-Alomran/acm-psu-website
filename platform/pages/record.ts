/** Read-only ACM record for the signed-in person. */
import { h, render } from '../lib/dom.js';
import { shell, pageHeader, panel, statRow, statusPill, dataTable, emptyState, loading, metaList } from '../lib/ui.js';
import { requireMember, displayName } from '../lib/session.js';
import { memberStats, myContributions, positionHistory, projects } from '../lib/api.js';
import { myDecisions } from '../lib/audit.js';
import { memberDecisionList } from '../lib/history.js';
import { requireClient } from '../lib/supabase.js';
import { archiveDate, term, enumLabel } from '../lib/format.js';
import { pageSlice, paginationControls } from '../lib/pagination.js';
import type { Participation, Project } from '../lib/types.js';

const PAGE_SIZE = 7;
type PageKey = 'positions' | 'verified' | 'participation' | 'decisions' | 'pending';

async function myParticipation(userId: string): Promise<Participation[]> {
  const { data } = await requireClient().from('participations').select('*')
    .eq('user_id', userId).order('started_on', { ascending: false });
  return (data ?? []) as Participation[];
}

async function start(): Promise<void> {
  const viewer = await requireMember();
  const content = shell(viewer, 'member', 'My ACM record');
  const pages: Record<PageKey, number> = { positions: 1, verified: 1, participation: 1, decisions: 1, pending: 1 };

  async function draw(): Promise<void> {
    render(content, loading());

    const [stats, contributions, history, participation, projectList, decisions] = await Promise.all([
      memberStats(viewer.userId),
      myContributions(viewer.userId),
      positionHistory(viewer.userId),
      myParticipation(viewer.userId),
      projects(),
      myDecisions(100).catch(() => []),
    ]);

    const projectTitle = new Map<string, string>(projectList.map((p: Project) => [p.id, p.title]));
    const verified = contributions.filter((c) => c.status === 'approved');
    const pending = contributions.filter((c) => c.status !== 'approved');

    const setPage = (key: PageKey, value: number) => {
      pages[key] = value;
      void draw();
    };

    const positionPage = pageSlice(history, pages.positions, PAGE_SIZE);
    const verifiedPage = pageSlice(verified, pages.verified, PAGE_SIZE);
    const participationPage = pageSlice(participation, pages.participation, PAGE_SIZE);
    const decisionPage = pageSlice(decisions, pages.decisions, PAGE_SIZE);
    const pendingPage = pageSlice(pending, pages.pending, PAGE_SIZE);

    render(content,
      pageHeader('MEMBER / RECORD', displayName(viewer),
        h('a', { class: 'btn-ghost', href: '/portal/contributions.html' }, 'Submit a contribution')),

      statRow([
        [stats.events_count, 'Events'],
        [stats.projects_count, 'Projects'],
        [stats.workshops_count, 'Workshops'],
        [stats.verified_contributions, 'Verified contributions'],
      ]),

      panel('Position history',
        history.length
          ? h('div', {},
              h('div', { class: 'history-list' }, positionPage.rows.map((row) =>
                h('div', { class: 'history-row' },
                  h('span', { class: 'mono-meta' }, term(row.started_on, row.ended_on)),
                  h('div', {}, h('strong', row.title_snapshot),
                    row.ended_on ? null : h('span', { class: 'mono-meta accent-text' }, '  CURRENT'))))),
              paginationControls(history.length, positionPage.page, (value) => setPage('positions', value), PAGE_SIZE))
          : emptyState('No positions recorded yet.')),

      panel('Verified contributions',
        dataTable(
          ['Title', 'Type', 'Project', 'Date', 'Verified'],
          verifiedPage.rows.map((c) => [
            c.title,
            h('span', { class: 'mono-meta' }, enumLabel(c.type_slug)),
            c.project_id ? projectTitle.get(c.project_id) ?? '—' : '—',
            h('span', { class: 'mono-meta' }, archiveDate(c.occurred_on)),
            h('span', { class: 'mono-meta' }, archiveDate(c.verified_at)),
          ]),
          { empty: 'Nothing verified yet. Submitted work appears here once an admin approves it.' },
        ),
        paginationControls(verified.length, verifiedPage.page, (value) => setPage('verified', value), PAGE_SIZE)),

      panel('Events and projects taken part in',
        dataTable(
          ['Project or event', 'Role', 'Status', 'Verified'],
          participationPage.rows.map((p) => [
            projectTitle.get(p.project_id) ?? '—',
            p.role_text,
            statusPill(p.status),
            h('span', { class: 'mono-meta' }, p.verified_at ? archiveDate(p.verified_at) : 'NOT YET'),
          ]),
          { empty: 'No participation recorded yet.' },
        ),
        paginationControls(participation.length, participationPage.page,
          (value) => setPage('participation', value), PAGE_SIZE)),

      panel('Decision history',
        memberDecisionList(decisionPage.rows),
        paginationControls(decisions.length, decisionPage.page, (value) => setPage('decisions', value), PAGE_SIZE)),

      pending.length
        ? panel('Still under review',
            metaList(pendingPage.rows.map((c) => [c.title, statusPill(c.status)] as [string, HTMLElement])),
            paginationControls(pending.length, pendingPage.page, (value) => setPage('pending', value), PAGE_SIZE),
            h('p', { class: 'mono-meta dim-text' }, 'These are not yet part of your verified record.'))
        : null,
    );
  }

  await draw();
}

void start();
