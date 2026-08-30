import { h, render } from '../lib/dom.js';
import { shell, pageHeader, panel, statRow, dataTable, loading, emptyState,
  statusPill, toast, action, notice } from '../lib/ui.js';
import { requireAdvisor, displayName } from '../lib/session.js';
import { advisorActivities, advisorParticipants, advisorContributions,
  advisorSetParticipationStatus, advisorVerifyContribution } from '../lib/api.js';
import { archiveDate, enumLabel } from '../lib/format.js';
import type { ParticipationStatus } from '../lib/types.js';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function start(): Promise<void> {
  const viewer = await requireAdvisor();
  const content = shell(viewer, 'admin', 'Assigned activities');

  async function draw(): Promise<void> {
    render(content, loading('LOADING ASSIGNED ACTIVITIES'));
    try {
      const activities = await advisorActivities(viewer.userId);
      const ids = activities.map((item) => item.id);
      const [participants, contributions] = await Promise.all([
        advisorParticipants(ids), advisorContributions(ids),
      ]);
      const titles = new Map(activities.map((item) => [item.id, item.title]));
      const attendanceAction = (row: any, status: ParticipationStatus, label: string) =>
        action(label, async () => {
          await advisorSetParticipationStatus(row.id, status);
          toast('Participation updated.');
          await draw();
        });

      render(content,
        pageHeader('ADVISORY INSTRUCTOR', `Welcome, ${displayName(viewer)}`,
          h('a', { class: 'btn-ghost', href: '/portal/index.html' }, 'Member portal')),
        notice('info', 'You can view and verify records only for activities where you are explicitly assigned. Member accounts, profiles, memberships, official positions, settings and exports remain administrator-controlled.'),
        statRow([
          [activities.length, 'Assigned activities'], [participants.length, 'Participants'],
          [contributions.filter((row: any) => row.status === 'submitted').length, 'Awaiting verification'],
        ]),
        panel('Assigned events and workshops', activities.length ? dataTable(
          ['Activity', 'Kind', 'Role', 'Status', 'Dates'],
          activities.map((item) => [item.title, enumLabel(item.kind),
            `${item.role_text}${item.is_lead ? ' · Lead' : ''}`, statusPill(item.status),
            `${archiveDate(item.starts_on)} — ${archiveDate(item.ends_on)}`]),
        ) : emptyState('No activities are assigned to you.', 'A club admin can add you as an organizer on a project or event.')),
        panel('Participants and attendance', participants.length ? dataTable(
          ['Participant', 'Activity', 'Role', 'Status', 'Attendance'],
          participants.map((row: any) => [
            row.member?.full_name || row.member?.email || '—', titles.get(row.project_id) || '—',
            row.role_text, statusPill(row.status),
            h('div', { class: 'button-row' }, attendanceAction(row, 'completed', 'COMPLETED'),
              attendanceAction(row, 'no_show', 'NO SHOW')),
          ]),
        ) : emptyState('No participants are recorded for your assigned activities.')),
        panel('Contribution verification', contributions.length ? dataTable(
          ['Member', 'Activity', 'Contribution', 'Role', 'Status', ''],
          contributions.map((row: any) => [
            row.member?.full_name || row.member?.email || '—', titles.get(row.project_id) || '—',
            row.title, row.role_text || '—', statusPill(row.status),
            row.status === 'submitted' ? action('VERIFY', async () => {
              await advisorVerifyContribution(row.id); toast('Contribution verified.'); await draw();
            }) : h('span', { class: 'mono-meta dim-text' }, 'READ ONLY'),
          ]),
        ) : emptyState('No contributions are attached to your assigned activities.')),
      );
    } catch (error) {
      console.error(error);
      render(content, pageHeader('ADVISORY INSTRUCTOR', 'Assigned activities unavailable'),
        notice('err', message(error)), action('TRY AGAIN', draw));
    }
  }
  await draw();
}

void start();
