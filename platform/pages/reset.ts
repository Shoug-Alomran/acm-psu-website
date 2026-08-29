/**
 * Password reset — both halves.
 *
 * Supabase sends a recovery link that returns here with a session already
 * established, so the same page either asks for the email or, when arriving
 * from the link, asks for the new password.
 */
import { h, formValues, textOf } from '../lib/dom.js';
import { authShell, field, notice, submitButton } from '../lib/ui.js';
import { isConfigured, supabase, requireClient, siteUrl, readableError } from '../lib/supabase.js';

function requestForm(): HTMLElement {
  const status = h('div');
  const form = h('form', { class: 'portal-form', novalidate: true },
    field({ label: 'Email', name: 'email', type: 'email', required: true }),
    status,
    submitButton('Send reset link'),
  ) as HTMLFormElement;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const email = textOf(formValues(form), 'email');
    const button = form.querySelector('button')!;
    button.disabled = true;

    const { error } = await requireClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/portal/reset.html`,
    });

    // Always the same answer, so this page cannot be used to discover which
    // addresses have accounts.
    status.replaceChildren(notice(error ? 'err' : 'ok',
      error ? readableError(error)
        : `If an account exists for ${email}, a reset link is on its way.`));
    button.disabled = false;
  });

  return form;
}

function newPasswordForm(): HTMLElement {
  const status = h('div');
  const form = h('form', { class: 'portal-form', novalidate: true },
    field({ label: 'New password', name: 'password', type: 'password', required: true,
            hint: 'At least 8 characters.' }),
    field({ label: 'Confirm new password', name: 'confirm', type: 'password', required: true }),
    status,
    submitButton('Set new password'),
  ) as HTMLFormElement;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const password = textOf(formValues(form), 'password');
    if (password.length < 8) {
      status.replaceChildren(notice('err', 'Choose a password of at least 8 characters.'));
      return;
    }
    if (password !== textOf(formValues(form), 'confirm')) {
      status.replaceChildren(notice('err', 'The two passwords do not match.'));
      return;
    }

    const button = form.querySelector('button')!;
    button.disabled = true;

    const { error } = await requireClient().auth.updateUser({ password });
    if (error) {
      button.disabled = false;
      status.replaceChildren(notice('err', readableError(error)));
      return;
    }
    window.location.replace('/portal/index.html');
  });

  return form;
}

async function start(): Promise<void> {
  if (!isConfigured || !supabase) {
    authShell('Reset password', '',
      notice('warn', 'The portal is not connected to a database yet.'));
    return;
  }

  // Arriving from a recovery link leaves a session in place.
  const { data } = await supabase.auth.getSession();
  const recovering = Boolean(data.session) &&
    (window.location.hash.includes('type=recovery') || window.location.search.includes('code='));

  if (recovering) {
    authShell('Choose a new password', 'Enter the password you would like to use from now on.',
      newPasswordForm());
    return;
  }

  authShell('Reset password',
    'We will email you a link to choose a new one.',
    requestForm(),
    h('div', { class: 'auth-links' }, h('a', { href: '/portal/login.html' }, 'BACK TO SIGN IN')));
}

void start();
