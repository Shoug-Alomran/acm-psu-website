/**
 * Create an account.
 *
 * Signing up is not the same as joining ACM: it creates a login, and the
 * membership application is a separate, deliberate step afterwards. Keeping
 * them apart means someone can have an account while their application is
 * still being read, and an alumnus keeps an account after leaving.
 */
import { h, formValues, textOf } from '../lib/dom.js';
import { authShell, field, notice, submitButton } from '../lib/ui.js';
import { isConfigured, supabase, requireClient, siteUrl, readableError } from '../lib/supabase.js';

async function start(): Promise<void> {
  if (!isConfigured || !supabase) {
    authShell('Create an account', '',
      notice('warn', 'The portal is not connected to a database yet. See docs/SETUP.md.'));
    return;
  }

  const status = h('div');

  const form = h('form', { class: 'portal-form', novalidate: true },
    field({ label: 'Full name', name: 'full_name', required: true, maxlength: 120 }),
    field({ label: 'Email', name: 'email', type: 'email', required: true,
            hint: 'Use your PSU address if you intend to apply for membership.' }),
    field({ label: 'Password', name: 'password', type: 'password', required: true,
            hint: 'At least 8 characters.' }),
    field({ label: 'Confirm password', name: 'confirm', type: 'password', required: true }),
    status,
    submitButton('Create account'),
  ) as HTMLFormElement;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const values = formValues(form);
    const email = textOf(values, 'email');
    const password = textOf(values, 'password');
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
        data: { full_name: textOf(values, 'full_name') },
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
      window.location.replace('/portal/apply.html');
      return;
    }

    form.replaceChildren(notice('ok',
      `Account created. We sent a confirmation link to ${email} — ` +
      'open it to activate your account, then sign in.'));
  });

  authShell('Create an account',
    'An account lets you apply for membership and, once accepted, use the member portal.',
    form,
    h('div', { class: 'auth-links' },
      h('a', { href: '/portal/login.html' }, 'ALREADY HAVE AN ACCOUNT'),
      h('a', { href: '/join.html' }, 'ABOUT MEMBERSHIP')));
}

void start();
