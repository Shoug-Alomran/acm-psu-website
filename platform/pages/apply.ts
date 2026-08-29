/**
 * Membership application.
 *
 * Deliberately short, and deliberately not a technical screening. It asks who
 * you are, what you are curious about, and — optionally — what you would like
 * to get experience in. There is no question about what you already know how
 * to do, because the club exists to give people that experience rather than to
 * select for it.
 */

import {
  h,
  formValues,
  textOf,
  asArray,
  render,
} from '../lib/dom.js';

import {
  wideAuthShell,
  field,
  chipPicker,
  notice,
  submitButton,
  loading,
} from '../lib/ui.js';

import {
  requireSignedIn,
} from '../lib/session.js';

import {
  isConfigured,
} from '../lib/supabase.js';

import {
  myApplication,
  submitApplication,
  setting,
} from '../lib/api.js';

import {
  INTERESTS,
  ACADEMIC_YEARS,
  knownInterests,
} from '../lib/membership.js';

function errorMessage(
  error: unknown,
): string {
  if (
    error instanceof Error
  ) {
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
  if (
    !isConfigured
  ) {
    wideAuthShell(
      'Membership application',
      '',

      notice(
        'warn',
        'The application system is not connected yet. Please email the club in the meantime.',
      ),
    );

    return;
  }

  const card =
    wideAuthShell(
      'Membership application',
      '',
      loading(
        'CHECKING YOUR ACCOUNT',
      ),
    );

  let viewer;

  try {
    viewer =
      await requireSignedIn();
  } catch (error) {
    console.error(
      'Could not load signed-in member:',
      error,
    );

    render(
      card,

      notice(
        'err',
        `Could not load your account: ${errorMessage(error)}`,
      ),

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
              '/portal/login.html',
          },
          'Back to sign in',
        ),
      ),
    );

    return;
  }

  let existing = null;

  let open = true;

  let domains:
    string[] = [
      'psu.edu.sa',
    ];

  let clubEmail =
    'acm@psu.edu.sa';

  try {
    existing =
      await myApplication(
        viewer.userId,
      );
  } catch (error) {
    console.error(
      'Could not check existing membership application:',
      error,
    );

    render(
      card,

      notice(
        'err',
        `Could not check your application status: ${errorMessage(error)}`,
      ),

      h(
        'div',
        {
          class:
            'button-row',
        },

        h(
          'button',
          {
            type:
              'button',
            class:
              'btn-ghost',

            onclick:
              () =>
                window.location.reload(),
          },
          'TRY AGAIN',
        ),
      ),
    );

    return;
  }

  /*
   * These settings are useful, but they should not make the entire
   * application page unusable if one cannot be read.
   */
  const [
    openResult,
    domainsResult,
    emailResult,
  ] =
    await Promise.allSettled([
      setting<boolean>(
        'applications_open',
        true,
      ),

      setting<string[]>(
        'psu_email_domains',
        [
          'psu.edu.sa',
        ],
      ),

      setting<string>(
        'club_email',
        'acm@psu.edu.sa',
      ),
    ]);

  if (
    openResult.status ===
    'fulfilled'
  ) {
    open =
      openResult.value;
  } else {
    console.error(
      'Could not load applications_open setting:',
      openResult.reason,
    );
  }

  if (
    domainsResult.status ===
    'fulfilled'
  ) {
    const configuredDomains =
      domainsResult.value
        .map(
          (
            domain,
          ) =>
            String(
              domain,
            )
              .trim()
              .replace(
                /^@/,
                '',
              )
              .toLowerCase(),
        )
        .filter(
          Boolean,
        );

    if (
      configuredDomains.length
    ) {
      domains =
        configuredDomains;
    }
  } else {
    console.error(
      'Could not load PSU email domains:',
      domainsResult.reason,
    );
  }

  if (
    emailResult.status ===
    'fulfilled' &&
    emailResult.value.trim()
  ) {
    clubEmail =
      emailResult.value.trim();
  } else if (
    emailResult.status ===
    'rejected'
  ) {
    console.error(
      'Could not load club email:',
      emailResult.reason,
    );
  }

  if (
    existing
  ) {
    window.location.replace(
      '/portal/status.html',
    );

    return;
  }

  if (
    !open
  ) {
    render(
      card,

      h(
        'div',
        {},

        h(
          'div',
          {
            class:
              'breadcrumb mono-meta',
          },
          'ACCESS',
        ),

        h(
          'h1',
          'Applications are closed',
        ),
      ),

      h(
        'p',
        'The club is not accepting new membership applications at the moment. ' +
        'Watch the website for the next intake.',
      ),

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
              '/index.html',
          },
          'Back to the website',
        ),

        h(
          'a',
          {
            class:
              'btn-ghost',
            href:
              `mailto:${clubEmail}`,
          },
          'Contact ACM',
        ),
      ),
    );

    return;
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

    h(
      'div',
      {
        class:
          'field-pair',
      },

      field({
        label:
          'Full name',
        name:
          'full_name',
        required:
          true,
        maxlength:
          120,
        value:
          viewer.user.full_name,
      }),

      field({
        label:
          'PSU student ID',
        name:
          'student_id',
        required:
          true,
        value:
          viewer.user.student_id,
        hint:
          'Digits only.',
      }),
    ),

    h(
      'div',
      {
        class:
          'field-pair',
      },

      field({
        label:
          'PSU email',
        name:
          'psu_email',
        type:
          'email',
        required:
          true,
        value:
          viewer.email,
        hint:
          `Must be a ${domains
            .map(
              (
                domain,
              ) =>
                '@' +
                domain,
            )
            .join(
              ' or ',
            )} address.`,
      }),

      field({
        label:
          'Major',
        name:
          'major',
        required:
          true,
        value:
          viewer.user.major,
        placeholder:
          'e.g. Software Engineering',
      }),
    ),

    field({
      label:
        'Academic year',
      name:
        'academic_year',
      type:
        'select',
      required:
        true,

      /*
       * Pre-filled from the profile when the person answered this while
       * creating their account. Asking twice reads as a form that is not
       * paying attention.
       */
      value:
        viewer.profile
          ?.academic_year ??
        '',

      options: [
        {
          value:
            '',
          label:
            'Select…',
        },

        ...ACADEMIC_YEARS,
      ],
    }),

    h(
      'div',
      {
        class:
          'form-field',
      },

      h(
        'span',
        {
          class:
            'mono-meta',
        },

        'AREAS OF INTEREST',

        h(
          'span',
          {
            class:
              'accent-text',
          },
          ' *',
        ),
      ),

      h(
        'p',
        {
          class:
            'field-hint mono-meta dim-text',
        },
        'Pick anything that sounds interesting. No experience is expected in any of them.',
      ),

      chipPicker(
        'interests',
        INTERESTS,

        knownInterests(
          viewer.profile
            ?.interests ??
          [],
        ),
      ),
    ),

    field({
      label:
        'What would you like to get experience in?',
      name:
        'goal_text',
      type:
        'textarea',
      rows:
        4,
      maxlength:
        1500,
      hint:
        'Optional. A sentence or two is plenty.',
    }),

    status,

    submitButton(
      'Submit application',
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

      const values =
        formValues(
          form,
        );

      const interests =
        asArray(
          values.interests,
        );

      const fullName =
        textOf(
          values,
          'full_name',
        ).trim();

      const studentId =
        textOf(
          values,
          'student_id',
        ).replace(
          /\D/g,
          '',
        );

      const psuEmail =
        textOf(
          values,
          'psu_email',
        )
          .trim()
          .toLowerCase();

      const major =
        textOf(
          values,
          'major',
        ).trim();

      const academicYear =
        textOf(
          values,
          'academic_year',
        );

      const goalText =
        textOf(
          values,
          'goal_text',
        ).trim();

      const button =
        form.querySelector<
          HTMLButtonElement
        >(
          'button[type="submit"], button',
        );

      if (
        !fullName
      ) {
        status.replaceChildren(
          notice(
            'err',
            'Enter your full name.',
          ),
        );

        return;
      }

      if (
        !major
      ) {
        status.replaceChildren(
          notice(
            'err',
            'Enter your major.',
          ),
        );

        return;
      }

      if (
        !academicYear
      ) {
        status.replaceChildren(
          notice(
            'err',
            'Choose your academic year.',
          ),
        );

        return;
      }

      if (
        !interests.length
      ) {
        status.replaceChildren(
          notice(
            'err',
            'Choose at least one area of interest.',
          ),
        );

        return;
      }

      if (
        !/^\d{6,12}$/.test(
          studentId,
        )
      ) {
        status.replaceChildren(
          notice(
            'err',
            'A PSU student ID is 6 to 12 digits.',
          ),
        );

        return;
      }

      const validDomain =
        domains.some(
          (
            domain,
          ) =>
            psuEmail.endsWith(
              '@' +
              domain.toLowerCase(),
            ),
        );

      if (
        !validDomain
      ) {
        status.replaceChildren(
          notice(
            'err',
            `Membership needs a university address (${domains
              .map(
                (
                  domain,
                ) =>
                  '@' +
                  domain,
              )
              .join(
                ', ',
              )}). You can still sign in with ${viewer.email}.`,
          ),
        );

        return;
      }

      if (
        button
      ) {
        button.disabled =
          true;
      }

      status.replaceChildren(
        notice(
          'info',
          'SUBMITTING…',
        ),
      );

      try {
        /*
         * Re-check immediately before inserting.
         *
         * This prevents accidental duplicate submissions if the user had the
         * application open in two tabs or double-navigated back to this page.
         */
        const latest =
          await myApplication(
            viewer.userId,
          );

        if (
          latest
        ) {
          window.location.replace(
            '/portal/status.html',
          );

          return;
        }

        await submitApplication({
          user_id:
            viewer.userId,

          full_name:
            fullName,

          student_id:
            studentId,

          psu_email:
            psuEmail,

          major,

          academic_year:
            academicYear,

          interests,

          goal_text:
            goalText ||
            null,
        });

        window.location.replace(
          '/portal/status.html',
        );
      } catch (error) {
        console.error(
          'Membership application submission failed:',
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
            `Could not submit your application: ${errorMessage(error)}`,
          ),
        );
      }
    },
  );

  render(
    card,

    h(
      'a',
      {
        class:
          'auth-brand',
        href:
          '/index.html',
        'aria-label':
          'ACM PSU — home',
      },

      h(
        'img',
        {
          src:
            '/assets/img/acm.png',
          alt:
            '',
        },
      ),

      h(
        'span',
        'ACM',
      ),

      h(
        'span',
        {
          class:
            'divider dim-text',
        },
        '/',
      ),

      h(
        'span',
        'PSU',
      ),
    ),

    h(
      'div',
      {},

      h(
        'div',
        {
          class:
            'breadcrumb mono-meta',
        },
        'MEMBERSHIP / APPLICATION',
      ),

      h(
        'h1',
        'Membership application',
      ),

      h(
        'p',
        'Everything except the last question is required. ' +
        'You do not need any prior technical experience to join.',
      ),
    ),

    form,
  );
}

void start();