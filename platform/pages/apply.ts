/** Membership application: concise, relevant, and intentionally non-competitive. */
import { h, formValues, textOf, asArray, render } from '../lib/dom.js';
import { wideAuthShell, field, chipPicker, notice, submitButton, loading } from '../lib/ui.js';
import { requireSignedIn } from '../lib/session.js';
import { isConfigured, requireClient } from '../lib/supabase.js';
import { myApplication, setting } from '../lib/api.js';
import { INTERESTS, ACADEMIC_YEARS, knownInterests } from '../lib/membership.js';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error &&
      typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return 'An unknown error occurred.';
}

async function start(): Promise<void> {
  if (!isConfigured) {
    wideAuthShell('Membership application', '', notice('warn',
      'The application system is not connected yet. Please email the club in the meantime.'));
    return;
  }

  const card = wideAuthShell('Membership application', '', loading('CHECKING YOUR ACCOUNT'));

  let viewer;
  try {
    viewer = await requireSignedIn();
  } catch (error) {
    render(card,
      notice('err', `Could not load your account: ${errorMessage(error)}`),
      h('a', { class: 'btn-ghost', href: '/portal/login.html' }, 'Back to sign in'));
    return;
  }

  try {
    if (await myApplication(viewer.userId)) {
      window.location.replace('/portal/status.html');
      return;
    }
  } catch (error) {
    render(card, notice('err', `Could not check your application status: ${errorMessage(error)}`));
    return;
  }

  const [openResult, domainsResult] = await Promise.allSettled([
    setting<boolean>('applications_open', true),
    setting<string[]>('psu_email_domains', ['psu.edu.sa']),
  ]);
  const applicationsOpen = openResult.status === 'fulfilled' ? openResult.value : true;
  const domains = domainsResult.status === 'fulfilled' && domainsResult.value.length
    ? domainsResult.value.map((domain) => String(domain).trim().replace(/^@/, '').toLowerCase()).filter(Boolean)
    : ['psu.edu.sa'];

  if (!applicationsOpen) {
    render(card,
      h('div', {}, h('div', { class: 'breadcrumb mono-meta' }, 'ACCESS'), h('h1', 'Applications are closed')),
      h('p', 'The club is not accepting new membership applications at the moment.'),
      h('a', { class: 'btn-ghost', href: '/index.html' }, 'Back to the website'));
    return;
  }

  const status = h('div');
  const experienceDetails = field({
    label: 'What have you done before?',
    name: 'experience_text',
    type: 'textarea',
    rows: 4,
    maxlength: 1500,
    hint: 'Projects, coursework, workshops, competitions, volunteering, internships or self-study all count. Keep it brief.',
  });
  experienceDetails.hidden = true;

  const experienceSelect = field({
    label: 'Do you have previous experience related to your interests?',
    name: 'experience_status',
    type: 'select',
    required: true,
    value: '',
    options: [
      { value: '', label: 'Select…' },
      { value: 'none', label: 'Not yet' },
      { value: 'some', label: 'Yes' },
    ],
    hint: 'Experience is not required and is never used as a technical screening score.',
  });

  const experienceControl = experienceSelect.querySelector('select') as HTMLSelectElement | null;
  experienceControl?.addEventListener('change', () => {
    const hasExperience = experienceControl.value === 'some';
    experienceDetails.hidden = !hasExperience;
    const textarea = experienceDetails.querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea) textarea.required = hasExperience;
  });

  const form = h('form', { class: 'portal-form', novalidate: true },
    notice('info',
      'This is a membership application, not a technical screening. We only ask for information needed to understand who you are, what interests you, and how you would like to participate.'),

    h('div', {},
      h('p', { class: 'mono-meta dim-text' }, 'BASIC INFORMATION'),
      h('div', { class: 'field-pair' },
        field({ label: 'Full name', name: 'full_name', required: true, maxlength: 120, value: viewer.user.full_name }),
        field({ label: 'PSU student ID', name: 'student_id', required: true, value: viewer.user.student_id, hint: 'Digits only.' }),
      ),
      h('div', { class: 'field-pair' },
        field({
          label: 'PSU email', name: 'psu_email', type: 'email', required: true, value: viewer.email,
          hint: `Must use ${domains.map((domain) => '@' + domain).join(' or ')}.`,
        }),
        field({ label: 'Major', name: 'major', required: true, value: viewer.user.major, placeholder: 'e.g. Software Engineering' }),
      ),
      field({
        label: 'Academic year', name: 'academic_year', type: 'select', required: true,
        value: viewer.profile?.academic_year ?? '',
        options: [{ value: '', label: 'Select…' }, ...ACADEMIC_YEARS],
      }),
    ),

    h('div', {},
      h('p', { class: 'mono-meta dim-text' }, 'INTERESTS'),
      h('div', { class: 'form-field' },
        h('span', { class: 'mono-meta' }, 'AREAS YOU WANT TO EXPLORE', h('span', { class: 'accent-text' }, ' *')),
        h('p', { class: 'field-hint mono-meta dim-text' }, 'Pick the areas you would actually like to learn, help with, or participate in.'),
        chipPicker('interests', INTERESTS, knownInterests(viewer.profile?.interests ?? [])),
      ),
    ),

    h('div', {},
      h('p', { class: 'mono-meta dim-text' }, 'EXPERIENCE'),
      experienceSelect,
      experienceDetails,
    ),

    h('div', {},
      h('p', { class: 'mono-meta dim-text' }, 'WHAT YOU WANT FROM ACM'),
      field({
        label: 'What would you like to learn, contribute to, or get involved in?',
        name: 'goal_text', type: 'textarea', rows: 4, maxlength: 1500, required: true,
        hint: 'A few sentences are enough. Mention workshops, competitions, organizing, programming, cybersecurity, public speaking, or anything else that interests you.',
      }),
    ),

    status,
    submitButton('Submit application'),
  ) as HTMLFormElement;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const values = formValues(form);
    const fullName = textOf(values, 'full_name').trim();
    const studentId = textOf(values, 'student_id').replace(/\D/g, '');
    const psuEmail = textOf(values, 'psu_email').trim().toLowerCase();
    const major = textOf(values, 'major').trim();
    const academicYear = textOf(values, 'academic_year');
    const interests = asArray(values.interests);
    const experienceStatus = textOf(values, 'experience_status');
    const experienceText = textOf(values, 'experience_text').trim();
    const goalText = textOf(values, 'goal_text').trim();

    if (!/^\d{6,12}$/.test(studentId)) {
      status.replaceChildren(notice('err', 'A PSU student ID is 6 to 12 digits.'));
      return;
    }
    if (!domains.some((domain) => psuEmail.endsWith('@' + domain))) {
      status.replaceChildren(notice('err', `Use your PSU email (${domains.map((domain) => '@' + domain).join(', ')}).`));
      return;
    }
    if (!interests.length) {
      status.replaceChildren(notice('err', 'Choose at least one area of interest.'));
      return;
    }
    if (experienceStatus === 'some' && !experienceText) {
      status.replaceChildren(notice('err', 'Briefly describe your previous experience.'));
      return;
    }

    const button = form.querySelector<HTMLButtonElement>('button[type="submit"], button');
    if (button) button.disabled = true;
    status.replaceChildren(notice('info', 'SUBMITTING…'));

    try {
      if (await myApplication(viewer.userId)) {
        window.location.replace('/portal/status.html');
        return;
      }

      const { error } = await requireClient().from('applications').insert({
        user_id: viewer.userId,
        full_name: fullName,
        student_id: studentId,
        psu_email: psuEmail,
        major,
        academic_year: academicYear,
        interests,
        experience_status: experienceStatus,
        experience_text: experienceStatus === 'some' ? experienceText : null,
        goal_text: goalText,
      });
      if (error) throw new Error(error.message);

      window.location.replace('/portal/status.html');
    } catch (error) {
      if (button) button.disabled = false;
      status.replaceChildren(notice('err', `Could not submit your application: ${errorMessage(error)}`));
    }
  });

  render(card,
    h('div', {}, h('div', { class: 'breadcrumb mono-meta' }, 'JOIN ACM'), h('h1', 'Membership application')),
    h('p', 'Tell us enough to understand what you want to explore and how ACM can involve you. Prior experience is welcome but never required.'),
    form,
  );
}

void start();
