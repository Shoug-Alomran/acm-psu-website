/**
 * Where confirmation and recovery links land.
 *
 * The Supabase client is configured with detectSessionInUrl, so by the time
 * this runs the token in the URL has already been exchanged for a session.
 * All that is left is to send the person to the right place — and to strip the
 * token fragment out of the address bar on the way.
 */
import { authShell, notice, loading } from '../lib/ui.js';
import { h } from '../lib/dom.js';
import { isConfigured, supabase } from '../lib/supabase.js';
import { loadViewer, isStaff, isMember } from '../lib/session.js';

async function start(): Promise<void> {
  if (!isConfigured || !supabase) {
    authShell('Confirming', '', notice('warn', 'The portal is not connected to a database yet.'));
    return;
  }

  authShell('Confirming your account', '', loading('VERIFYING'));

  // Recovery links must go to the password form, not into the portal.
  if (window.location.hash.includes('type=recovery')) {
    window.location.replace('/portal/reset.html' + window.location.hash);
    return;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    authShell('Link could not be used',
      'It may have already been used, or it may have expired.',
      h('a', { class: 'btn-ghost', href: '/portal/login.html' }, 'Go to sign in'));
    return;
  }

  history.replaceState(null, '', window.location.pathname);

  const viewer = await loadViewer(true);
  if (isMember(viewer)) { window.location.replace('/portal/index.html'); return; }
  if (isStaff(viewer))  { window.location.replace('/admin/index.html'); return; }

  // Confirmed but not yet a member: the next useful step is applying.
  const { data: application } = await supabase
    .from('applications').select('id').limit(1).maybeSingle();

  window.location.replace(application ? '/portal/status.html' : '/portal/apply.html');
}

void start();
