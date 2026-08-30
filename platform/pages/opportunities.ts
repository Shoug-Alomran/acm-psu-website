/**
 * Event opportunities.
 *
 * Supabase is the source of truth. Registering and unregistering go through
 * transactional RPCs; Google Sheets is refreshed only after the database
 * operation succeeds.
 */

import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell,
  pageHeader,
  panel,
  statusPill,
  emptyState,
  loading,
  dialog,
  field,
  notice,
  toast,
  action,
} from '../lib/ui.js';
import { requireMember, canSubmit } from '../lib/session.js';
import { openOpportunities, myEventApplications } from '../lib/api.js';
import {
  registerEventApplication,
  unregisterEventApplication,
} from '../lib/event-applications.js';
import { archiveDate, enumLabel } from '../lib/format.js';

interface MyApplicationRow {
  id: string;
  event_position_id: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  position: {
    title: string;
    project_id: string;
  } | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
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
  const viewer = await requireMember();
  const content = shell(viewer, 'member', 'Opportunities');

  async function draw(): Promise<void> {
    render(content, loading('LOADING OPEN POSITIONS'));

    try {
      const [opportunities, mineRaw] = await Promise.all([
        openOpportunities(),
        myEventApplications(viewer.userId),
      ]);

      const mine = mineRaw as unknown as MyApplicationRow[];
      const applied = new Map(
        mine.map((row) => [row.event_position_id, row]),
      );

      const byProject = new Map<string, typeof opportunities>();
      for (const opportunity of opportunities) {
        const key = opportunity.project?.id ?? 'other';
        const list = byProject.get(key) ?? [];
        list.push(opportunity);
        byProject.set(key, list);
      }

      function openRegistration(
        opportunity: typeof opportunities[number],
      ): void {
        const status = h('div');
        const body = h(
          'div',
          { class: 'portal-form' },
          h(
            'p',
            { class: 'mono-meta dim-text' },
            `${opportunity.title.toUpperCase()} — ${opportunity.remaining} OF ${opportunity.openings} REMAINING`,
          ),
          field({
            label: 'When are you available?',
            name: 'availability',
            required: true,
            maxlength: 500,
            placeholder: 'e.g. Weekday afternoons, and the full event weekend',
          }),
          field({
            label: 'Anything the organisers should know?',
            name: 'note',
            type: 'textarea',
            rows: 3,
            maxlength: 800,
            hint: 'Optional.',
          }),
          status,
        );

        let modal: HTMLDialogElement;
        modal = dialog(
          `Register interest — ${opportunity.title}`,
          body,
          h(
            'div',
            { class: 'button-row' },
            action(
              'Send request',
              async () => {
                const form = modal.querySelector('form') as HTMLFormElement | null;
                if (!form) {
                  status.replaceChildren(
                    notice('err', 'The registration form could not be loaded.'),
                  );
                  return;
                }

                if (!form.reportValidity()) return;

                const values = formValues(form);
                const availability = textOf(values, 'availability').trim();
                const note = textOf(values, 'note').trim();

                if (!availability) {
                  status.replaceChildren(
                    notice('err', 'Tell the organisers when you are available.'),
                  );
                  return;
                }

                const existing = applied.get(opportunity.event_position_id);
                if (existing && existing.status !== 'cancelled') {
                  status.replaceChildren(
                    notice('warn', 'You already have a request for this position.'),
                  );
                  return;
                }

                if (opportunity.remaining <= 0) {
                  status.replaceChildren(
                    notice('warn', 'This position is now full.'),
                  );
                  return;
                }

                status.replaceChildren(notice('info', 'SAVING REQUEST…'));

                try {
                  await registerEventApplication({
                    eventPositionId: opportunity.event_position_id,
                    availability,
                    note: note || null,
                  });

                  modal.close();
                  toast('Request saved. An organiser will review it.');
                  await draw();
                } catch (error) {
                  console.error('Could not register for event position:', error);
                  status.replaceChildren(
                    notice(
                      'err',
                      `Could not save your request: ${errorMessage(error)}`,
                    ),
                  );
                }
              },
              'primary',
            ),
          ),
        );
      }

      function registerButton(
        opportunity: typeof opportunities[number],
      ): HTMLElement {
        const existing = applied.get(opportunity.event_position_id);

        if (existing && existing.status !== 'cancelled') {
          return statusPill(existing.status);
        }

        if (!canSubmit(viewer)) {
          return h(
            'span',
            { class: 'mono-meta dim-text' },
            'ACTIVE MEMBERS ONLY',
          );
        }

        if (opportunity.remaining <= 0) {
          return h('span', { class: 'mono-meta dim-text' }, 'FULL');
        }

        return h(
          'button',
          {
            type: 'button',
            class: 'btn-ghost',
            onclick: () => openRegistration(opportunity),
          },
          existing?.status === 'cancelled'
            ? 'Register again'
            : 'Register interest',
        );
      }

      function openUnregister(row: MyApplicationRow): void {
        const status = h('div');
        const positionTitle = row.position?.title ?? 'this position';

        let modal: HTMLDialogElement;
        modal = dialog(
          `Unregister — ${positionTitle}`,
          h(
            'div',
            {},
            notice(
              'warn',
              'You can unregister online until 72 hours before the event starts. ' +
                'Your request will remain in the club record as cancelled rather than being deleted.',
            ),
            status,
          ),
          h(
            'div',
            { class: 'button-row' },
            action(
              'Unregister',
              async () => {
                status.replaceChildren(notice('info', 'UNREGISTERING…'));

                try {
                  await unregisterEventApplication(row.id);
                  modal.close();
                  toast('You have been unregistered from that position.');
                  await draw();
                } catch (error) {
                  console.error('Could not unregister event application:', error);
                  status.replaceChildren(
                    notice(
                      'err',
                      `Could not unregister: ${errorMessage(error)}`,
                    ),
                  );
                }
              },
              'danger',
            ),
          ),
        );
      }

      render(
        content,
        pageHeader(
          'MEMBER / OPPORTUNITIES',
          'Open positions',
          h(
            'a',
            { class: 'btn-ghost', href: '/portal/index.html' },
            'Dashboard',
          ),
        ),
        notice(
          'info',
          'These are roles on upcoming ACM events. No prior experience is expected — ' +
            'that is what taking one is for. Approved involvement becomes part of your verified record.',
        ),
        opportunities.length
          ? [...byProject.entries()].map(([, list]) => {
              const project = list[0]?.project;
              return panel(
                project?.title ?? 'Other',
                project?.summary ? h('p', project.summary) : null,
                project?.starts_on
                  ? h(
                      'p',
                      { class: 'mono-meta dim-text' },
                      `STARTS ${archiveDate(project.starts_on)}`,
                    )
                  : null,
                h(
                  'div',
                  { class: 'browser-list' },
                  list.map((opportunity) =>
                    h(
                      'div',
                      {
                        class: 'browser-row',
                        style: { cursor: 'default' },
                      },
                      h(
                        'div',
                        { class: 'fname' },
                        h('span', { class: 'icon' }, '◆'),
                        h('span', opportunity.title),
                      ),
                      h(
                        'span',
                        { class: 'fcell' },
                        `${opportunity.remaining}/${opportunity.openings} OPEN`,
                      ),
                      h(
                        'span',
                        { class: 'fcell col-hide' },
                        opportunity.description ?? '',
                      ),
                      h(
                        'span',
                        { class: 'fcell col-hide' },
                        opportunity.closes_on
                          ? `CLOSES ${archiveDate(opportunity.closes_on)}`
                          : '',
                      ),
                      registerButton(opportunity),
                    ),
                  ),
                ),
              );
            })
          : panel(
              'Nothing open right now',
              emptyState(
                'There are no open positions at the moment.',
                'New roles are posted here whenever an event is being organised.',
              ),
            ),
        mine.length
          ? panel(
              'Your requests',
              h(
                'p',
                { class: 'mono-meta dim-text' },
                'Pending and approved registrations can be withdrawn online until 72 hours before the event starts.',
              ),
              h(
                'div',
                { class: 'history-list' },
                mine.map((row) =>
                  h(
                    'div',
                    { class: 'history-row' },
                    h(
                      'span',
                      { class: 'mono-meta' },
                      archiveDate(row.created_at),
                    ),
                    h(
                      'div',
                      {},
                      h(
                        'strong',
                        row.position?.title ?? enumLabel('event position'),
                      ),
                      ' ',
                      statusPill(row.status),
                      row.admin_note
                        ? h(
                            'p',
                            { class: 'mono-meta dim-text' },
                            row.admin_note,
                          )
                        : null,
                    ),
                    row.status === 'pending' || row.status === 'approved'
                      ? h(
                          'button',
                          {
                            type: 'button',
                            class: 'btn-ghost',
                            onclick: () => openUnregister(row),
                          },
                          'Unregister',
                        )
                      : null,
                  ),
                ),
              ),
            )
          : null,
      );
    } catch (error) {
      console.error('Opportunities page failed to load:', error);
      render(
        content,
        pageHeader(
          'MEMBER / OPPORTUNITIES',
          'Opportunities unavailable',
          h(
            'a',
            { class: 'btn-ghost', href: '/portal/index.html' },
            'Dashboard',
          ),
        ),
        notice(
          'err',
          `Open positions could not load: ${errorMessage(error)}`,
        ),
        h(
          'div',
          { class: 'button-row' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn-ghost',
              onclick: () => void draw(),
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
