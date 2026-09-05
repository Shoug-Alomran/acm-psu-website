/** Dashboard: current responsibilities and links to the dedicated workspaces. */
import { h, render } from '../lib/dom.js';
import { shell, pageHeader, panel, statusPill, loading, notice } from '../lib/ui.js';
import { requireMember, displayName, isAdvisoryInstructor, isInstructor, type Viewer } from '../lib/session.js';
import { memberStats, mySubmissions, myEventApplications } from '../lib/api.js';
import { archiveDate, enumLabel } from '../lib/format.js';
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The dashboard could not be loaded.';
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

  const instructorOnly = isInstructor(viewer);
  if (instructorOnly) {
    const destination = (title: string, description: string, href: string) =>
      h('a', { class: 'dashboard-card dashboard-destination', href },
        h('h3', title), h('p', { class: 'dashboard-card__description' }, description),
        h('span', { class: 'dashboard-card__link' }, 'Open →'));
    render(content,
      pageHeader('FACULTY / INSTRUCTOR', displayName(viewer)),
      denied ? notice('warn', 'That page is outside the instructor workspace.') : null,
      panel('Your profile', loading('LOADING FACULTY PROFILE')),
      panel('ACM record', loading('LOADING ACM RECORD')),
      panel('Instructor tools', h('div', { class: 'dashboard-cards' },
        isAdvisoryInstructor(viewer) ? destination('Assigned Activities',
          'Manage the ACM events and workshops assigned to you.', '/admin/advisor.html') : null,
        isAdvisoryInstructor(viewer) ? destination('Club Records',
          'Review the private records needed for your advisory work.', '/admin/records-backup.html') : null,
        destination('My Profile',
          'Update your public faculty biography, teaching details and links.', '/portal/profile.html'),
        destination('My Record',
          'Review your ACM role and verified activity history.', '/portal/record.html'))));
    return;
  }

  async function draw(): Promise<void> {
    render(
      content,
      loading(
        'LOADING YOUR RECORD',
      ),
    );

    try {
      const [stats, submissions, eventAppsRaw] = await Promise.all([
        memberStats(viewer.userId), mySubmissions(viewer.userId),
        myEventApplications(),
      ]);

      const membership =
        viewer.membership;

      const membershipStatus =
        membership?.status
          ? enumLabel(
            membership.status,
          )
          : isAdvisoryInstructor(viewer)
            ? 'INSTRUCTOR'
            : enumLabel(viewer.user.university_role);

      const accepted = eventAppsRaw.filter(row => row.status === 'approved' && row.has_active_assignment);
      const destination = (title: string, description: string, href: string) =>
        h('a', { class: 'dashboard-card dashboard-destination', href },
          h('h3', title), h('p', { class: 'dashboard-card__description' }, description),
          h('span', { class: 'dashboard-card__link' }, 'View →'));
      render(content,
        pageHeader(`${isAdvisoryInstructor(viewer) ? 'FACULTY' : 'MEMBER'} / ${membershipStatus}`, displayName(viewer)),
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
