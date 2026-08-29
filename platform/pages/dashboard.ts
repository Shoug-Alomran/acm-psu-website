/**
 * Member dashboard.
 *
 * Two halves, mirroring the rule the whole platform is built on: what the
 * member controls (profile, visibility, interests, links) and what ACM has
 * verified (status, position, events, contributions). Every number shown is
 * read from member_stats, which derives it from stored records — nothing here
 * is a counter that could drift away from the archive behind it.
 */
import { h, render } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statRow, statusPill, metaList, emptyState, loading, notice,
} from '../lib/ui.js';
import { requireMember, isStaff, displayName, type Viewer } from '../lib/session.js';
import {
  memberStats, positionHistory, myContributions, myRequests, mySubmissions,
  myEventApplications, myPositionRequest, openOpportunities,
} from '../lib/api.js';
import { myDecisions } from '../lib/audit.js';
import { memberDecisionList } from '../lib/history.js';
import { archiveDate, term, enumLabel } from '../lib/format.js';
import type { Contribution, MemberRequest, PositionHistoryRow } from '../lib/types.js';

function yearsActive(startedOn: string | null, endedOn: string | null): string {
  if (!startedOn) return '—';
  const start = new Date(startedOn).getUTCFullYear();
  const end = endedOn ? new Date(endedOn).getUTCFullYear() : new Date().getUTCFullYear();
  return start === end ? String(start) : `${start}–${end}`;
}

function historyList(rows: PositionHistoryRow[]) {
  if (!rows.length) {
    return emptyState('No positions recorded yet.',
      'Your first position is added when an admin approves it.');
  }
  return h('div', { class: 'history-list' },
    rows.map((row) => h('div', { class: 'history-row' },
      h('span', { class: 'mono-meta' }, term(row.started_on, row.ended_on)),
      h('div', {},
        h('strong', row.title_snapshot),
        row.ended_on ? null : h('span', { class: 'mono-meta accent-text' }, '  CURRENT'),
        row.note ? h('p', { class: 'mono-meta dim-text' }, row.note) : null))));
}

function pendingList(
  requests: MemberRequest[],
  positionRequest: { status: string; requested_title: string | null } | null,
  eventApplications: Array<{ status: string; position: { title: string } | null }>,
) {
  const items: Array<[string, string]> = [];

  for (const request of requests) {
    if (request.status === 'pending') items.push([enumLabel(request.kind), 'Awaiting a decision']);
  }
  if (positionRequest?.status === 'pending') {
    items.push(['POSITION CHANGE',
      positionRequest.requested_title ?? 'Awaiting a decision']);
  }
  for (const application of eventApplications) {
    if (application.status === 'pending') {
      items.push(['EVENT POSITION', application.position?.title ?? 'Awaiting a decision']);
    }
  }

  if (!items.length) return emptyState('Nothing waiting on an admin.');
  return metaList(items.map(([label, value]) => [label, value] as [string, string]));
}

function recentContributions(rows: Contribution[]) {
  if (!rows.length) {
    return emptyState('No contributions submitted yet.',
      'Submit work you have done for the club and an admin will verify it.');
  }
  return h('div', { class: 'history-list' },
    rows.slice(0, 6).map((row) => h('div', { class: 'history-row' },
      h('span', { class: 'mono-meta' }, archiveDate(row.occurred_on ?? row.created_at)),
      h('div', {},
        h('strong', row.title), ' ', statusPill(row.status),
        row.review_note ? h('p', { class: 'mono-meta dim-text' }, row.review_note) : null))));
}

