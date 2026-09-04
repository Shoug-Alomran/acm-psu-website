/** Event opportunities. Supabase remains the source of truth. */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, emptyState, loading, dialog, field,
  notice, toast, action, metaList,
} from '../lib/ui.js';
import { requireMember, canSubmit } from '../lib/session.js';
import { openOpportunities, myEventApplications } from '../lib/api.js';
import { registerEventApplication, unregisterEventApplication } from '../lib/event-applications.js';
import type { MyEventApplication } from '../lib/types.js';
import { archiveDate } from '../lib/format.js';

type Opportunity = Awaited<ReturnType<typeof openOpportunities>>[number];
interface Section<T> { rows: T; error: string | null; }

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error &&
      typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return 'An unknown error occurred.';
}

async function section<T>(load: () => Promise<T>, fallback: T, label: string): Promise<Section<T>> {
  try { return { rows: await load(), error: null }; }
  catch (error) {
    console.error(`${label} could not load:`, error);
    return { rows: fallback, error: errorMessage(error) };
  }
}

function badge(label: string, tone: 'ok' | 'wait' | 'warn' | 'bad' | 'muted'): HTMLElement {
  return h('span', { class: `opportunity-badge opportunity-badge--${tone}` }, label);
}

function availabilityBadge(opportunity: Opportunity): HTMLElement {
  if (!opportunity.is_open) return badge('CLOSED', 'muted');
  if (opportunity.remaining <= 0) return badge('FULL', 'bad');
  if (opportunity.remaining === 1) return badge('1 SPOT LEFT', 'warn');
  return badge(`${opportunity.remaining}/${opportunity.openings} AVAILABLE`, 'ok');
}

function legend(): HTMLElement {
  return h('div', { class: 'opportunity-legend', 'aria-label': 'Opportunity status legend' },
    badge('AVAILABLE', 'ok'),
    badge('PENDING', 'wait'),
    badge('1 SPOT LEFT', 'warn'),
    badge('FULL / CLOSED', 'bad'),
  );
}

