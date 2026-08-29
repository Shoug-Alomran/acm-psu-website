/**
 * Event opportunities.
 *
 * The point of this page is that opportunity is visible to everyone rather
 * than circulating privately. Every open role on every upcoming event is
 * listed, with how many places are left, and registering interest asks for
 * only what a decision actually needs.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, emptyState, loading, dialog, field,
  notice, toast, action,
} from '../lib/ui.js';
import { requireMember, canSubmit } from '../lib/session.js';
import { openOpportunities, myEventApplications, registerInterest } from '../lib/api.js';
import { archiveDate, enumLabel } from '../lib/format.js';

interface MyApplicationRow {
  id: string;
  event_position_id: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  position: { title: string; project_id: string } | null;
}

async function start(): Promise<void> {
  const viewer = await requireMember();
  const content = shell(viewer, 'member', 'Opportunities');
  render(content, loading('LOADING OPEN POSITIONS'));

  async function draw(): Promise<void> {
    const [opportunities, mine] = await Promise.all([
      openOpportunities(),
      myEventApplications(viewer.userId) as Promise<MyApplicationRow[]>,
    ]);

    const applied = new Map(mine.map((row) => [row.event_position_id, row]));

    // One card per project, its roles listed underneath.
    const byProject = new Map<string, typeof opportunities>();
    for (const opportunity of opportunities) {
      const key = opportunity.project?.id ?? 'other';
      const list = byProject.get(key) ?? [];
      list.push(opportunity);
      byProject.set(key, list);
    }

    function registerButton(opportunity: typeof opportunities[number]) {
      const existing = applied.get(opportunity.event_position_id);
      if (existing) return statusPill(existing.status);
      if (!canSubmit(viewer)) {
        return h('span', { class: 'mono-meta dim-text' }, 'ACTIVE MEMBERS ONLY');
      }
      if (opportunity.remaining <= 0) {
        return h('span', { class: 'mono-meta dim-text' }, 'FULL');
      }

      return h('button', {
        type: 'button', class: 'btn-ghost',
        onclick: () => {
          const status = h('div');
          const form = h('form', { class: 'portal-form' },
            h('p', { class: 'mono-meta dim-text' },
              `${opportunity.title.toUpperCase()} — ${opportunity.remaining} OF ${opportunity.openings} REMAINING`),
            field({ label: 'When are you available?', name: 'availability', required: true,
                    placeholder: 'e.g. Weekday afternoons, and the full event weekend' }),
            field({ label: 'Anything the organisers should know?', name: 'note',
                    type: 'textarea', rows: 3, maxlength: 800, hint: 'Optional.' }),
            status,
          ) as HTMLFormElement;

          const modal = dialog(`Register interest — ${opportunity.title}`, form,
            h('div', { class: 'button-row' },
              action('Send request', async () => {
                if (!form.reportValidity()) return;
                const values = formValues(form);
                await registerInterest({
                  event_position_id: opportunity.event_position_id,
                  user_id: viewer.userId,
                  availability: textOf(values, 'availability'),
                  note: textOf(values, 'note') || null,
                });
                modal.close();
                toast('Request sent. An organiser will review it.');
                await draw();
              }, 'primary')));
        },
      }, 'Register interest');
    }

    render(content,
      pageHeader('MEMBER / OPPORTUNITIES', 'Open positions',
        h('a', { class: 'btn-ghost', href: '/portal/index.html' }, 'Dashboard')),

      notice('info',
        'These are roles on upcoming ACM events. No prior experience is expected — ' +
        'that is what taking one is for. Approved involvement becomes part of your verified record.'),

      opportunities.length
        ? [...byProject.entries()].map(([, list]) => {
            const project = list[0]?.project;
            return panel(project?.title ?? 'Other',
              project?.summary ? h('p', project.summary) : null,
              project?.starts_on
                ? h('p', { class: 'mono-meta dim-text' }, `STARTS ${archiveDate(project.starts_on)}`)
                : null,
              h('div', { class: 'browser-list' },
                list.map((opportunity) => h('div', { class: 'browser-row', style: { cursor: 'default' } },
                  h('div', { class: 'fname' },
                    h('span', { class: 'icon' }, '◆'),
                    h('span', opportunity.title)),
                  h('span', { class: 'fcell' },
                    `${opportunity.remaining}/${opportunity.openings} OPEN`),
                  h('span', { class: 'fcell col-hide' }, opportunity.description ?? ''),
                  h('span', { class: 'fcell col-hide' },
                    opportunity.closes_on ? `CLOSES ${archiveDate(opportunity.closes_on)}` : ''),
                  registerButton(opportunity)))));
          })
        : panel('Nothing open right now',
            emptyState('There are no open positions at the moment.',
              'New roles are posted here whenever an event is being organised.')),

      mine.length
        ? panel('Your requests',
            h('div', { class: 'history-list' },
              mine.map((row) => h('div', { class: 'history-row' },
                h('span', { class: 'mono-meta' }, archiveDate(row.created_at)),
                h('div', {},
                  h('strong', row.position?.title ?? enumLabel('event position')), ' ',
                  statusPill(row.status),
                  row.admin_note ? h('p', { class: 'mono-meta dim-text' }, row.admin_note) : null)))))
        : null,
    );
  }

  await draw();
}

void start();
