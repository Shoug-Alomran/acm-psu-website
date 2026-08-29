/**
 * Sign in.
 *
 * Supabase Auth owns the credential handling; this page only collects the
 * fields and routes the person to wherever they were heading. Where they are
 * allowed to go afterwards is decided by session.ts guards and, ultimately, by
 * row level security.
 */

import {
  h,
  formValues,
  textOf,
} from '../lib/dom.js';

import {
  authShell,
  field,
  notice,
  submitButton,
} from '../lib/ui.js';

import {
  isConfigured,
  supabase,
  requireClient,
  readableError,
} from '../lib/supabase.js';

import {
  loadViewer,
  isStaff,
} from '../lib/session.js';

import {
  applySignupMetadata,
} from '../lib/signup-profile.js';

/**
 * Only same-origin paths, so ?next= cannot be used as an open redirect.
 */
function safeNext(): string | null {
  const next =
    new URLSearchParams(
      window.location.search,
    ).get(
      'next',
    );

  if (
    !next ||
    !next.startsWith('/') ||
    next.startsWith('//')
  ) {
    return null;
  }

  return next;
}

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

async function landingFor(): Promise<string> {
  try {
    const viewer =
      await loadViewer(
        true,
      );

    if (!viewer) {
      return '/portal/login.html';
    }

    /*
     * Staff first.
     *
     * Admins may also have active/alumni memberships. If membership is checked
     * first, a staff account can be incorrectly routed into the member portal.
     */
    if (
      isStaff(
        viewer,
      )
    ) {
      return '/admin/index.html';
    }

    if (
      viewer.membership?.status === 'active' ||
      viewer.membership?.status === 'alumni'
    ) {
      return '/portal/index.html';
    }

    return '/portal/status.html';
  } catch (error) {
    console.error(
      'Could not determine signed-in landing page:',
      error,
    );

    /*
     * The user is authenticated even if profile routing failed. Status is the
     * safest fallback because its own guards can determine what the account
     * should see next.
     */
    return '/portal/status.html';
  }
}

async function start(): Promise<void> {
  if (
    !isConfigured ||
    !supabase
  ) {
    authShell(
      'Sign in',
      '',

      notice(
        'warn',
        'The portal is not connected to a database yet. See docs/SETUP.md.',
      ),
    );

    return;
  }

  /*
   * Already signed in — do not make them type their password again.
   */
  try {
    const {
      data,
      error,
    } =
      await supabase.auth.getSession();

    if (error) {
      console.error(
        'Could not inspect existing auth session:',
        error,
      );
    } else if (
      data.session
    ) {
      window.location.replace(
        safeNext() ??
        await landingFor(),
      );

      return;
    }
  } catch (error) {
    /*
     * Failure to inspect an existing session should not make the login page
     * unusable. Let the person sign in normally.
     */
    console.error(
      'Existing session check failed:',
      error,
    );
  }

  const status =
    h(
      'div',
    );

  const form = h(
    'form',
    {
      class:
        'portal-form',
      novalidate:
        true,
    },

    field({
      label:
        'Email',
      name:
        'email',
      type:
        'email',
      required:
        true,
      placeholder:
        'you@psu.edu.sa',
    }),

    field({
      label:
        'Password',
      name:
        'password',
      type:
        'password',
      required:
        true,
    }),

    status,

    submitButton(
      'Sign in',
    ),
  ) as HTMLFormElement;

  form.addEventListener(
    'submit',

    async (
      event,
    ) => {
      event.preventDefault();

      if (
        !form.reportValidity()
      ) {
        return;
      }

      const button =
        form.querySelector<
          HTMLButtonElement
        >(
          'button[type="submit"], button',
        );

      const values =
        formValues(
          form,
        );

      const email =
        textOf(
          values,
          'email',
        )
          .trim()
          .toLowerCase();

      const password =
        textOf(
          values,
          'password',
        );

      if (
        button
      ) {
        button.disabled =
          true;
      }

      status.replaceChildren(
        notice(
          'info',
          'SIGNING IN…',
        ),
      );

      try {
        const {
          error,
        } =
          await requireClient()
            .auth
            .signInWithPassword({
              email,
              password,
            });

        if (error) {
          if (
            button
          ) {
            button.disabled =
              false;
          }

          status.replaceChildren(
            notice(
              'err',

              /Email not confirmed/i.test(
                error.message,
              )
                ? 'Confirm your email address first — check your inbox for the link we sent.'
                : /Invalid login/i.test(
                  error.message,
                )
                  ? 'That email and password do not match an account.'
                  : readableError(
                    error,
                  ),
            ),
          );

          return;
        }

        status.replaceChildren(
          notice(
            'info',
            'SIGNED IN — LOADING YOUR ACCOUNT…',
          ),
        );

        /*
         * If this is the first sign-in after creating an account, the optional
         * answers from the sign-up form are still sitting in auth metadata.
         * Fold them in now, while there is a session to authorise the write.
         */
        await applySignupMetadata();

        const destination =
          safeNext() ??
          await landingFor();

        window.location.replace(
          destination,
        );
      } catch (error) {
        console.error(
          'Sign-in request failed:',
          error,
        );

        if (
          button
        ) {
          button.disabled =
            false;
        }

        status.replaceChildren(
          notice(
            'err',
            `Could not sign in: ${errorMessage(error)}`,
          ),
        );
      }
    },
  );

  authShell(
    'Sign in',
    'Member and admin access to the ACM PSU platform.',

    form,

    h(
      'div',
      {
        class:
          'auth-links',
      },

      h(
        'a',
        {
          href:
            '/portal/signup.html',
        },
        'CREATE ACCOUNT',
      ),

      h(
        'a',
        {
          href:
            '/portal/reset.html',
        },
        'FORGOT PASSWORD',
      ),
    ),
  );
}

void start();