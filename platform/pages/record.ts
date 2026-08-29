/**
 * My ACM record.
 *
 * The read-only view of everything ACM has verified about this person: what
 * they organised, built, presented and took part in. This is the page a member
 * would show someone as evidence of their work, so it deliberately separates
 * verified items from things still awaiting review.
 */
import { h, render } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statRow, statusPill, dataTable, emptyState, loading, metaList,
} from '../lib/ui.js';
import { requireMember, displayName } from '../lib/session.js';
import { memberStats, myContributions, positionHistory, projects } from '../lib/api.js';
import { myDecisions } from '../lib/audit.js';
import { memberDecisionList } from '../lib/history.js';
import { requireClient } from '../lib/supabase.js';
import { archiveDate, term, enumLabel } from '../lib/format.js';
import type { Participation, Project } from '../lib/types.js';

async function myParticipation(userId: string): Promise<Participation[]> {
  const { data } = await requireClient().from('participations').select('*')
    .eq('user_id', userId).order('started_on', { ascending: false });
  return (data ?? []) as Participation[];
}

async function start(): Promise<void> {
  const viewer = await requireMember();
  const content = shell(viewer, 'member', 'My ACM record');
  render(content, loading());

  const [stats, contributions, history, participation, projectList, decisions] =
    await Promise.all([
      memberStats(viewer.userId),
      myContributions(viewer.userId),
      positionHistory(viewer.userId),
      myParticipation(viewer.userId),
      projects(),
      // Only decisions an admin marked member-visible, through a view that
      // selects an allow-list of columns — no internal notes reach here.
      myDecisions(60).catch(() => []),
    ]);

  const projectTitle = new Map<string, string>(projectList.map((p: Project) => [p.id, p.title]));

  const verified = contributions.filter((c) => c.status === 'approved');
  const pending = contributions.filter((c) => c.status !== 'approved');

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
        ? h('div', { class: 'history-list' },
          history.map((row) => h('div', { class: 'history-row' },
            h('span', { class: 'mono-meta' }, term(row.started_on, row.ended_on)),
            h('div', {}, h('strong', row.title_snapshot),
              row.ended_on ? null : h('span', { class: 'mono-meta accent-text' }, '  CURRENT')))))
        : emptyState('No positions recorded yet.')),

    panel('Verified contributions',
      dataTable(
        ['Title', 'Type', 'Project', 'Date', 'Verified'],
        verified.map((c) => [
          c.title,
          h('span', { class: 'mono-meta' }, enumLabel(c.type_slug)),
          c.project_id ? projectTitle.get(c.project_id) ?? '—' : '—',
          h('span', { class: 'mono-meta' }, archiveDate(c.occurred_on)),
          h('span', { class: 'mono-meta' }, archiveDate(c.verified_at)),
        ]),
        { empty: 'Nothing verified yet. Submitted work appears here once an admin approves it.' },
      )),

    panel('Events and projects taken part in',
      dataTable(
        ['Project or event', 'Role', 'Status', 'Verified'],
        participation.map((p) => [
          projectTitle.get(p.project_id) ?? '—',
          p.role_text,
          statusPill(p.status),
          h('span', { class: 'mono-meta' }, p.verified_at ? archiveDate(p.verified_at) : 'NOT YET'),
        ]),
        { empty: 'No participation recorded yet.' },
      )),

    panel('Decision history',
      h('p', { class: 'mono-meta dim-text' },
        ''),
      memberDecisionList(decisions)),

    pending.length
      ? panel('Still under review',
        metaList(pending.map((c) => [c.title, statusPill(c.status)] as [string, HTMLElement])),
        h('p', { class: 'mono-meta dim-text' },
          'These are not yet part of your verified record.'))
      : null,
  );
}

void start();