async function start(): Promise<void> {
  const viewer = await requireMember();
  const responsibilitiesView = new URLSearchParams(location.search).get('view') === 'responsibilities';
  const content = shell(viewer, 'member', responsibilitiesView ? 'My responsibilities' : 'Opportunities');

  async function draw(): Promise<void> {
    render(content, loading('LOADING OPEN POSITIONS'));
    const [board, requests] = await Promise.all([
      section(openOpportunities, [] as Opportunity[], 'Open positions'),
      section(myEventApplications, [] as MyEventApplication[], 'Your requests'),
    ]);

    const opportunities = board.rows;
    const mine = requests.rows;
    const applied = new Map(mine.map((row) => [row.event_position_id, row]));
    const byProject = new Map<string, Opportunity[]>();
    for (const opportunity of opportunities) {
      const key = opportunity.project?.id ?? 'other';
      const list = byProject.get(key) ?? [];
      list.push(opportunity);
      byProject.set(key, list);
    }

    function openRegistration(opportunity: Opportunity): void {
      const status = h('div');
      const body = h('div', { class: 'portal-form' },
        h('div', { class: 'opportunity-dialog-summary' },
          availabilityBadge(opportunity),
          h('p', { class: 'mono-meta dim-text' }, opportunity.description ?? ''),
        ),
        field({
          label: 'When are you available?', name: 'availability', required: true,
          maxlength: 500, placeholder: 'e.g. Weekday afternoons, and the full event weekend',
        }),
        field({
          label: 'Anything the organisers should know?', name: 'note', type: 'textarea',
          rows: 3, maxlength: 800, hint: 'Optional.',
        }),
        status,
      );

      const modal: HTMLDialogElement = dialog(
        `Register interest — ${opportunity.title}`,
        body,
        h('div', { class: 'button-row' }, action('Send request', async () => {
          const form = modal.querySelector('form') as HTMLFormElement | null;
          if (!form) {
            status.replaceChildren(notice('err', 'The registration form could not be loaded.'));
            return;
          }
          if (!form.reportValidity()) return;
          const values = formValues(form);
          const availability = textOf(values, 'availability').trim();
          const note = textOf(values, 'note').trim();
          if (!availability) {
            status.replaceChildren(notice('err', 'Tell the organisers when you are available.'));
            return;
          }
          status.replaceChildren(notice('info', 'SAVING REQUEST…'));
          try {
            const result = await registerEventApplication({
              eventPositionId: opportunity.event_position_id,
              availability,
              note: note || null,
            });
            if (result.outcome === 'closed') {
              status.replaceChildren(notice('warn', 'This position has closed since the page loaded. Nothing was saved.'));
              await draw(); return;
            }
            if (result.outcome === 'full') {
              status.replaceChildren(notice('warn', 'Every opening on this position is now taken. Nothing was saved.'));
              await draw(); return;
            }
            modal.close();
            if (result.outcome === 'pending') toast('You already have a request for this position.');
            else if (result.outcome === 'approved') toast('You already hold this position.');
            else toast('Request saved. An organiser will review it.');
            await draw();
          } catch (error) {
            console.error('Could not register for event position:', error);
            status.replaceChildren(notice('err', `Could not save your request: ${errorMessage(error)}`));
          }
        }, 'primary')),
      );
    }

    function registerButton(opportunity: Opportunity): HTMLElement {
      const existing = applied.get(opportunity.event_position_id);
      if (existing && existing.status !== 'cancelled') return statusPill(existing.status);
      if (!canSubmit(viewer)) return badge('ACTIVE MEMBERS ONLY', 'muted');
      if (!opportunity.is_open) return badge('CLOSED', 'muted');
      if (opportunity.remaining <= 0) return badge('FULL', 'bad');
      return h('button', {
        type: 'button', class: 'btn-ghost opportunity-register', onclick: () => openRegistration(opportunity),
      }, existing?.status === 'cancelled' ? 'Register again' : 'Register interest');
    }

    function openUnregister(row: MyEventApplication): void {
      const status = h('div');
      const modal: HTMLDialogElement = dialog(
        `Unregister — ${row.position_title}`,
        h('div', {},
          notice('warn', 'You can unregister online until 72 hours before the event starts. Your request stays in the club record as cancelled.'),
          status,
        ),
        h('div', { class: 'button-row' }, action('Unregister', async () => {
          status.replaceChildren(notice('info', 'UNREGISTERING…'));
          try {
            const result = await unregisterEventApplication(row.id);
            if (result.outcome === 'window_closed') {
              status.replaceChildren(notice('warn', 'This event starts within 72 hours. Contact an organiser or club admin to withdraw.'));
              return;
            }
            modal.close();
            toast(result.outcome === 'already_closed' ? 'That request was already closed.' : 'You have been unregistered from that position.');
            await draw();
          } catch (error) {
            console.error('Could not unregister event application:', error);
            status.replaceChildren(notice('err', `Could not unregister: ${errorMessage(error)}`));
          }
        }, 'danger')),
      );
    }

    function boardPanels(): HTMLElement | HTMLElement[] {
      if (board.error) {
        return panel('Open positions unavailable',
          notice('err', `Open positions could not load: ${board.error}`),
          h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'btn-ghost', onclick: () => void draw() }, 'TRY AGAIN')),
        );
      }
      if (!opportunities.length) {
        return panel('Nothing open right now', emptyState(
          'There are no open positions at the moment.',
          'New roles are posted here whenever an event is being organised.',
        ));
      }

      return [...byProject.entries()].map(([, list]) => {
        const project = list[0]?.project;
        return panel(
          project?.title ?? 'Other',
          h('div', { class: 'opportunity-project-meta' },
            project?.summary ? h('p', {}, project.summary) : null,
            project?.starts_on ? badge(`STARTS ${archiveDate(project.starts_on)}`, 'wait') : null,
            badge(`${list.length} ROLE${list.length === 1 ? '' : 'S'}`, 'muted'),
          ),
          h('div', { class: 'opportunity-grid' },
            list.map((opportunity) => {
              const existing = applied.get(opportunity.event_position_id);
              const state = existing && existing.status !== 'cancelled'
                ? existing.status
                : !opportunity.is_open ? 'closed'
                : opportunity.remaining <= 0 ? 'full'
                : opportunity.remaining === 1 ? 'almost-full'
                : 'available';
              return h('article', { class: `opportunity-card opportunity-card--${state}` },
                h('div', { class: 'opportunity-card-head' },
                  h('div', {},
                    h('span', { class: 'opportunity-icon', 'aria-hidden': 'true' }, '◆'),
                    h('strong', {}, opportunity.title),
                  ),
                  availabilityBadge(opportunity),
                ),
                opportunity.description
                  ? h('p', { class: 'opportunity-description' }, opportunity.description)
                  : null,
                h('div', { class: 'opportunity-card-foot' },
                  opportunity.closes_on
                    ? h('span', { class: 'mono-meta dim-text' }, `CLOSES ${archiveDate(opportunity.closes_on)}`)
                    : h('span'),
                  registerButton(opportunity),
                ),
              );
            }),
          ),
        );
      });
    }

    function requestRow(row: MyEventApplication): HTMLElement {
      return h('article', { class: 'dashboard-card event-request-card' },
        h('div', { class: 'dashboard-card__heading' },
          h('h3', row.position_title), statusPill(row.status)),
        h('p', { class: 'dashboard-card__event' }, row.project_title),
        metaList([
          ['Requested on', archiveDate(row.created_at)],
          ['Event starts', row.project_starts_on ? archiveDate(row.project_starts_on) : 'To be announced'],
          ['Registration', row.position_is_open ? 'Open' : 'Closed'],
        ]),
        row.admin_note ? h('div', { class: 'dashboard-card__note' },
          h('strong', 'Organiser feedback'), h('p', row.admin_note)) : null,
        row.unregister_block === 'window_closed'
          ? h('p', { class: 'event-request-card__notice' }, 'The event starts within 72 hours. Contact an organiser to withdraw.') : null,
        row.can_unregister ? h('div', { class: 'event-request-card__actions' },
          h('button', { type: 'button', class: 'btn-ghost', onclick: () => openUnregister(row) }, 'Unregister')) : null,
      );
    }

    function requestsPanel(): HTMLElement {
      if (requests.error) {
        return panel('Your requests',
          notice('err', `Your own requests could not load: ${requests.error}. Nothing has been lost — this is a display problem only.`),
          h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'btn-ghost', onclick: () => void draw() }, 'TRY AGAIN')),
        );
      }
      if (!mine.length) {
        return panel('Your requests', emptyState(
          'You have not registered for an event position yet.',
          'Requests you send stay listed here, including approved and cancelled ones.',
        ));
      }
      return panel('Your requests',
        h('p', { class: 'event-request-intro' }, 'Pending and approved registrations can be withdrawn online until 72 hours before the event starts.'),
        h('div', { class: 'dashboard-cards' }, mine.map(requestRow)),
      );
    }

    const active = mine.filter(row => row.status === 'approved' && row.has_active_assignment);
    const other = mine.filter(row => !(row.status === 'approved' && row.has_active_assignment));
    render(content,
      pageHeader('MEMBER / EVENTS', responsibilitiesView ? 'My responsibilities' : 'Open positions',
        h('a', { class: 'btn-ghost', href: responsibilitiesView ? '/portal/opportunities.html' : '/portal/opportunities.html?view=responsibilities' },
          responsibilitiesView ? 'Find an opportunity' : 'My responsibilities')),
      responsibilitiesView ? [
        h('p', { class: 'event-request-intro' }, 'Your accepted event roles appear first. Use these cards to check dates, organiser feedback and withdrawal options.'),
        requests.error ? notice('err', `Could not load responsibilities: ${requests.error}`) :
          panel('Accepted responsibilities', active.length
            ? h('div', { class: 'dashboard-cards' }, active.map(requestRow))
            : emptyState('No active assignments yet.', 'Accepted event roles will appear here once you are assigned.')),
        !requests.error && other.length ? panel('Other registrations',
          h('p', { class: 'event-request-intro' }, 'Pending, cancelled and previous registrations.'),
          h('div', { class: 'dashboard-cards' }, other.map(requestRow))) : null,
      ] : [
        notice('info', 'Browse event roles and register interest. Track accepted responsibilities and your registrations on My responsibilities.'),
        legend(), boardPanels(),
      ],
    );
  }

  await draw();
}

void start();
