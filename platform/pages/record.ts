/** Read-only ACM record for the signed-in person. */
import { h, render } from '../lib/dom.js';
import { shell, pageHeader, panel, statRow, statusPill, filterableTable, emptyState, loading } from '../lib/ui.js';
import { requireMember, displayName } from '../lib/session.js';
import { memberStats, myContributions, positionHistory, projects } from '../lib/api.js';
import { myDecisions } from '../lib/audit.js';
import { memberDecisionList } from '../lib/history.js';
import { requireClient } from '../lib/supabase.js';
import { archiveDate, term, enumLabel } from '../lib/format.js';
import { pageSlice, paginationControls } from '../lib/pagination.js';
import type { Participation, Project } from '../lib/types.js';

const PAGE_SIZE = 7;
type PageKey = 'positions' | 'decisions';

async function myParticipation(userId: string): Promise<Participation[]> {
  const { data } = await requireClient().from('participations').select('*')
    .eq('user_id', userId).order('started_on', { ascending: false });
  return (data ?? []) as Participation[];
}

async function start(): Promise<void> {
  const viewer = await requireMember();
  const content = shell(viewer, 'member', 'My ACM record');
  const pages: Record<PageKey, number> = { positions: 1, decisions: 1 };

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

    const setPage = (key: PageKey, value: number) => {
      pages[key] = value;
      void draw();
    };

    const positionPage = pageSlice(history, pages.positions, PAGE_SIZE);
    const decisionPage = pageSlice(decisions, pages.decisions, PAGE_SIZE);

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
        filterableTable(
          ['Title', 'Type', 'Project', 'Date', 'Verified'],
          verified.map((c) => [
            c.title,
            h('span', { class: 'mono-meta' }, enumLabel(c.type_slug)),
            c.project_id ? projectTitle.get(c.project_id) ?? '—' : '—',
            h('span', { class: 'mono-meta' }, archiveDate(c.occurred_on)),
            h('span', { class: 'mono-meta' }, archiveDate(c.verified_at)),
          ]),
          { empty: 'Nothing verified yet. Submitted work appears here once an admin approves it.' },
        ),
        null),

      panel('Events and projects taken part in',
        filterableTable(
          ['Project or event', 'Role', 'Status', 'Verified'],
          participation.map((p) => [
            projectTitle.get(p.project_id) ?? '—',
            p.role_text,
            statusPill(p.status),
            h('span', { class: 'mono-meta' }, p.verified_at ? archiveDate(p.verified_at) : 'NOT YET'),
          ]),
          { empty: 'No participation recorded yet.' },
        ),
        null),

      panel('Decision history',
        memberDecisionList(decisionPage.rows),
        paginationControls(decisions.length, decisionPage.page, (value) => setPage('decisions', value), PAGE_SIZE)),


    );
  }

  await draw();
}

void start();
