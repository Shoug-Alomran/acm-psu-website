/**
 * Member dashboard.
 *
 * Two halves, mirroring the rule the whole platform is built on: what the
 * member controls (profile, visibility, interests, links) and what ACM has
 * verified (status, position, events, contributions).
 *
 * Every number shown is read from member_stats, which derives it from stored
 * records — nothing here is a counter that could drift away from the archive
 * behind it.
 */

import {
  h,
  render,
} from '../lib/dom.js';

import {
  shell,
  pageHeader,
  panel,
  statRow,
  statusPill,
  metaList,
  emptyState,
  loading,
  notice,
} from '../lib/ui.js';

import {
  requireMember,
  isStaff,
  displayName,
  type Viewer,
} from '../lib/session.js';

import {
  memberStats,
  positionHistory,
  myContributions,
  myRequests,
  mySubmissions,
  myEventApplications,
  myPositionRequest,
  openOpportunities,
} from '../lib/api.js';

import {
  myDecisions,
} from '../lib/audit.js';

import {
  memberDecisionList,
} from '../lib/history.js';

import {
  archiveDate,
  term,
  enumLabel,
} from '../lib/format.js';

import type {
  Contribution,
  MemberRequest,
  PositionHistoryRow,
} from '../lib/types.js';

interface DashboardEventApplication {
  status: string;
  position_title: string;
}

function errorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (
      error as {
        message?: unknown;
      }
    ).message === 'string'
  ) {
    return (
      error as {
        message: string;
      }
    ).message;
  }

  return 'An unknown error occurred.';
}

function yearsActive(
  startedOn: string | null,
  endedOn: string | null,
): string {
  if (!startedOn) {
    return '—';
  }

  const started =
    new Date(
      startedOn,
    );

  if (
    Number.isNaN(
      started.getTime(),
    )
  ) {
    return '—';
  }

  const start =
    started.getUTCFullYear();

  let end =
    new Date()
      .getUTCFullYear();

  if (endedOn) {
    const ended =
      new Date(
        endedOn,
      );

    if (
      !Number.isNaN(
        ended.getTime(),
      )
    ) {
      end =
        ended.getUTCFullYear();
    }
  }

  return start === end
    ? String(
      start,
    )
    : `${start}–${end}`;
}

function historyList(
  rows:
    PositionHistoryRow[],
): HTMLElement {
  if (
    !rows.length
  ) {
    return emptyState(
      'No positions recorded yet.',
      'Your first position is added when an admin approves it.',
    );
  }

  return h(
    'div',
    {
      class:
        'history-list',
    },

    rows.map(
      (
        row,
      ) =>
        h(
          'div',
          {
            class:
              'history-row',
          },

          h(
            'span',
            {
              class:
                'mono-meta',
            },
            term(
              row.started_on,
              row.ended_on,
            ),
          ),

          h(
            'div',
            {},

            h(
              'strong',
              row.title_snapshot,
            ),

            row.ended_on
              ? null
              : h(
                'span',
                {
                  class:
                    'mono-meta accent-text',
                },
                '  CURRENT',
              ),

            row.note
              ? h(
                'p',
                {
                  class:
                    'mono-meta dim-text',
                },
                row.note,
              )
              : null,
          ),
        ),
    ),
  );
}

function pendingList(
  requests:
    MemberRequest[],

  positionRequest: {
    status: string;
    requested_title:
    string |
    null;
  } | null,

  eventApplications:
    DashboardEventApplication[],
): HTMLElement {
  const items:
    Array<
      [
        string,
        string,
      ]
    > = [];

  for (
    const request
    of requests
  ) {
    if (
      request.status ===
      'pending'
    ) {
      items.push([
        enumLabel(
          request.kind,
        ),
        'Awaiting a decision',
      ]);
    }
  }

  if (
    positionRequest?.status ===
    'pending'
  ) {
    items.push([
      'POSITION CHANGE',

      positionRequest
        .requested_title ??
      'Awaiting a decision',
    ]);
  }

  for (
    const application
    of eventApplications
  ) {
    if (
      application.status ===
      'pending'
    ) {
      items.push([
        'EVENT POSITION',

        application.position_title ||
        'Awaiting a decision',
      ]);
    }
  }

  if (
    !items.length
  ) {
    return emptyState(
      'Nothing waiting on an admin.',
    );
  }

  return metaList(
    items.map(
      (
        [
          label,
          value,
        ],
      ) =>
        [
          label,
          value,
        ] as [
          string,
          string,
        ],
    ),
  );
}

function recentContributions(
  rows:
    Contribution[],
): HTMLElement {
  if (
    !rows.length
  ) {
    return emptyState(
      'No contributions submitted yet.',
      'Submit work you have done for the club and an admin will verify it.',
    );
  }

  return h(
    'div',
    {
      class:
        'contribution-preview',
    },

    rows
      .slice(
        0,
        6,
      )
      .map(
        (
          row,
        ) =>
          h(
            'div',
            {
              class:
                'contribution-preview__row',
            },

            h(
              'span',
              {
                class:
                  'mono-meta',
              },
              archiveDate(
                row.occurred_on ??
                row.created_at,
              ),
            ),

            h(
              'div',
              { class: 'contribution-preview__detail' },

              h(
                'strong',
                row.title,
              ),

              ' ',

              statusPill(
                row.status,
              ),

              row.review_note
                ? h(
                  'p',
                  {
                    class:
                      'contribution-preview__note',
                  },
                  row.review_note,
                )
                : null,
            ),
          ),
      ),
  );
}

