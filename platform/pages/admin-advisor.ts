import { h, render, formValues, textOf } from '../lib/dom.js';
import { shell, pageHeader, panel, statRow, dataTable, loading, emptyState,
  statusPill, toast, action, notice, dialog, field } from '../lib/ui.js';
import { requireAdvisor, displayName } from '../lib/session.js';
import { advisorActivities, advisorParticipants, advisorContributions,
  advisorSetParticipationStatus, advisorVerifyContribution } from '../lib/api.js';
import { requireClient, readableError } from '../lib/supabase.js';
import { archiveDate, enumLabel } from '../lib/format.js';
import type { ParticipationStatus, Project, ProjectStatus, ContentVisibility } from '../lib/types.js';

const PAGE_SIZE = 7;
const EVENT_STATUSES = ['planning', 'active', 'completed', 'archived'] as const;
const CLUB_RECORDS_WORKBOOK = 'https://docs.google.com/spreadsheets/d/1WtNGmVYO8hk_w3I37n1T6wS9_z_dTyTPW4fTHZ4lW3s/edit';

type PageKey = 'activities' | 'participants' | 'contributions';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pageButton(label: string, active: boolean, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const button = h('button', {
    type: 'button',
    class: active ? 'btn-primary' : 'btn-ghost',
    disabled,
    style: { minWidth: '2.75rem' },
  }, label) as HTMLButtonElement;
  button.addEventListener('click', onClick);
  return button;
}

function paginatedTable(
  headers: string[], rows: Array<Array<Node | string | null | undefined>>,
  page: number, setPage: (page: number) => void,
): HTMLElement {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 1), pages);
  const start = (current - 1) * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);

  const pager = h('div', {
    class: 'button-row',
    style: { justifyContent: 'center', marginTop: '1.25rem', flexWrap: 'wrap' },
  });

  pager.append(pageButton('‹ Previous', false, current === 1, () => setPage(current - 1)));
  for (let number = 1; number <= pages; number += 1) {
    pager.append(pageButton(String(number), number === current, false, () => setPage(number)));
  }
  pager.append(pageButton('Next ›', false, current === pages, () => setPage(current + 1)));

  return h('div', {}, dataTable(headers, visible),
    rows.length > PAGE_SIZE ? pager : null,
    h('div', { class: 'mono-meta dim-text', style: { marginTop: '0.75rem', textAlign: 'center' } },
      `${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} OF ${rows.length}`));
}

async function loadEvent(id: string): Promise<Project> {
  const { data, error } = await requireClient().from('projects').select('*').eq('id', id).single();
  if (error || !data) throw new Error(error ? readableError(error) : 'Event not found.');
  return data as Project;
}

