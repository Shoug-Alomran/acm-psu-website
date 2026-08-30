/** Membership application review queue. */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, attentionRow, attentionLegend, ageAttention,
  dataTable, loading, dialog, field, notice, toast, action, emptyState,
} from '../lib/ui.js';
import { historyPanel } from '../lib/history.js';
import { requireAdmin } from '../lib/session.js';
import {
  applications, markForInterview, approveApplication, rejectApplication,
  type ApplicationRow,
} from '../lib/admin.js';
import { requireClient } from '../lib/supabase.js';
import { archiveDate } from '../lib/format.js';

type ApplicationWithExperience = ApplicationRow & {
  experience_status?: 'none' | 'some' | 'not_provided' | null;
  experience_text?: string | null;
  preferred_position_id?: string | null;
};

interface MemberPositionChoice {
  id: string;
  title: string;
  category: string;
  rank: number;
  max_holders: number | null;
  filled: number;
  remaining: number | null;
}

interface AiApplicantSummary {
  summary: string;
  content_check: {
    quality: 'clear' | 'needs_clarification' | 'insufficient';
    confidence: number;
    rationale: string;
  };
  previous_experience: {
    status: 'reported' | 'none' | 'not_provided';
    details: string | null;
  };
  interests: string[];
  goals: string | null;
  useful_follow_up: string[];
}

const FILTERS: Array<[string, string[]]> = [
  ['Open', ['submitted']],
  ['Interviews', ['interview']],
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
      gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
      gap: '1rem 1.5rem',
    },
  }, items.map(([label, value]) =>
    h('div', {},
      h('p', { class: 'mono-meta dim-text', style: { margin: '0 0 0.3rem' } }, label.toUpperCase()),
      typeof value === 'string' ? h('p', { style: { margin: '0', lineHeight: '1.55' } }, value) : value,
    ),
  ));
}

function experienceLabel(application: ApplicationWithExperience): string {
  if (application.experience_status === 'some') return application.experience_text || 'Previous experience reported.';
  if (application.experience_status === 'none') return 'No previous experience yet.';
  return 'Not provided.';
}

function confidenceBadge(value: number): HTMLElement {
  const safe = Math.max(0, Math.min(100, Math.round(value)));
  return h('div', {
    style: {
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: '0.45rem',
      border: '1px solid var(--accent-blue)',
      padding: '0.55rem 0.75rem',
      width: 'fit-content',
    },
  },
    h('strong', { style: { fontSize: '1.45rem' } }, `${safe}%`),
    h('span', { class: 'mono-meta dim-text' }, 'CONTENT CONFIDENCE'),
  );
}

