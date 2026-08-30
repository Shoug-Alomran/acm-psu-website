/** Membership application review queue. */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, attentionRow, attentionLegend, ageAttention,
  dataTable, loading, dialog, field, notice, toast, action, emptyState,
  reasonField, internalNoteField, checkReason,
} from '../lib/ui.js';
import { historyPanel } from '../lib/history.js';
import { requireAdmin } from '../lib/session.js';
import {
  applications, applicationNotes, addApplicationNote, markForInterview,
  approveApplication, rejectApplication, type ApplicationRow,
} from '../lib/admin.js';
import { positions } from '../lib/api.js';
import { requireClient } from '../lib/supabase.js';
import { archiveDate, archiveDateTime } from '../lib/format.js';
import type { Position } from '../lib/types.js';

type ApplicationWithExperience = ApplicationRow & {
  experience_status?: 'none' | 'some' | 'not_provided' | null;
  experience_text?: string | null;
};

interface AiApplicantSummary {
  summary: string;
  previous_experience: {
    status: 'reported' | 'none' | 'not_provided';
    details: string | null;
  };
  interests: string[];
  goals: string | null;
  useful_follow_up: string[];
}

const FILTERS: Array<[string, string[]]> = [
  ['Open', ['submitted', 'interview']],
  ['Approved', ['approved']],
  ['Not accepted', ['rejected']],
  ['All', ['submitted', 'interview', 'approved', 'rejected', 'withdrawn']],
];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error &&
      typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return 'An unknown error occurred.';
}

function section(title: string, ...children: Array<HTMLElement | string | null>): HTMLElement {
  return h('section', {
    style: {
      border: '1px solid var(--border-color)',
      padding: '1.15rem 1.25rem',
      display: 'grid',
      gap: '0.85rem',
    },
  },
    h('p', { class: 'mono-meta dim-text', style: { margin: '0' } }, title.toUpperCase()),
    ...children,
  );
}

function keyValueGrid(items: Array<[string, string | HTMLElement]>): HTMLElement {
  return h('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
      gap: '1rem 1.5rem',
    },
  }, items.map(([label, value]) =>
    h('div', {},
      h('p', { class: 'mono-meta dim-text', style: { margin: '0 0 0.3rem' } }, label.toUpperCase()),
      typeof value === 'string' ? h('p', { style: { margin: '0' } }, value) : value,
    ),
  ));
}

function experienceLabel(application: ApplicationWithExperience): string {
  if (application.experience_status === 'some') return application.experience_text || 'Experience reported.';
  if (application.experience_status === 'none') return 'No previous experience yet.';
  return 'Not provided on this application.';
}

