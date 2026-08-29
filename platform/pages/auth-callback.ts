/**
 * Where confirmation and recovery links land.
 *
 * The Supabase client is configured with detectSessionInUrl, so by the time
 * this runs the token in the URL has already been exchanged for a session.
 *
 * All that is left is to send the person to the right place — and to strip the
 * token fragment out of the address bar on the way.
 */

import {
  authShell,
  notice,
  loading,
} from '../lib/ui.js';

import {
  h,
} from '../lib/dom.js';

import {
  isConfigured,
  supabase,
} from '../lib/supabase.js';

import {
  loadViewer,
  isStaff,
  isMember,
} from '../lib/session.js';

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

function showFailure(
  title: string,
  message: string,
): void {
  authShell(
    title,
    message,

    h(
      'div',
      {
        class: 'button-row',
      },

      h(
        'a',
        {
          class: 'btn-ghost',
          href: '/portal/login.html',
        },
        'Go to sign in',
      ),

      h(
        'button',
        {
          type: 'button',
          class: 'btn-ghost',

          onclick:
            () =>
              window.location.reload(),
        },
        'Try again',
      ),
    ),
  );
}

async function start(): Promise<void> {
  if (
    !isConfigured ||
    !supabase
  ) {
    authShell(
      'Confirming',
      '',

      notice(
        'warn',
        'The portal is not connected to a database yet.',
      ),
    );

    return;
  }

  authShell(
    'Confirming your account',
    '',
    loading(
      'VERIFYING',
    ),
  );

  /*
   * Recovery links must go to the password reset page rather than being routed
   * into the normal portal flow.
   *
   * Supabase may represent auth data in either the hash or query string
   * depending on the flow, so check both.
   */
  const params =
    new URLSearchParams(
      window.location.search,
    );

  const isRecovery =
    window.location.hash.includes(
      'type=recovery',
    ) ||
    params.get(
      'type',
    ) === 'recovery';

  if (isRecovery) {
    window.location.replace(
      '/portal/reset.html' +
      window.location.search +
      window.location.hash,
    );

    return;
  }

  try {
    const {
      data,
      error,
    } =
      await supabase.auth.getSession();

    if (error) {
      throw new Error(
        error.message,
      );
    }

    if (
      !data.session
    ) {
      authShell(
        'Link could not be used',
        'It may have already been used, or it may have expired.',

        h(
          'a',
          {
            class: 'btn-ghost',
            href: '/portal/login.html',
          },
          'Go to sign in',
        ),
      );

      return;
    }

    /*
     * Remove confirmation/auth parameters before doing any further requests.
     * This prevents tokens from remaining visible in browser history.
     */
    history.replaceState(
      null,
      '',
      window.location.pathname,
    );

    let viewer;

    try {
      viewer =
        await loadViewer(
          true,
        );
    } catch (error) {
      console.error(
        'Account confirmed but viewer profile could not load:',
        error,
      );

      showFailure(
        'Account confirmed',
        `Your account was verified, but the portal could not load your profile: ${errorMessage(error)}`,
      );

      return;
    }

    /*
     * Staff should be routed before the generic applicant path.
     *
     * If an administrator is also represented as an active member, the admin
     * assignment is the more privileged and useful destination after sign-in.
     */
    if (
      isStaff(
        viewer,
      )
    ) {
      window.location.replace(
        '/admin/index.html',
      );

      return;
    }

    if (
      isMember(
        viewer,
      )
    ) {
      window.location.replace(
        '/portal/index.html',
      );

      return;
    }

    /*
     * Confirmed but not yet a member.
     *
     * Only inspect this user's application. Do not rely on a generic
     * applications SELECT that could accidentally depend on broader RLS access.
     */
    const {
      data: application,
      error: applicationError,
    } =
      await supabase
        .from(
          'applications',
        )
        .select(
          'id',
        )
        .eq(
          'user_id',
          data.session.user.id,
        )
        .limit(
          1,
        )
        .maybeSingle();

    if (
      applicationError
    ) {
      throw new Error(
        applicationError.message,
      );
    }

    window.location.replace(
      application
        ? '/portal/status.html'
        : '/portal/apply.html',
    );
  } catch (error) {
    console.error(
      'Authentication callback failed:',
      error,
    );

    showFailure(
      'Could not finish signing you in',
      `Your authentication link was processed, but the portal could not finish loading your account: ${errorMessage(error)}`,
    );
  }
}

void start();