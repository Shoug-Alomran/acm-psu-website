/**
 * Membership application.
 *
 * Deliberately short, and deliberately not a technical screening. It asks who
 * you are, what you are curious about, and — optionally — what you would like
 * to get experience in. There is no question about what you already know how
 * to do, because the club exists to give people that experience rather than to
 * select for it.
 */
import { h, formValues, textOf, asArray } from '../lib/dom.js';
import { wideAuthShell, field, chipPicker, notice, submitButton, loading } from '../lib/ui.js';
import { requireSignedIn } from '../lib/session.js';
import { isConfigured } from '../lib/supabase.js';
import { myApplication, submitApplication, setting } from '../lib/api.js';
import { render } from '../lib/dom.js';

const INTERESTS = [
  { value: 'programming',        label: 'Programming' },
  { value: 'cybersecurity',      label: 'Cybersecurity' },
  { value: 'ai',                 label: 'AI & Machine Learning' },
  { value: 'web-development',    label: 'Web Development' },
  { value: 'design-media',       label: 'Design & Media' },
  { value: 'event-organising',   label: 'Event Organising' },
  { value: 'workshops',          label: 'Teaching & Workshops' },
  { value: 'competitions',       label: 'Competitions & CTFs' },
  { value: 'documentation',      label: 'Writing & Documentation' },
  { value: 'community',          label: 'Community & Outreach' },
];

const ACADEMIC_YEARS = ['Foundation', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5+', 'Graduate']
  .map((y) => ({ value: y, label: y }));

async function start(): Promise<void> {
  if (!isConfigured) {
    wideAuthShell('Membership application', '',
      notice('warn', 'The application system is not connected yet. ' +
        'Please email the club in the meantime.'));
    return;
  }

  const card = wideAuthShell('Membership application', '', loading('CHECKING YOUR ACCOUNT'));
  const viewer = await requireSignedIn();

  const [existing, open, domains, clubEmail] = await Promise.all([
    myApplication(viewer.userId),
    setting<boolean>('applications_open', true),
    setting<string[]>('psu_email_domains', ['psu.edu.sa']),
    setting<string>('club_email', 'acm@psu.edu.sa'),
  ]);

  if (existing) { window.location.replace('/portal/status.html'); return; }

  if (!open) {
    render(card,
      h('div', {},
        h('div', { class: 'breadcrumb mono-meta' }, 'ACCESS'),
        h('h1', 'Applications are closed')),
      h('p', 'The club is not accepting new membership applications at the moment. ' +
        'Watch the website for the next intake.'),
      h('div', { class: 'button-row' },
        h('a', { class: 'btn-ghost', href: '/index.html' }, 'Back to the website'),
        h('a', { class: 'btn-ghost', href: `mailto:${clubEmail}` }, 'Contact ACM')));
    return;
  }

  const status = h('div');

  const form = h('form', { class: 'portal-form', novalidate: true },
    h('div', { class: 'field-pair' },
      field({ label: 'Full name', name: 'full_name', required: true, maxlength: 120,
              value: viewer.user.full_name }),
      field({ label: 'PSU student ID', name: 'student_id', required: true,
              value: viewer.user.student_id, hint: 'Digits only.' })),

    h('div', { class: 'field-pair' },
      field({ label: 'PSU email', name: 'psu_email', type: 'email', required: true,
              value: viewer.email,
              hint: `Must be a ${domains.map((d) => '@' + d).join(' or ')} address.` }),
      field({ label: 'Major', name: 'major', required: true, value: viewer.user.major,
              placeholder: 'e.g. Software Engineering' })),

    field({ label: 'Academic year', name: 'academic_year', type: 'select', required: true,
            options: [{ value: '', label: 'Select…' }, ...ACADEMIC_YEARS] }),

    h('div', { class: 'form-field' },
      h('span', { class: 'mono-meta' }, 'AREAS OF INTEREST', h('span', { class: 'accent-text' }, ' *')),
      h('p', { class: 'field-hint mono-meta dim-text' },
        'Pick anything that sounds interesting. No experience is expected in any of them.'),
      chipPicker('interests', INTERESTS)),

    field({ label: 'What would you like to get experience in?', name: 'goal_text',
            type: 'textarea', rows: 4, maxlength: 1500,
            hint: 'Optional. A sentence or two is plenty.' }),

    status,
    submitButton('Submit application'),
  ) as HTMLFormElement;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const values = formValues(form);
    const interests = asArray(values.interests);
    const studentId = textOf(values, 'student_id').replace(/\D/g, '');
    const psuEmail = textOf(values, 'psu_email').toLowerCase();
    const button = form.querySelector('button')!;

    if (!interests.length) {
      status.replaceChildren(notice('err', 'Choose at least one area of interest.'));
      return;
    }
    if (!/^\d{6,12}$/.test(studentId)) {
      status.replaceChildren(notice('err', 'A PSU student ID is 6 to 12 digits.'));
      return;
    }
    if (!domains.some((domain) => psuEmail.endsWith('@' + domain.toLowerCase()))) {
      status.replaceChildren(notice('err',
        `Membership needs a university address (${domains.map((d) => '@' + d).join(', ')}). ` +
        `You can still sign in with ${viewer.email}.`));
      return;
    }

    button.disabled = true;
    status.replaceChildren(notice('info', 'SUBMITTING…'));

    try {
      await submitApplication({
        user_id: viewer.userId,
        full_name: textOf(values, 'full_name'),
        student_id: studentId,
        psu_email: psuEmail,
        major: textOf(values, 'major'),
        academic_year: textOf(values, 'academic_year'),
        interests,
        goal_text: textOf(values, 'goal_text') || null,
      });
      window.location.replace('/portal/status.html');
    } catch (error) {
      button.disabled = false;
      status.replaceChildren(notice('err', error instanceof Error ? error.message : String(error)));
    }
  });

  render(card,
    h('a', { class: 'auth-brand', href: '/index.html', 'aria-label': 'ACM PSU — home' },
      h('img', { src: '/assets/img/acm.png', alt: '' }),
      h('span', 'ACM'), h('span', { class: 'divider dim-text' }, '/'), h('span', 'PSU')),
    h('div', {},
      h('div', { class: 'breadcrumb mono-meta' }, 'MEMBERSHIP / APPLICATION'),
      h('h1', 'Membership application'),
      h('p', 'Everything except the last question is required. ' +
        'You do not need any prior technical experience to join.')),
    form);
}

void start();
