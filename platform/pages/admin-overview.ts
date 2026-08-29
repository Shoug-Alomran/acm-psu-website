/**
 * Admin overview.
 *
 * The first thing a committee member sees. It answers one question — what is
 * waiting on me — and links straight into each queue. Recent activity comes
 * from the audit log, so a new committee can see what has been happening
 * without having to ask the previous one.
 */

import { h, render } from '../lib/dom.js';

import {
  shell,
  pageHeader,
  panel,
  statRow,
  triageStrip,
  dataTable,
  loading,
  emptyState,
  notice,
} from '../lib/ui.js';

import {
  requireAdmin,
  isClubAdmin,
  displayName,
} from '../lib/session.js';

import {
  overview,
  auditLog,
} from '../lib/admin.js';

import {
  setting,
  projects,
} from '../lib/api.js';

import {
  relativeTime,
  enumLabel,
} from '../lib/format.js';

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return 'An unknown error occurred.';
}

async function start(): Promise<void> {
  const viewer =
    await requireAdmin('reviewer');

  const content = shell(
    viewer,
    'admin',
    'Overview',
  );

  async function draw(): Promise<void> {
    render(
      content,
      loading(),
    );

    try {
      /*
       * These two are required for the dashboard itself.
       * If either fails, the page cannot meaningfully render.
       */
      const [
        counts,
        projectList,
      ] = await Promise.all([
        overview(),
        projects(),
      ]);

      /*
       * These are useful but not critical.
       * A broken audit read or missing setting should not destroy the entire
       * admin dashboard.
       */
      const [
        activity,
        chapter,
      ] = await Promise.all([
        auditLog(15).catch((error) => {
          console.error(
            'Could not load recent admin activity:',
            error,
          );

          return [];
        }),

        setting<string>(
          'current_chapter_year',
          String(
            new Date().getFullYear(),
          ),
        ).catch((error) => {
          console.error(
            'Could not load current chapter year:',
            error,
          );

          return String(
            new Date().getFullYear(),
          );
        }),
      ]);

      const active =
        projectList.filter(
          (project) =>
            project.status === 'active' ||
            project.status === 'planning',
        );

      render(
        content,

        pageHeader(
          `ADMIN / CHAPTER ${chapter}`,

          `Welcome, ${displayName(viewer)}`,

          h(
            'a',
            {
              class: 'btn-ghost',
              href: '/portal/index.html',
            },
            'Member portal',
          ),
        ),

        /*
         * What is waiting, loudest first.
         *
         * 'now' is reserved for queues where the delay lands on somebody else:
         * an applicant cannot join, and a withdrawal or deletion request is a
         * person asking to leave. The rest are ordinary review work.
         */
        triageStrip([
          ...(isClubAdmin(viewer)
            ? [{
                label: 'Membership applications',
                count: counts.applications,
                href: '/admin/applications.html',
                hint: 'READ, INTERVIEW, DECIDE',
                level: 'now' as const,
              }]
            : []),

          ...(isClubAdmin(viewer)
            ? [{
                label: 'Membership and privacy requests',
                count: counts.memberRequests,
                href: '/admin/requests.html',
                hint: 'WITHDRAWAL, REMOVAL, DELETION',
                level: 'now' as const,
              }]
            : []),

          {
            label: 'Archive submissions',
            count: counts.submissions,
            href: '/admin/submissions.html',
            hint: 'REVIEW BEFORE PUBLISHING',
          },

          {
            label: 'Contribution reviews',
            count: counts.contributions,
            href: '/admin/contributions.html',
            hint: 'VERIFY SUBMITTED WORK',
          },

          ...(isClubAdmin(viewer)
            ? [{
                label: 'Position change requests',
                count: counts.positionRequests,
                href: '/admin/requests.html',
                hint: 'MEMBERS ASKING FOR A ROLE',
              }]
            : []),

          ...(isClubAdmin(viewer)
            ? [{
                label: 'Event position requests',
                count: counts.eventRequests,
                href: '/admin/requests.html',
                hint: 'VOLUNTEERS FOR EVENT ROLES',
              }]
            : []),
        ]),

        /* Context, not a queue — nothing here is asking to be acted on. */
        statRow([
          [
            counts.members,
            'Active members',
          ],

          [
            counts.activeProjects,
            'Live projects',
          ],

          [
            chapter,
            'Chapter year',
          ],
        ]),

        panel(
          'Live projects and events',

          active.length
            ? dataTable(
              [
                'Project',
                'Kind',
                'Status',
                'Starts',
              ],

              active.map(
                (project) => [
                  isClubAdmin(viewer)
                    ? h(
                      'a',
                      {
                        href:
                          `/admin/projects.html?project=${project.id}`,
                      },
                      project.title,
                    )
                    : project.title,

                  h(
                    'span',
                    {
                      class: 'mono-meta',
                    },
                    enumLabel(
                      project.kind,
                    ),
                  ),

                  h(
                    'span',
                    {
                      class: 'mono-meta',
                    },
                    enumLabel(
                      project.status,
                    ),
                  ),

                  h(
                    'span',
                    {
                      class: 'mono-meta',
                    },
                    project.starts_on ??
                    '—',
                  ),
                ],
              ),
            )
            : emptyState(
              'No live projects.',

              isClubAdmin(viewer)
                ? 'Create one from Projects & Events.'
                : undefined,
            ),
        ),

        panel(
          'Recent activity',

          activity.length
            ? dataTable(
              [
                'When',
                'Who',
                'Action',
                'Detail',
              ],

              activity.map(
                (entry) => [
                  h(
                    'span',
                    {
                      class: 'mono-meta',
                    },
                    relativeTime(
                      entry.created_at,
                    ),
                  ),

                  entry.actor_email ??
                  '—',

                  h(
                    'span',
                    {
                      class:
                        'mono-meta accent-text',
                    },
                    entry.action,
                  ),

                  entry.summary ??
                  '—',
                ],
              ),
            )
            : emptyState(
              'No recorded activity yet.',
            ),

          h(
            'div',
            {
              class: 'button-row',
            },

            h(
              'a',
              {
                class: 'btn-ghost',
                href: '/admin/administration.html#audit',
              },
              'Full audit history',
            ),
          ),
        ),

        notice(
          'info',
          'Roles are hierarchical: a reviewer works the review queues, a club admin runs ' +
          'everything operational, and a super admin can also manage admins. See ' +
          'docs/HANDOVER.md for transferring control to next year’s committee.',
        ),
      );
    } catch (error) {
      console.error(
        'Admin overview failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'ADMIN',
          'Dashboard unavailable',
        ),

        notice(
          'err',
          `The admin dashboard could not load: ${errorMessage(error)}`,
        ),

        h(
          'div',
          {
            class: 'button-row',
          },

          h(
            'button',
            {
              type: 'button',
              class: 'btn-ghost',
              onclick: () =>
                void draw(),
            },
            'TRY AGAIN',
          ),
        ),
      );
    }
  }

  await draw();
}

void start();