async function start(): Promise<void> {
  const viewer:
    Viewer =
    await requireMember();

  const content =
    shell(
      viewer,
      'member',
      'Dashboard',
    );

  const denied =
    new URLSearchParams(
      window.location.search,
    ).has(
      'denied',
    );

  async function draw(): Promise<void> {
    render(
      content,
      loading(
        'LOADING YOUR RECORD',
      ),
    );

    try {
      /*
       * These are the core parts of the member record. If one of these fails,
       * showing a partially authoritative ACM record would be misleading, so
       * the dashboard itself enters an error state.
       */
      const [
        stats,
        history,
        contributions,
        requests,
        submissions,
        eventAppsRaw,
        positionRequest,
      ] =
        await Promise.all([
          memberStats(
            viewer.userId,
          ),

          positionHistory(
            viewer.userId,
          ),

          myContributions(
            viewer.userId,
          ),

          myRequests(
            viewer.userId,
          ),

          mySubmissions(
            viewer.userId,
          ),

          myEventApplications(),

          myPositionRequest(
            viewer.userId,
          ),
        ]);

      /*
       * These are useful dashboard additions, but neither is part of the
       * authoritative member record. Their failure should not take down the
       * dashboard.
       */
      const [
        opportunities,
        decisions,
      ] =
        await Promise.all([
          openOpportunities()
            .catch(
              (
                error,
              ) => {
                console.error(
                  'Could not load member opportunities:',
                  error,
                );

                return [];
              },
            ),

          myDecisions(
            8,
          ).catch(
            (
              error,
            ) => {
              console.error(
                'Could not load recent member decisions:',
                error,
              );

              return [];
            },
          ),
        ]);

      const eventApps =
        eventAppsRaw as unknown as DashboardEventApplication[];

      const membership =
        viewer.membership;

      const profile =
        viewer.profile;

      const membershipStatus =
        membership?.status
          ? enumLabel(
            membership.status,
          )
          : 'MEMBER';

      const accepted = eventAppsRaw.filter(row => row.status === 'approved' && row.has_active_assignment);
      const pendingCount = requests.filter(row => row.status === 'pending').length +
        eventAppsRaw.filter(row => row.status === 'pending').length + (positionRequest?.status === 'pending' ? 1 : 0);
      const destination = (title: string, description: string, href: string) =>
        h('a', { class: 'dashboard-card dashboard-destination', href },
          h('h3', title), h('p', { class: 'dashboard-card__description' }, description),
          h('span', { class: 'dashboard-card__link' }, 'View →'));
      render(content,
        pageHeader(`MEMBER / ${membershipStatus}`, displayName(viewer)),
        denied ? notice('warn', 'That page needs an admin role you do not hold.') : null,
        panel('Your current responsibilities',
          h('p', { class: 'dashboard-card__event' }, `Standing club role: ${viewer.currentPosition || 'General member'}`),
          accepted.length ? h('div', { class: 'dashboard-cards' }, accepted.map(row =>
            h('a', { class: 'dashboard-card dashboard-destination', href: '/portal/opportunities.html?view=responsibilities' },
              h('div', { class: 'dashboard-card__heading' }, h('h3', row.position_title), statusPill('approved')),
              h('p', { class: 'dashboard-card__event' }, row.project_title),
              h('p', { class: 'dashboard-card__description' }, row.project_starts_on ? `Event starts ${archiveDate(row.project_starts_on)}` : 'Event date to be announced'),
              h('span', { class: 'dashboard-card__link' }, 'View responsibility →'))))
            : h('p', 'You have no active event assignments. Browse Opportunities to find a role.'),
          h('a', { class: 'btn-ghost', href: '/portal/opportunities.html?view=responsibilities' }, 'Manage my responsibilities')),
        panel('Where to go', h('div', { class: 'dashboard-cards dashboard-cards--opportunities' },
          destination('Opportunities', 'Discover available event roles and register interest.', '/portal/opportunities.html'),
          destination('Contributions', 'Submit your work and track its review status.', '/portal/contributions.html'),
          destination('Archive submissions', `${submissions.length} submissions. View details, reviewer feedback or send an updated revision.`, '/portal/submissions.html'),
          destination('My Record', `${stats.verified_contributions} verified contributions. View position history, participation and decisions.`, '/portal/record.html'),
          destination('Requests', 'Manage club role changes, membership and privacy requests.', '/portal/requests.html'),
          destination('Profile', 'Update your personal details and public profile.', '/portal/profile.html'))),
        h('p', { class: 'event-request-intro' }, `${pendingCount} pending membership, role or event requests. Event registrations are tracked in My responsibilities; other requests are tracked in Requests.`),
      );
    } catch (error) {
      console.error(
        'Member dashboard failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'MEMBER',
          'Dashboard unavailable',
        ),

        notice(
          'err',
          `Your ACM record could not load: ${errorMessage(error)}`,
        ),

        h(
          'div',
          {
            class:
              'button-row',
          },

          h(
            'button',
            {
              type:
                'button',
              class:
                'btn-ghost',

              onclick:
                () =>
                  void draw(),
            },
            'TRY AGAIN',
          ),

          h(
            'a',
            {
              class:
                'btn-ghost',
              href:
                '/portal/profile.html',
            },
            'Profile',
          ),
        ),
      );
    }
  }

  await draw();
}

void start();