async function start(): Promise<void> {
  const viewer = await requireAdmin('club_admin');
  const content = shell(viewer, 'admin', 'Applications');
  render(content, loading());

  let positionList: MemberPositionChoice[] = [];
  try {
    const { data, error } = await requireClient().rpc('member_position_choices');
    if (error) throw new Error(error.message);
    positionList = (data ?? []) as MemberPositionChoice[];
  } catch (error) {
    render(content,
      pageHeader('ADMIN / APPLICATIONS', 'Membership applications unavailable'),
      notice('err', `Could not load available club roles: ${errorMessage(error)}`));
    return;
  }
  const positionTitle = new Map(positionList.map((position) => [position.id, position.title]));

  let filter = 0;

  async function generateAiSummary(
    application: ApplicationWithExperience,
    target: HTMLElement,
  ): Promise<AiApplicantSummary> {
    target.replaceChildren(notice('info', 'CHECKING APPLICATION CONTENT WITH AI…'));

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

    const quality = result.content_check.quality === 'clear'
      ? 'CLEAR'
      : result.content_check.quality === 'needs_clarification'
        ? 'NEEDS CLARIFICATION'
        : 'INSUFFICIENT';

    target.replaceChildren(
      h('div', { style: { display: 'grid', gap: '1rem' } },
        h('div', {
          style: {
            display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center',
            justifyContent: 'space-between',
          },
        },
          h('div', {},
            h('p', { class: 'mono-meta dim-text', style: { margin: '0 0 0.25rem' } }, 'CONTENT CHECK'),
            h('strong', quality),
          ),
          confidenceBadge(result.content_check.confidence),
        ),
        h('p', { style: { margin: '0', lineHeight: '1.65' } }, result.content_check.rationale),
        notice('info', 'The percentage is confidence that the submitted information is clear enough to summarize for an interview. It is not an acceptance score.'),
        h('p', { style: { margin: '0', lineHeight: '1.65' } }, result.summary),
        keyValueGrid([
          ['Experience', experienceStatus],
          ['Experience details', result.previous_experience.details ?? '—'],
          ['Interests', result.interests.join(', ') || '—'],
          ['Goals', result.goals ?? '—'],
        ]),
        result.useful_follow_up.length
          ? h('div', {},
              h('p', { class: 'mono-meta dim-text' }, 'INTERVIEW FOLLOW-UP'),
              h('ul', { style: { margin: '0', paddingLeft: '1.25rem', lineHeight: '1.7' } },
                result.useful_follow_up.map((question) => h('li', question))))
          : null,
      ),
    );

    return result;
  }

  async function openApplication(rawApplication: ApplicationRow): Promise<void> {
    const application = rawApplication as ApplicationWithExperience;
    const decided = application.status === 'approved' || application.status === 'rejected';
    const aiPanel = h('div', {});
    let aiComplete = false;
    let interviewButton: HTMLButtonElement | null = null;
    const preferredRole = application.preferred_position_id
      ? (positionTitle.get(application.preferred_position_id) ?? 'Previously selected role')
      : 'General member';

    const identityItems: Array<[string, string | HTMLElement]> = [
      ['Status', statusPill(application.status)],
      ['Submitted', archiveDate(application.created_at)],
      ['Student ID', application.student_id],
      ['PSU email', application.psu_email],
      ['Major', application.major],
      ['Academic year', application.academic_year],
      ['Chapter', application.chapter_year],
    ];
    if (application.applicant?.email && application.applicant.email !== application.psu_email) {
      identityItems.push(['Account email', application.applicant.email]);
    }

    const body = h('div', { style: { display: 'grid', gap: '1rem' } },
      section('Applicant', keyValueGrid(identityItems)),
      section('Membership preference',
        keyValueGrid([
          ['Preferred standing role', preferredRole],
          ['Event roles', 'Chosen separately from Opportunities after membership approval'],
        ]),
        h('p', { class: 'mono-meta dim-text', style: { margin: '0' } },
          application.preferred_position_id
            ? 'This is the applicant’s preference, not an automatic assignment. The committee can approve them as a general member or choose another available role after the interview.'
            : 'They applied as a general member. No standing club role is required; they can sign up for event-specific positions as opportunities open.')),
      section('Interests',
        h('p', { style: { margin: '0', lineHeight: '1.6' } }, application.interests.join(', ') || 'No interests provided.')),
      section('Previous experience',
        h('p', { style: { margin: '0', lineHeight: '1.65' } }, experienceLabel(application))),
      section('What they want from ACM',
        h('p', { style: { margin: '0', lineHeight: '1.65' } }, application.goal_text || 'No response provided.')),
      section('AI application check', aiPanel),
      section('Activity', historyPanel('application', application.id, application.user_id)),
    );

    const footer = h('div', { class: 'button-row' });

    if (!decided && application.status === 'submitted') {
      interviewButton = action('CONTACT FOR INTERVIEW', async () => {
        if (!aiComplete) {
          toast('Wait for the AI application check to finish first.');
          return;
        }
        try {
          await markForInterview(
            application.id,
            'Your application has moved to the interview stage. ACM will contact you with interview details.',
          );
          modal.close();
          toast('Applicant moved to interview. Their status page now shows the interview stage.');
          await draw();
        } catch (error) {
          toast(`Could not move application to interview: ${errorMessage(error)}`);
        }
      }, 'primary') as HTMLButtonElement;
      interviewButton.disabled = true;
      footer.append(interviewButton);
    }

    if (!decided && application.status === 'interview') {
      const preferredStillAvailable = application.preferred_position_id
        && positionList.some((position) => position.id === application.preferred_position_id)
        ? application.preferred_position_id
        : '';
      const passForm = h('form', { class: 'portal-form', novalidate: true },
        h('div', { class: 'field-pair' },
          field({
            label: 'Standing club role after passing', name: 'position_id', type: 'select',
            value: preferredStillAvailable,
            options: [
              { value: '', label: 'General member — no standing club role' },
              ...positionList.map((position) => ({
                value: position.id,
                label: position.max_holders === null
                  ? `${position.title} — available`
                  : `${position.title} — ${position.remaining ?? 0} seat${position.remaining === 1 ? '' : 's'} available`,
              })),
            ],
            hint: application.preferred_position_id
              ? `Applicant preference: ${preferredRole}. You may keep that choice, choose another available role, or approve them as a general member.`
              : 'They applied as a general member. A standing role is optional.',
          }),
          field({
            label: 'Membership start date', name: 'start_date', type: 'date', required: true,
            value: new Date().toISOString().slice(0, 10),
          }),
        ),
      ) as HTMLFormElement;

      const rejectForm = h('form', { class: 'portal-form', novalidate: true },
        field({
          label: 'Reason they did not pass the interview', name: 'reason', type: 'textarea', rows: 4,
          required: true, maxlength: 1500,
          hint: 'Required. This is shown to the applicant on their status page.',
        }),
      ) as HTMLFormElement;

      body.append(
        section('Interview decision',
          notice('info', 'Passing always creates the active membership. A standing club role is optional: general members can sign up for event-specific positions from Opportunities. If they do not pass, the reason below is shown to them.'),
          passForm,
          h('div', { class: 'button-row' },
            action('PASS INTERVIEW & ADD MEMBER', async () => {
              if (!passForm.reportValidity()) return;
              const values = formValues(passForm);
              const selectedPosition = textOf(values, 'position_id') || null;
              try {
                await approveApplication(
                  application.id,
                  selectedPosition,
                  textOf(values, 'start_date') || new Date().toISOString().slice(0, 10),
                  selectedPosition
                    ? 'Interview completed successfully. Welcome to ACM PSU.'
                    : 'Interview completed successfully. Added as a general ACM member.',
                  null,
                );
                modal.close();
                toast(selectedPosition
                  ? `${application.full_name} is now an active member with a standing club role.`
                  : `${application.full_name} is now an active general member.`);
                await draw();
              } catch (error) {
                toast(`Could not approve application: ${errorMessage(error)}`);
              }
            }, 'primary'),
          ),
          rejectForm,
          h('div', { class: 'button-row' },
            action('DID NOT PASS INTERVIEW', async () => {
              if (!rejectForm.reportValidity()) return;
              const values = formValues(rejectForm);
              const reason = textOf(values, 'reason').trim();
              if (!reason) return;
              try {
                await rejectApplication(application.id, reason, null);
                modal.close();
                toast('Interview outcome recorded and visible to the applicant.');
                await draw();
              } catch (error) {
                toast(`Could not record interview outcome: ${errorMessage(error)}`);
              }
            }, 'danger'),
          ),
        ),
      );
    }

    if (decided) {
      body.append(notice('info', 'This application has already been decided.'));
    }

    const modal = dialog(application.full_name, body, footer.childNodes.length ? footer : null);
    modal.style.width = 'min(72rem, calc(100vw - 3rem))';
    modal.style.maxWidth = '72rem';
    modal.style.margin = 'auto';

    try {
      await generateAiSummary(application, aiPanel);
      aiComplete = true;
      if (interviewButton) interviewButton.disabled = false;
    } catch (error) {
      aiPanel.replaceChildren(
        notice('err', `Could not generate AI application check: ${errorMessage(error)}`),
        h('div', { class: 'button-row' },
          action('RETRY AI CHECK', async () => {
            try {
              await generateAiSummary(application, aiPanel);
              aiComplete = true;
              if (interviewButton) interviewButton.disabled = false;
            } catch (retryError) {
              aiPanel.replaceChildren(notice('err', `Could not generate AI application check: ${errorMessage(retryError)}`));
            }
          }),
        ),
      );
    }
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
                ['Applicant', 'Major / year', 'Interests', 'Experience', 'Preference', 'Submitted', 'Status', ''],
                rows.map((row) => {
                  const application = row as ApplicationWithExperience;
                  const experience = application.experience_status === 'some'
                    ? 'YES'
                    : application.experience_status === 'none' ? 'NOT YET' : '—';
                  const preference = application.preferred_position_id
                    ? (positionTitle.get(application.preferred_position_id) ?? 'ROLE PREFERENCE')
                    : 'GENERAL MEMBER';
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
                    h('span', { class: 'mono-meta' }, preference),
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
                    return attentionRow(ageAttention(row.created_at).level);
                  },
                },
              )
            : emptyState('Nothing in this queue.', 'Applications appear here as soon as students submit them.')),
        notice('info', 'Workflow: review the submitted information → AI checks clarity/completeness → contact for interview → record the interview outcome. General membership and standing club roles are separate from event-specific positions.'),
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