async function start(): Promise<void> {
  const viewer: Viewer = await requireMember();
  const content = shell(viewer, 'member', 'Dashboard');
  render(content, loading('LOADING YOUR RECORD'));

  const denied = new URLSearchParams(window.location.search).has('denied');

  const [stats, history, contributions, requests, submissions, eventApps, positionRequest,
         opportunities, decisions] = await Promise.all([
    memberStats(viewer.userId),
    positionHistory(viewer.userId),
    myContributions(viewer.userId),
    myRequests(viewer.userId),
    mySubmissions(viewer.userId),
    myEventApplications(viewer.userId),
    myPositionRequest(viewer.userId),
    openOpportunities().catch(() => []),
    myDecisions(8).catch(() => []),
  ]);

  const membership = viewer.membership;
  const profile = viewer.profile;

  render(content,
    pageHeader(
      `MEMBER / ${enumLabel(membership?.status)}`,
      displayName(viewer),
      h('a', { class: 'btn-ghost', href: '/portal/profile.html' }, 'Edit profile'),
      isStaff(viewer) ? h('a', { class: 'btn-ghost', href: '/admin/index.html' }, 'Admin console') : null,
    ),

    denied ? notice('warn', 'That page needs an admin role you do not hold.') : null,

    statRow([
      [stats.events_count, 'Events'],
      [stats.projects_count, 'Projects'],
      [stats.workshops_count, 'Workshops'],
      [stats.verified_contributions, 'Verified contributions'],
    ]),

    h('div', { class: 'panel-grid' },
      panel('ACM record',
        h('p', { class: 'mono-meta dim-text' },
          'Verified by ACM. These fields are maintained by admins.'),
        metaList([
          ['Status', statusPill(membership?.status)],
          ['Current position', viewer.currentPosition ?? 'Member'],
          ['Years active', yearsActive(membership?.started_on ?? null, membership?.ended_on ?? null)],
          ['Member since', archiveDate(membership?.started_on)],
          ['Chapter', membership?.chapter_year ?? '—'],
          ['Record ID', membership?.member_no ?? '—'],
        ])),

      panel('Your profile',
        h('p', { class: 'mono-meta dim-text' },
          'Yours to change at any time, without asking anyone.'),
        metaList([
          ['Visibility', statusPill(profile?.visibility === 'public' ? 'active' : 'inactive')],
          ['Public listing', profile?.visibility === 'public'
            ? 'Shown on the ACM team page' : 'Not shown publicly'],
          ['Academic year', profile?.academic_year ?? '—'],
          ['Interests', profile?.interests.length ? profile.interests.join(', ') : '—'],
          ['Links', [profile?.linkedin_url && 'LinkedIn', profile?.github_url && 'GitHub',
                     profile?.website_url && 'Website'].filter(Boolean).join(', ') || '—'],
        ]),
        h('div', { class: 'button-row' },
          h('a', { class: 'btn-ghost', href: '/portal/profile.html' }, 'Edit'),
          h('a', { class: 'btn-ghost', href: '/portal/requests.html' }, 'Privacy & membership'))),
    ),

    panel('Position history', historyList(history)),

    h('div', { class: 'panel-grid' },
      panel('Recent contributions',
        recentContributions(contributions),
        h('div', { class: 'button-row' },
          h('a', { class: 'btn-ghost', href: '/portal/contributions.html' }, 'All contributions'),
          h('a', { class: 'btn-ghost', href: '/portal/record.html' }, 'My verified record'))),

      panel('Waiting on ACM',
        pendingList(requests, positionRequest, eventApps as Array<{ status: string; position: { title: string } | null }>),
        h('div', { class: 'button-row' },
          h('a', { class: 'btn-ghost', href: '/portal/requests.html' }, 'Make a request'))),
    ),

    panel('Archive submissions',
      submissions.length
        ? metaList(submissions.slice(0, 5).map((s) =>
            [s.title, statusPill(s.status)] as [string, HTMLElement]))
        : emptyState('You have not submitted anything to the archive yet.',
            'Workshop material, posters, reports and source code all belong in the archive.'),
      h('div', { class: 'button-row' },
        h('a', { class: 'btn-ghost', href: '/portal/submissions.html' }, 'Submit to the archive'))),

    decisions.length
      ? panel('Recent decisions about you',
          memberDecisionList(decisions),
          h('div', { class: 'button-row' },
            h('a', { class: 'btn-ghost', href: '/portal/record.html' },
              'Full decision history')))
      : null,

    opportunities.length
      ? panel('Open positions on ACM events',
          metaList(opportunities.slice(0, 5).map((o) =>
            [o.title, `${o.remaining} of ${o.openings} open — ${o.project?.title ?? ''}`] as [string, string])),
          h('div', { class: 'button-row' },
            h('a', { class: 'btn-ghost', href: '/portal/opportunities.html' }, 'See all opportunities')))
      : null,
  );
}

void start();
