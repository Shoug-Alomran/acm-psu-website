/**
 * Create an account.
 *
 * Signing up is not the same as joining ACM: it creates a login, and the
 * membership application is a separate, deliberate step afterwards. Keeping
 * them apart means someone can have an account while their application is
 * still being read, and an alumnus keeps an account after leaving.
 *
 * The form asks for more than a login needs, in the same voice as the
 * membership application, for two reasons: four anonymous boxes are a worse
 * first impression of the chapter than the rest of the site gives, and every
 * answer here is one the application form no longer has to ask for — it
 * arrives pre-filled instead.
 *
 * Credentials and the person's university role are required. The student-only
 * details below them are optional, which is why none of them blocks the button.
 *
 * The extra answers travel in the auth user's metadata rather than being
 * written directly: with email confirmation on there is no session at this
 * point, so there is nobody for row level security to authorise. They are
 * applied on first sign-in — see lib/signup-profile.ts.
 *
 * A student ID is deliberately NOT asked for here. It is an administrative
 * identifier, guarded in the database, and the membership application is where
 * it is collected and checked against the person.
 */
import { h, formValues, textOf, asArray } from '../lib/dom.js';
import { wideAuthShell, field, chipPicker, notice, submitButton } from '../lib/ui.js';
import { INTERESTS, ACADEMIC_YEARS } from '../lib/membership.js';
import { isConfigured, supabase, requireClient, siteUrl, readableError } from '../lib/supabase.js';
import { applySignupMetadata } from '../lib/signup-profile.js';

const UNIVERSITY_ROLES = [
  { value: 'student', label: 'Student' },
  { value: 'instructor', label: 'Instructor / faculty' },
  { value: 'staff', label: 'University staff' },
  { value: 'alumni', label: 'Alumni' },
  { value: 'other', label: 'Other' },
];

/** A labelled break in a long form, matching the review console's captions. */
function section(title: string, blurb: string): HTMLElement {
  return h('div', { class: 'form-section' },
    h('span', { class: 'form-section__label' }, title.toUpperCase()),
    h('p', { class: 'form-section__blurb' }, blurb));
}

async function start(): Promise<void> {
  if (!isConfigured || !supabase) {
    wideAuthShell('Create an account', '',
      notice('warn', 'The portal is not connected to a database yet. See docs/SETUP.md.'));
    return;
  }

  const status = h('div');

  const form = h('form', { class: 'portal-form', novalidate: true },
    section('Sign-in details', 'This is all you need to create the account.'),

    field({ label: 'Full name', name: 'full_name', required: true, maxlength: 120 }),

    field({ label: 'Email', name: 'email', type: 'email', required: true,
            hint: 'Use your PSU address if you intend to apply for membership.' }),

    h('div', { class: 'field-pair' },
      field({ label: 'Password', name: 'password', type: 'password', required: true,
              hint: 'At least 8 characters.' }),
      field({ label: 'Confirm password', name: 'confirm', type: 'password', required: true })),

    section('About you',
      'Tell us how you are connected to PSU. Student details are optional here and ' +
      'can be changed later.'),

    field({ label: 'I am a', name: 'university_role', type: 'select', required: true,
            options: UNIVERSITY_ROLES }),

    h('div', { class: 'field-pair', id: 'student-fields' },
      field({ label: 'Major', name: 'major', maxlength: 120,
              placeholder: 'e.g. Software Engineering' }),

      field({ label: 'Academic year', name: 'academic_year', type: 'select',
              options: [{ value: '', label: 'Prefer not to say' }, ...ACADEMIC_YEARS] })),

    h('div', { class: 'form-field' },
      h('span', { class: 'mono-meta' }, 'AREAS OF INTEREST'),
      h('p', { class: 'field-hint mono-meta dim-text' },
        'Pick anything that sounds interesting. No experience is expected in any of them.'),
      chipPicker('interests', INTERESTS)),

    status,
    submitButton('Create account'),
  ) as HTMLFormElement;

  const roleSelect = form.elements.namedItem('university_role') as HTMLSelectElement;
  const studentFields = form.querySelector<HTMLElement>('#student-fields')!;
  const syncStudentFields = (): void => {
    const isStudent = roleSelect.value === 'student';
    studentFields.hidden = !isStudent;
    studentFields.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
      .forEach((control) => { control.disabled = !isStudent; });
  };
  roleSelect.addEventListener('change', syncStudentFields);
  syncStudentFields();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const values = formValues(form);
    const email = textOf(values, 'email');
    const password = textOf(values, 'password');
    const universityRole = textOf(values, 'university_role');
    const button = form.querySelector('button')!;

    if (password.length < 8) {
      status.replaceChildren(notice('err', 'Choose a password of at least 8 characters.'));
      return;
    }
    if (password !== textOf(values, 'confirm')) {
      status.replaceChildren(notice('err', 'The two passwords do not match.'));
      return;
    }

    button.disabled = true;
    status.replaceChildren(notice('info', 'CREATING ACCOUNT…'));

    const { data, error } = await requireClient().auth.signUp({
      email,
      password,
      options: {
        /*
         * full_name is read by the database trigger that creates app_users.
         * The rest is picked up on first sign-in, once there is a session that
         * row level security can authorise.
         */
        data: {
          full_name: textOf(values, 'full_name'),
          university_role: universityRole,
          major: textOf(values, 'major'),
          academic_year: textOf(values, 'academic_year'),
          interests: asArray(values.interests),
        },
        emailRedirectTo: `${siteUrl}/portal/auth-callback.html`,
      },
    });

    if (error) {
      button.disabled = false;
      status.replaceChildren(notice('err', readableError(error)));
      return;
    }

    // With email confirmation on, there is no session yet — which is correct:
    // membership is tied to a real person, so the address must be proven.
    if (data.session) {
      // Confirmation can be disabled in development. Persist the optional
      // answers and wait for the Members-sheet refresh before navigating away.
      await applySignupMetadata();
      window.location.replace(
        universityRole === 'student' ? '/portal/apply.html' : '/portal/status.html',
      );
      return;
    }

    form.replaceChildren(notice('ok',
      `Account created. We sent a confirmation link to ${email} — ` +
      'open it to activate your account, then sign in.'));
  });

  wideAuthShell('Create an account',
    'An account lets you apply for membership and, once accepted, use the member portal.',
    form,
    h('div', { class: 'auth-links' },
      h('a', { href: '/portal/login.html' }, 'ALREADY HAVE AN ACCOUNT'),
      h('a', { href: '/join.html' }, 'ABOUT MEMBERSHIP')));
}

void start();
