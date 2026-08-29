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

function queueRow(
  label: string,
  value: number,
  href: string,
  hint: string,
) {
  return h(
    'a',
    {
      class: 'browser-row',
      href,
      style: { textDecoration: 'none' },
    },

    h(
      'div',
      { class: 'fname' },
      h('span', { class: 'icon' }, value > 0 ? '●' : '○'),
      h('span', label),
    ),

    h(
      'span',
      { class: 'fcell' },
      value > 0 ? `${value} WAITING` : 'CLEAR',
    ),

    h(
      'span',
      { class: 'fcell col-hide' },
      hint,
    ),

    h(
      'span',
      { class: 'fcell col-hide' },
      '',
    ),

    h(
      'span',
      { class: 'file-act' },
      '→',
    ),
  );
}

async function start(): Promise<void> {
  const viewer = await requireAdmin('reviewer');

  const content = shell(
    viewer,
    'admin',
    'Overview',
  );

  render(
    content,
    loading(),
  );

  try {
    const [
      counts,
      activity,
      chapter,
      projectList,
    ] = await Promise.all([
      overview(),
      auditLog(15),
      setting<string>(
        'current_chapter_year',
        String(new Date().getFullYear()),
      ),
      projects(),
    ]);

    const active = projectList.filter(
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

      statRow([
        [
          counts.members,
          'Active members',
        ],
        [
          counts.applications,
          'Pending applications',
        ],
        [
          counts.contributions + counts.submissions,
          'Awaiting review',
        ],
        [
          counts.activeProjects,
          'Live projects',
        ],
      ]),

      panel(
        'Waiting on an admin',

        h(
          'div',
          { class: 'browser-list' },

          isClubAdmin(viewer)
            ? queueRow(
                'Membership applications',
                counts.applications,
                '/admin/applications.html',
                'Read, interview, approve or decline',
              )
            : null,

          queueRow(
            'Contribution reviews',
            counts.contributions,
            '/admin/contributions.html',
            'Verify work members have submitted',
          ),

          queueRow(
            'Archive submissions',
            counts.submissions,
            '/admin/submissions.html',
            'Review files before they are published',
          ),

          isClubAdmin(viewer)
            ? queueRow(
                'Position change requests',
                counts.positionRequests,
                '/admin/requests.html',
                'Members asking for a different role',
              )
            : null,

          isClubAdmin(viewer)
            ? queueRow(
                'Event position requests',
                counts.eventRequests,
                '/admin/requests.html',
                'Members volunteering for event roles',
              )
            : null,

          isClubAdmin(viewer)
            ? queueRow(
                'Membership and privacy requests',
                counts.memberRequests,
                '/admin/requests.html',
                'Withdrawals, profile removal, account deletion',
              )
            : null,
        ),
      ),

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

              active.map((project) => [
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
                  { class: 'mono-meta' },
                  enumLabel(project.kind),
                ),

                h(
                  'span',
                  { class: 'mono-meta' },
                  enumLabel(project.status),
                ),

                h(
                  'span',
                  { class: 'mono-meta' },
                  project.starts_on ?? '—',
                ),
              ]),
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

              activity.map((entry) => [
                h(
                  'span',
                  { class: 'mono-meta' },
                  relativeTime(entry.created_at),
                ),

                entry.actor_email ?? '—',

                h(
                  'span',
                  {
                    class:
                      'mono-meta accent-text',
                  },
                  entry.action,
                ),

                entry.summary,
              ]),
            )
          : emptyState(
              'No recorded activity yet.',
            ),

        h(
          'div',
          { class: 'button-row' },

          h(
            'a',
            {
              class: 'btn-ghost',
              href:
                '/admin/administration.html#audit',
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
        error instanceof Error
          ? `The admin dashboard could not load: ${error.message}`
          : 'The admin dashboard could not load because of an unknown error.',
      ),
    );
  }
}

void start();