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

  position: {
    title: string;
  } | null;
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

        application.position
          ?.title ??
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
        'history-list',
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
                'history-row',
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
              {},

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
                      'mono-meta dim-text',
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

          myEventApplications(
            viewer.userId,
          ),

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

      render(
        content,

        pageHeader(
          `MEMBER / ${membershipStatus}`,

          displayName(
            viewer,
          ),

          h(
            'a',
            {
              class:
                'btn-ghost',
              href:
                '/portal/profile.html',
            },
            'Edit profile',
          ),

          isStaff(
            viewer,
          )
            ? h(
              'a',
              {
                class:
                  'btn-ghost',
                href:
                  '/admin/index.html',
              },
              'Admin console',
            )
            : null,
        ),

        denied
          ? notice(
            'warn',
            'That page needs an admin role you do not hold.',
          )
          : null,

        statRow([
          [
            stats.events_count,
            'Events',
          ],

          [
            stats.projects_count,
            'Projects',
          ],

          [
            stats.workshops_count,
            'Workshops',
          ],

          [
            stats.verified_contributions,
            'Verified contributions',
          ],
        ]),

        h(
          'div',
          {
            class:
              'panel-grid',
          },

          panel(
            'ACM record',

            h(
              'p',
              {
                class:
                  'mono-meta dim-text',
              },
              'Verified by ACM. These fields are maintained by admins.',
            ),

            metaList([
              [
                'Status',
                statusPill(
                  membership?.status ??
                  'inactive',
                ),
              ],

              [
                'Current position',
                viewer.currentPosition ??
                'Member',
              ],

              [
                'Years active',
                yearsActive(
                  membership
                    ?.started_on ??
                  null,

                  membership
                    ?.ended_on ??
                  null,
                ),
              ],

              [
                'Member since',
                archiveDate(
                  membership
                    ?.started_on ??
                  null,
                ),
              ],

              [
                'Chapter',
                membership
                  ?.chapter_year ??
                '—',
              ],

              [
                'Record ID',
                membership
                  ?.member_no ??
                '—',
              ],
            ]),
          ),

          panel(
            'Your profile',

            h(
              'p',
              {
                class:
                  'mono-meta dim-text',
              },
              'Yours to change at any time, without asking anyone.',
            ),

            metaList([
              [
                'Visibility',
                statusPill(
                  profile?.visibility ===
                    'public'
                    ? 'active'
                    : 'inactive',
                ),
              ],

              [
                'Public listing',
                profile?.visibility ===
                  'public'
                  ? 'Shown on the ACM team page'
                  : 'Not shown publicly',
              ],

              [
                'Academic year',
                profile
                  ?.academic_year ??
                '—',
              ],

              [
                'Interests',
                profile?.interests
                  ?.length
                  ? profile.interests.join(
                    ', ',
                  )
                  : '—',
              ],

              [
                'Links',
                [
                  profile?.linkedin_url
                    ? 'LinkedIn'
                    : null,

                  profile?.github_url
                    ? 'GitHub'
                    : null,

                  profile?.website_url
                    ? 'Website'
                    : null,
                ]
                  .filter(
                    Boolean,
                  )
                  .join(
                    ', ',
                  ) ||
                '—',
              ],
            ]),

            h(
              'div',
              {
                class:
                  'button-row',
              },

              h(
                'a',
                {
                  class:
                    'btn-ghost',
                  href:
                    '/portal/profile.html',
                },
                'Edit',
              ),

              h(
                'a',
                {
                  class:
                    'btn-ghost',
                  href:
                    '/portal/requests.html',
                },
                'Privacy & membership',
              ),
            ),
          ),
        ),

        panel(
          'Position history',
          historyList(
            history,
          ),
        ),

        h(
          'div',
          {
            class:
              'panel-grid',
          },

          panel(
            'Recent contributions',

            recentContributions(
              contributions,
            ),

            h(
              'div',
              {
                class:
                  'button-row',
              },

              h(
                'a',
                {
                  class:
                    'btn-ghost',
                  href:
                    '/portal/contributions.html',
                },
                'All contributions',
              ),

              h(
                'a',
                {
                  class:
                    'btn-ghost',
                  href:
                    '/portal/record.html',
                },
                'My verified record',
              ),
            ),
          ),

          panel(
            'Waiting on ACM',

            pendingList(
              requests,
              positionRequest,
              eventApps,
            ),

            h(
              'div',
              {
                class:
                  'button-row',
              },

              h(
                'a',
                {
                  class:
                    'btn-ghost',
                  href:
                    '/portal/requests.html',
                },
                'Make a request',
              ),
            ),
          ),
        ),

        panel(
          'Archive submissions',

          submissions.length
            ? metaList(
              submissions
                .slice(
                  0,
                  5,
                )
                .map(
                  (
                    submission,
                  ) =>
                    [
                      submission.title,

                      statusPill(
                        submission.status,
                      ),
                    ] as [
                      string,
                      HTMLElement,
                    ],
                ),
            )
            : emptyState(
              'You have not submitted anything to the archive yet.',
              'Workshop material, posters, reports and source code all belong in the archive.',
            ),

          h(
            'div',
            {
              class:
                'button-row',
            },

            h(
              'a',
              {
                class:
                  'btn-ghost',
                href:
                  '/portal/submissions.html',
              },
              'Submit to the archive',
            ),
          ),
        ),

        decisions.length
          ? panel(
            'Recent decisions about you',

            memberDecisionList(
              decisions,
            ),

            h(
              'div',
              {
                class:
                  'button-row',
              },

              h(
                'a',
                {
                  class:
                    'btn-ghost',
                  href:
                    '/portal/record.html',
                },
                'Full decision history',
              ),
            ),
          )
          : null,

        opportunities.length
          ? panel(
            'Open positions on ACM events',

            metaList(
              opportunities
                .slice(
                  0,
                  5,
                )
                .map(
                  (
                    opportunity,
                  ) =>
                    [
                      opportunity.title,

                      `${opportunity.remaining} of ${opportunity.openings} open — ${opportunity.project?.title ?? ''}`,
                    ] as [
                      string,
                      string,
                    ],
                ),
            ),

            h(
              'div',
              {
                class:
                  'button-row',
              },

              h(
                'a',
                {
                  class:
                    'btn-ghost',
                  href:
                    '/portal/opportunities.html',
                },
                'See all opportunities',
              ),
            ),
          )
          : null,
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