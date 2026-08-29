/**
 * Shown when an account has been disabled by an admin.
 *
 * Disabling is separate from withdrawing: the person's record and history are
 * untouched, they simply cannot sign in. Saying so plainly avoids the
 * impression that their contributions have been erased.
 */
import { h } from '../lib/dom.js';
import { authShell } from '../lib/ui.js';
import { signOut } from '../lib/session.js';
import { setting } from '../lib/api.js';
import { isConfigured } from '../lib/supabase.js';

async function start(): Promise<void> {
  const email = isConfigured ? await setting('club_email', 'acm@psu.edu.sa') : 'acm@psu.edu.sa';

  authShell('Account disabled',
    'This account cannot currently be used to sign in.',
    h('p', { class: 'mono-meta dim-text' },
      'Your membership record, position history and verified contributions are unchanged. ' +
      'If you think this is a mistake, contact the club.'),
    h('div', { class: 'button-row' },
      h('a', { class: 'btn-ghost', href: `mailto:${email}` }, 'Contact ACM'),
      h('button', { type: 'button', class: 'btn-ghost', onclick: () => void signOut() },
        'Sign out')));
}

void start();