async function start(): Promise<void> {
  const viewer = await requireAdvisor();
  const content = shell(viewer, 'admin', 'Assigned activities');
  const pages: Record<PageKey, number> = { activities: 1, participants: 1, contributions: 1 };

  function eventEditor(existing: Project | null): void {
    const form = h('form', { class: 'portal-form', novalidate: true },
      field({ label: 'Event title', name: 'title', required: true, maxlength: 140, value: existing?.title }),
      h('div', { class: 'field-pair' },
        field({ label: 'Status', name: 'status', type: 'select', value: existing?.status ?? 'planning',
          options: EVENT_STATUSES.map((value) => ({ value, label: enumLabel(value) })) }),
        field({ label: 'Visibility', name: 'visibility', type: 'select', value: existing?.visibility ?? 'internal',
          options: [
            { value: 'internal', label: 'Internal — members and staff' },
            { value: 'public', label: 'Public — anyone' },
          ] }),
      ),
      h('div', { class: 'field-pair' },
        field({ label: 'Starts', name: 'starts_on', type: 'date', value: existing?.starts_on }),
        field({ label: 'Ends', name: 'ends_on', type: 'date', value: existing?.ends_on }),
      ),
      h('div', { class: 'field-pair' },
        field({ label: 'Chapter year', name: 'chapter_year', value: existing?.chapter_year ?? String(new Date().getFullYear()) }),
        field({ label: 'Category', name: 'category', value: existing?.category, placeholder: 'ctf, jam, workshops…' }),
      ),
      field({ label: 'Summary', name: 'summary', type: 'textarea', rows: 3, value: existing?.summary }),
      h('div', { class: 'field-pair' },
        field({ label: 'Website path', name: 'site_path', value: existing?.site_path, placeholder: '/projects/…/' }),
        field({ label: 'Repository', name: 'repo_url', type: 'url', value: existing?.repo_url }),
      ),
    ) as HTMLFormElement;

    const modal = dialog(existing ? `Edit event — ${existing.title}` : 'Create event', form,
      h('div', { class: 'button-row' },
        action(existing ? 'SAVE EVENT' : 'CREATE EVENT', async () => {
          if (!form.reportValidity()) return;
          const values = formValues(form);
          const title = textOf(values, 'title').trim();
          const startsOn = textOf(values, 'starts_on') || null;
          const endsOn = textOf(values, 'ends_on') || null;
          if (startsOn && endsOn && endsOn < startsOn) {
            toast('The end date cannot be before the start date.', 'err'); return;
          }
          const args = {
            event_title: title,
            event_status: textOf(values, 'status') as ProjectStatus,
            starts_on: startsOn,
            ends_on: endsOn,
            chapter_year: textOf(values, 'chapter_year') || null,
            category: textOf(values, 'category') || null,
            summary: textOf(values, 'summary') || null,
            site_path: textOf(values, 'site_path') || null,
            repo_url: textOf(values, 'repo_url') || null,
            visibility: textOf(values, 'visibility') as ContentVisibility,
          };
          const client = requireClient();
          const result = existing
            ? await client.rpc('advisor_update_event', { event_id: existing.id, ...args })
            : await client.rpc('advisor_create_event', args);
          if (result.error) throw new Error(readableError(result.error));
          modal.close();
          toast(existing ? 'Event updated.' : 'Event created and assigned to you.');
          pages.activities = 1;
          await draw();
        }, 'primary')));
  }

  function deleteEvent(existing: Project): void {
    const form = h('form', { class: 'portal-form', novalidate: true },
      notice('warn', `This removes “${existing.title}” from active event records. Historical audit data is retained.`),
      field({ label: 'Reason', name: 'reason', type: 'textarea', rows: 3, required: true,
        placeholder: 'Why is this event being removed?' }),
    ) as HTMLFormElement;
    const modal = dialog(`Delete event — ${existing.title}`, form,
      h('div', { class: 'button-row' }, action('DELETE EVENT', async () => {
        if (!form.reportValidity()) return;
        const reason = textOf(formValues(form), 'reason').trim();
        const { error } = await requireClient().rpc('advisor_delete_event', { event_id: existing.id, reason });
        if (error) throw new Error(readableError(error));
        modal.close(); toast('Event removed.'); pages.activities = 1; await draw();
      }, 'danger')));
  }

  async function openEdit(id: string): Promise<void> {
    try { eventEditor(await loadEvent(id)); }
    catch (error) { toast(`Could not open event: ${message(error)}`, 'err'); }
  }

  async function openDelete(id: string): Promise<void> {
    try { deleteEvent(await loadEvent(id)); }
    catch (error) { toast(`Could not open event: ${message(error)}`, 'err'); }
  }

  async function draw(): Promise<void> {
    render(content, loading('LOADING ADVISOR WORKSPACE'));
    try {
      const activities = await advisorActivities(viewer.userId);
      const ids = activities.map((item) => item.id);
      const [participants, contributions] = await Promise.all([
        advisorParticipants(ids), advisorContributions(ids),
      ]);
      const titles = new Map(activities.map((item) => [item.id, item.title]));
      const redrawPage = (key: PageKey, value: number) => { pages[key] = value; void draw(); };
      const attendanceAction = (row: any, status: ParticipationStatus, label: string) =>
        action(label, async () => {
          await advisorSetParticipationStatus(row.id, status);
          toast('Participation updated.'); await draw();
        });

      const activityRows = activities.map((item) => [
        item.title, enumLabel(item.kind), `${item.role_text}${item.is_lead ? ' · Lead' : ''}`,
        statusPill(item.status), `${archiveDate(item.starts_on)} — ${archiveDate(item.ends_on)}`,
        item.kind === 'event'
          ? h('div', { class: 'button-row' },
              action('EDIT', () => openEdit(item.id)),
              action('DELETE', () => openDelete(item.id), 'danger'))
          : h('span', { class: 'mono-meta dim-text' }, 'READ ONLY'),
      ]);

      const participantRows = participants.map((row: any) => [
        row.member?.full_name || row.member?.email || '—', titles.get(row.project_id) || '—',
        row.role_text, statusPill(row.status),
        h('div', { class: 'button-row' }, attendanceAction(row, 'completed', 'COMPLETED'),
          attendanceAction(row, 'no_show', 'NO SHOW')),
      ]);

      const contributionRows = contributions.map((row: any) => [
        row.member?.full_name || row.member?.email || '—', titles.get(row.project_id) || '—',
        row.title, row.role_text || '—', statusPill(row.status),
        row.status === 'submitted' ? action('VERIFY', async () => {
          await advisorVerifyContribution(row.id); toast('Contribution verified.'); await draw();
        }) : h('span', { class: 'mono-meta dim-text' }, 'READ ONLY'),
      ]);

      render(content,
        pageHeader('ADVISORY INSTRUCTOR', `Welcome, ${displayName(viewer)}`,
          h('div', { class: 'button-row' },
            action('CREATE EVENT', async () => eventEditor(null), 'primary'),
            h('a', { class: 'btn-ghost', href: CLUB_RECORDS_WORKBOOK, target: '_blank', rel: 'noopener' }, 'OPEN GOOGLE RECORDS'),
            h('a', { class: 'btn-ghost', href: '/portal/index.html' }, 'Member portal'))),
        notice('info', 'You can manage events and verify attendance/contributions for activities assigned to you. The Google workbook is a read-only administrative snapshot; Supabase remains the source of truth.'),
        statRow([
          [activities.length, 'Assigned activities'], [participants.length, 'Participants'],
          [contributions.filter((row: any) => row.status === 'submitted').length, 'Awaiting verification'],
        ]),
        panel('Faculty records access',
          h('p', 'Open the shared ACM PSU — Club Records workbook for the current synchronized university record.'),
          h('div', { class: 'button-row' },
            h('a', { class: 'btn-primary', href: CLUB_RECORDS_WORKBOOK, target: '_blank', rel: 'noopener' }, 'OPEN GOOGLE WORKBOOK'))),
        panel('Assigned events and workshops', activityRows.length
          ? paginatedTable(['Activity', 'Kind', 'Role', 'Status', 'Dates', 'Actions'], activityRows,
              pages.activities, (value) => redrawPage('activities', value))
          : emptyState('No activities are assigned to you.', 'Create an event or ask a club admin to assign you to an existing one.')),
        panel('Participants and attendance', participantRows.length
          ? paginatedTable(['Participant', 'Activity', 'Role', 'Status', 'Attendance'], participantRows,
              pages.participants, (value) => redrawPage('participants', value))
          : emptyState('No participants are recorded for your assigned activities.')),
        panel('Contribution verification', contributionRows.length
          ? paginatedTable(['Member', 'Activity', 'Contribution', 'Role', 'Status', ''], contributionRows,
              pages.contributions, (value) => redrawPage('contributions', value))
          : emptyState('No contributions are attached to your assigned activities.')),
      );
    } catch (error) {
      console.error(error);
      render(content, pageHeader('ADVISORY INSTRUCTOR', 'Advisor workspace unavailable'),
        notice('err', message(error)), action('TRY AGAIN', draw));
    }
  }
  await draw();
}

void start();