async function start(): Promise<void> {
  const viewer = await requireAdmin('club_admin');
  const content = shell(viewer, 'admin', 'Applications');
  render(content, loading());

  let positionList: Position[] = [];
  try {
    positionList = await positions();
  } catch (error) {
    render(content,
      pageHeader('ADMIN / APPLICATIONS', 'Membership applications unavailable'),
      notice('err', `Could not load club positions: ${errorMessage(error)}`));
    return;
  }

  let filter = 0;

  async function generateAiSummary(application: ApplicationWithExperience, target: HTMLElement): Promise<void> {
    target.replaceChildren(notice('info', 'GENERATING AI SUMMARY…'));
    try {
      const { data, error } = await requireClient().functions.invoke('application-summary', {
        body: { application_id: application.id },
      });
      if (error) throw new Error(error.message);
      const result = data?.summary as AiApplicantSummary | undefined;
      if (!result) throw new Error('The AI worker returned no summary.');

      const experienceStatus = result.previous_experience.status === 'reported'
        ? 'Previous experience reported'
        : result.previous_experience.status === 'none'
          ? 'No previous experience yet'
          : 'Previous experience not provided';

      target.replaceChildren(
        h('div', { style: { display: 'grid', gap: '1rem' } },
          notice('info', 'AI assistance is advisory only. It does not score, rank, approve, reject, or recommend a membership decision.'),
          h('p', { style: { margin: '0', lineHeight: '1.65' } }, result.summary),
          keyValueGrid([
            ['Experience', experienceStatus],
            ['Experience details', result.previous_experience.details ?? '—'],
            ['Interests', result.interests.join(', ') || '—'],
            ['Goals', result.goals ?? '—'],
          ]),
          result.useful_follow_up.length
            ? h('div', {},
                h('p', { class: 'mono-meta dim-text' }, 'USEFUL FOLLOW-UP'),
                h('ul', { style: { margin: '0', paddingLeft: '1.25rem', lineHeight: '1.7' } },
                  result.useful_follow_up.map((question) => h('li', question))))
            : null,
        ),
      );
    } catch (error) {
      target.replaceChildren(notice('err', `Could not generate AI summary: ${errorMessage(error)}`));
    }
  }

  async function openApplication(rawApplication: ApplicationRow): Promise<void> {
    const application = rawApplication as ApplicationWithExperience;
    let notes;
    try {
      notes = await applicationNotes(application.id);
    } catch (error) {
      toast(`Could not open application: ${errorMessage(error)}`);
      return;
    }

    const decided = application.status === 'approved' || application.status === 'rejected';
    const aiPanel = h('div', {},
      h('p', { class: 'mono-meta dim-text' }, 'No AI summary generated yet.'),
    );

    const noteField = field({
      label: 'Add an interview note', name: 'note', type: 'textarea', rows: 3,
      hint: 'Internal only. Applicants can never read these.',
    });

    const decisionForm = h('form', { class: 'portal-form', novalidate: true },
      h('div', { class: 'field-pair' },
        field({
          label: 'Position on approval', name: 'position_id', type: 'select',
          value: positionList.find((position) => position.slug === 'member')?.id ?? '',
          options: [
            { value: '', label: '— no position yet —' },
            ...positionList.map((position) => ({ value: position.id, label: position.title })),
          ],
        }),
        field({
          label: 'Membership start date', name: 'start_date', type: 'date',
          value: new Date().toISOString().slice(0, 10),
        }),
      ),
      reasonField({
        label: 'Reason for this decision',
        hint: 'Required when declining. Recorded permanently and shown to the applicant.',
      }),
      internalNoteField(),
    ) as HTMLFormElement;

    const identityItems: Array<[string, string | HTMLElement]> = [
      ['Status', statusPill(application.status)],
      ['Submitted', archiveDate(application.created_at)],
      ['Student ID', application.student_id],
      ['PSU email', application.psu_email],
      ['Major', application.major],
      ['Academic year', application.academic_year],
    ];
    if (application.applicant?.email && application.applicant.email !== application.psu_email) {
      identityItems.push(['Account email', application.applicant.email]);
    }

    const body = h('div', { style: { display: 'grid', gap: '1rem' } },
      section('Applicant', keyValueGrid(identityItems)),
      section('Interests',
        h('p', { style: { margin: '0', lineHeight: '1.6' } }, application.interests.join(', ') || 'No interests provided.')),
      section('Previous experience',
        h('p', { style: { margin: '0', lineHeight: '1.65' } }, experienceLabel(application))),
      section('What they want from ACM',
        h('p', { style: { margin: '0', lineHeight: '1.65' } }, application.goal_text || 'No response provided.')),
      section('AI applicant summary',
        h('div', { class: 'button-row' },
          action('GENERATE AI SUMMARY', async () => generateAiSummary(application, aiPanel))),
        aiPanel),
      section('Activity', historyPanel('application', application.id, application.user_id)),
      section('Interview notes',
        notes.length
          ? h('div', { class: 'history-list' }, notes.map((note) =>
              h('div', { class: 'history-row' },
                h('span', { class: 'mono-meta' }, archiveDateTime(note.created_at)),
                h('span', note.body))))
          : h('p', { class: 'mono-meta dim-text' }, 'None yet.'),
        h('form', { class: 'portal-form' },
          noteField,
          h('div', { class: 'button-row' },
            action('Add note', async () => {
              const textarea = noteField.querySelector('textarea') as HTMLTextAreaElement | null;
              const note = textarea?.value.trim() ?? '';
              if (!note) { toast('Write a note first.'); return; }
              try {
                await addApplicationNote(application.id, note);
                modal.close();
                toast('Note saved.');
                await draw();
              } catch (error) {
                toast(`Could not save note: ${errorMessage(error)}`);
              }
            }),
          ),
        )),
      decided ? notice('info', 'This application has already been decided.') : section('Decision', decisionForm),
    );

    const modal = dialog(
      application.full_name,
      body,
      decided ? null : h('div', { class: 'button-row' },
        action('Approve', async () => {
          if (!decisionForm.reportValidity()) return;
          const values = formValues(decisionForm);
          try {
            await approveApplication(
              application.id,
              textOf(values, 'position_id') || null,
              textOf(values, 'start_date') || new Date().toISOString().slice(0, 10),
              textOf(values, 'reason') || null,
              textOf(values, 'internal') || null,
            );
            modal.close();
            toast(`${application.full_name} is now an active member.`);
            await draw();
          } catch (error) {
            toast(`Could not approve application: ${errorMessage(error)}`);
          }
        }, 'primary'),
        application.status === 'submitted'
          ? action('Mark for interview', async () => {
              const values = formValues(decisionForm);
              try {
                await markForInterview(application.id, textOf(values, 'reason') || null);
                modal.close();
                toast('Marked for interview.');
                await draw();
              } catch (error) {
                toast(`Could not update application: ${errorMessage(error)}`);
              }
            })
          : null,
        action('Not accepted', async () => {
          const values = formValues(decisionForm);
          const reason = checkReason(textOf(values, 'reason'), 'decline this application');
          if (!reason) return;
          try {
            await rejectApplication(application.id, reason, textOf(values, 'internal') || null);
            modal.close();
            toast('Application declined.');
            await draw();
          } catch (error) {
            toast(`Could not decline application: ${errorMessage(error)}`);
          }
        }, 'danger'),
      ),
    );

    modal.style.width = 'min(70rem, calc(100vw - 3rem))';
    modal.style.maxWidth = '70rem';
    modal.style.margin = 'auto';
  }

  async function draw(): Promise<void> {
    render(content, loading());
    try {
      const selected = FILTERS[filter];
      if (!selected) throw new Error('Invalid application filter.');
      const rows = await applications(selected[1]);

      render(content,
        pageHeader('ADMIN / APPLICATIONS', 'Membership applications'),
        h('div', { class: 'browser-toolbar' }, FILTERS.map(([label], index) =>
          h('button', {
            type: 'button',
            class: index === filter ? 'btn-ghost active' : 'btn-ghost',
            style: index === filter ? { borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' } : {},
            onclick: () => { filter = index; void draw(); },
          }, label))),
        attentionLegend(
          ['now', 'Waiting 14 days or more'],
          ['review', 'Waiting on a decision'],
          ['ok', 'Decided'],
        ),
        panel(`${rows.length} application${rows.length === 1 ? '' : 's'}`,
          rows.length
            ? dataTable(
                ['Applicant', 'Major / year', 'Interests', 'Experience', 'Submitted', 'Status', ''],
                rows.map((row) => {
                  const application = row as ApplicationWithExperience;
                  const experience = application.experience_status === 'some'
                    ? 'YES'
                    : application.experience_status === 'none' ? 'NOT YET' : '—';
                  return [
                    h('div', {},
                      h('strong', application.full_name),
                      h('p', { class: 'mono-meta dim-text' }, application.psu_email)),
                    h('div', {},
                      h('span', application.major),
                      h('p', { class: 'mono-meta dim-text' }, `YEAR ${application.academic_year}`)),
                    h('span', { class: 'mono-meta dim-text' },
                      application.interests.slice(0, 3).join(', ') +
                      (application.interests.length > 3 ? ` +${application.interests.length - 3}` : '')),
                    h('span', { class: 'mono-meta' }, experience),
                    h('span', { class: 'mono-meta' }, archiveDate(application.created_at)),
                    statusPill(application.status),
                    action('Review', async () => openApplication(application)),
                  ];
                }),
                {
                  rowClass: (index) => {
                    const row = rows[index];
                    if (!row) return '';
                    if (row.status === 'approved' || row.status === 'rejected') return attentionRow('ok');
                    return attentionRow(ageAttention(row.created_at));
                  },
                },
              )
            : emptyState('NO RECORDS', 'Nothing in this queue.', 'Applications appear here as soon as students submit them.')),
        notice('info', 'Membership is not a technical screening. Prior experience can help you understand an applicant, but it is never a requirement or a score.'),
      );
    } catch (error) {
      render(content,
        pageHeader('ADMIN / APPLICATIONS', 'Membership applications'),
        notice('err', `Could not load applications: ${errorMessage(error)}`));
    }
  }

  await draw();
}

void start();
