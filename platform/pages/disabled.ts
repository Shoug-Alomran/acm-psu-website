/**
 * Shown when an account has been disabled by an admin.
 *
 * Disabling is separate from withdrawing: the person's record and history are
 * untouched, they simply cannot sign in. Saying so plainly avoids the
 * impression that their contributions have been erased.
 */

import {
  h,
} from '../lib/dom.js';

import {
  authShell,
  notice,
} from '../lib/ui.js';

import {
  signOut,
} from '../lib/session.js';

import {
  setting,
} from '../lib/api.js';

import {
  isConfigured,
} from '../lib/supabase.js';

function errorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (
      error as {
        message?: unknown;
      }
    ).message === 'string'
  ) {
    return (
      error as {
        message: string;
      }
    ).message;
  }

  return 'An unknown error occurred.';
}

async function start(): Promise<void> {
  let email =
    'acm@psu.edu.sa';

  if (
    isConfigured
  ) {
    try {
      email =
        await setting<string>(
          'club_email',
          'acm@psu.edu.sa',
        );
    } catch (error) {
      console.error(
        'Could not load club email on disabled-account page:',
        error,
      );
    }
  }

  const signOutStatus =
    h(
      'div',
    );

  authShell(
    'Account disabled',
    'This account cannot currently be used to sign in.',

    h(
      'p',
      {
        class:
          'mono-meta dim-text',
      },
      'Your membership record, position history and verified contributions are unchanged. ' +
      'If you think this is a mistake, contact the club.',
    ),

    signOutStatus,

    h(
      'div',
      {
        class:
          'button-row',
      },

      h(
        'a',
        {
          class:
            'btn-ghost',
          href:
            `mailto:${email}`,
        },
        'Contact ACM',
      ),

      h(
        'button',
        {
          type:
            'button',
          class:
            'btn-ghost',

          onclick:
            async () => {
              signOutStatus.replaceChildren();

              try {
                await signOut();
              } catch (error) {
                console.error(
                  'Could not sign out disabled account:',
                  error,
                );

                signOutStatus.replaceChildren(
                  notice(
                    'err',
                    `Could not sign out: ${errorMessage(error)}`,
                  ),
                );
              }
            },
        },
        'Sign out',
      ),
    ),
  );
}

void start();