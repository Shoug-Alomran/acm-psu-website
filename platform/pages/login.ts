/**
 * Sign in.
 *
 * Supabase Auth owns the credential handling; this page only collects the
 * fields and routes the person to wherever they were heading. Where they are
 * allowed to go afterwards is decided by session.ts guards and, ultimately, by
 * row level security.
 */
import { h, formValues, textOf } from '../lib/dom.js';
import { authShell, field, notice, submitButton } from '../lib/ui.js';
import { isConfigured, supabase, requireClient, readableError } from '../lib/supabase.js';
import { loadViewer, isStaff } from '../lib/session.js';

/** Only same-origin paths, so ?next= cannot be used as an open redirect. */
function safeNext(): string | null {
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

async function landingFor(): Promise<string> {
  const viewer = await loadViewer(true);
  if (!viewer) return '/portal/login.html';
  if (viewer.membership?.status === 'active' || viewer.membership?.status === 'alumni') {
    return '/portal/index.html';
  }
  if (isStaff(viewer)) return '/admin/index.html';
  return '/portal/status.html';
}

async function start(): Promise<void> {
  if (!isConfigured || !supabase) {
    authShell('Sign in', '',
      notice('warn', 'The portal is not connected to a database yet. See docs/SETUP.md.'));
    return;
  }

  // Already signed in — do not make them type their password again.
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    window.location.replace(safeNext() ?? await landingFor());
    return;
  }

  const status = h('div');

  const form = h('form', { class: 'portal-form', novalidate: true },
    field({ label: 'Email', name: 'email', type: 'email', required: true,
            placeholder: 'you@psu.edu.sa' }),
    field({ label: 'Password', name: 'password', type: 'password', required: true }),
    status,
    submitButton('Sign in'),
  ) as HTMLFormElement;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const button = form.querySelector('button')!;
    const values = formValues(form);

    button.disabled = true;
    status.replaceChildren(notice('info', 'SIGNING IN…'));

    const { error } = await requireClient().auth.signInWithPassword({
      email: textOf(values, 'email'),
      password: textOf(values, 'password'),
    });

    if (error) {
      button.disabled = false;
      status.replaceChildren(notice('err',
        /Email not confirmed/i.test(error.message)
          ? 'Confirm your email address first — check your inbox for the link we sent.'
          : /Invalid login/i.test(error.message)
            ? 'That email and password do not match an account.'
            : readableError(error)));
      return;
    }

    window.location.replace(safeNext() ?? await landingFor());
  });

  authShell('Sign in', 'Member and admin access to the ACM PSU platform.',
    form,
    h('div', { class: 'auth-links' },
      h('a', { href: '/portal/signup.html' }, 'CREATE ACCOUNT'),
      h('a', { href: '/portal/reset.html' }, 'FORGOT PASSWORD')));
}

void start();
