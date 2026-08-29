/**
 * Application queue.
 *
 * Approving is one database transaction (approve_application) that sets the
 * status, creates the membership, carries the applicant's details onto their
 * profile and opens their first position. Doing it in one place means an
 * approval cannot half-happen.
 */

import { h, render, formValues, textOf } from '../lib/dom.js';

import {
  shell,
  pageHeader,
  panel,
  statusPill,
  dataTable,
  loading,
  dialog,
  field,
  metaList,
  notice,
  toast,
  action,
  emptyState,
  reasonField,
  internalNoteField,
  checkReason,
} from '../lib/ui.js';

import { historyPanel } from '../lib/history.js';

import { requireAdmin } from '../lib/session.js';

import {
  applications,
  applicationNotes,
  addApplicationNote,
  markForInterview,
  approveApplication,
  rejectApplication,
  type ApplicationRow,
} from '../lib/admin.js';

import { positions } from '../lib/api.js';

import {
  archiveDate,
  archiveDateTime,
} from '../lib/format.js';

import type { Position } from '../lib/types.js';

const FILTERS: Array<[string, string[]]> = [
  ['Open', ['submitted', 'interview']],
  ['Approved', ['approved']],
  ['Not accepted', ['rejected']],
  [
    'All',
    [
      'submitted',
      'interview',
      'approved',
      'rejected',
      'withdrawn',
    ],
  ],
];

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return 'An unknown error occurred.';
}

async function start(): Promise<void> {
  const viewer = await requireAdmin('club_admin');

  const content = shell(
    viewer,
    'admin',
    'Applications',
  );

  render(content, loading());

  let positionList: Position[] = [];

  try {
    positionList = await positions();
  } catch (error) {
    console.error(
      'Could not load positions for application review:',
      error,
    );

    render(
      content,

      pageHeader(
        'ADMIN / APPLICATIONS',
        'Membership applications unavailable',
      ),

      notice(
        'err',
        `Could not load club positions: ${errorMessage(error)}`,
      ),

      h(
        'div',
        { class: 'button-row' },

        h(
          'button',
          {
            type: 'button',
            class: 'btn-ghost',
            onclick: () => window.location.reload(),
          },
          'TRY AGAIN',
        ),
      ),
    );

    return;
  }

  let filter = 0;

  async function openApplication(
    application: ApplicationRow,
  ): Promise<void> {
    let notes;

    try {
      notes = await applicationNotes(
        application.id,
      );
    } catch (error) {
      console.error(
        `Could not load notes for application ${application.id}:`,
        error,
      );

      toast(
        `Could not open application: ${errorMessage(error)}`,
      );

      return;
    }

    const decided =
      application.status === 'approved' ||
      application.status === 'rejected';

    const noteField = field({
      label: 'Add an interview note',
      name: 'note',
      type: 'textarea',
      rows: 3,
      hint:
        'Internal only. Applicants can never read these.',
    });

    const decisionForm = h(
      'form',
      {
        class: 'portal-form',
        novalidate: true,
      },

      h(
        'div',
        { class: 'field-pair' },

        field({
          label: 'Position on approval',
          name: 'position_id',
          type: 'select',

          value:
            positionList.find(
              (position: Position) =>
                position.slug === 'member',
            )?.id ?? '',

          options: [
            {
              value: '',
              label: '— no position yet —',
            },

            ...positionList.map(
              (position: Position) => ({
                value: position.id,
                label: position.title,
              }),
            ),
          ],
        }),

        field({
          label: 'Membership start date',
          name: 'start_date',
          type: 'date',
          value: new Date()
            .toISOString()
            .slice(0, 10),
        }),
      ),

      reasonField({
        label: 'Reason for this decision',
        hint:
          'Required when declining, and recorded on the permanent audit ' +
          'record either way. Shown to the applicant on their status page.',
      }),

      internalNoteField(),
    ) as HTMLFormElement;

    const modal = dialog(
      application.full_name,

      h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
          },
        },

        metaList([
          [
            'Status',
            statusPill(application.status),
          ],
          [
            'Submitted',
            archiveDate(
              application.created_at,
            ),
          ],
          [
            'Student ID',
            application.student_id,
          ],
          [
            'PSU email',
            application.psu_email,
          ],
          [
            'Account email',
            application.applicant?.email ??
            '—',
          ],
          [
            'Major',
            application.major,
          ],
          [
            'Academic year',
            application.academic_year,
          ],
          [
            'Interests',
            application.interests.join(', ') ||
            '—',
          ],
          [
            'Chapter',
            application.chapter_year,
          ],
        ]),

        application.goal_text
          ? h(
            'div',
            {},

            h(
              'p',
              {
                class:
                  'mono-meta dim-text',
              },
              'WANTS EXPERIENCE IN',
            ),

            h(
              'p',
              application.goal_text,
            ),
          )
          : null,

        historyPanel(
          'application',
          application.id,
          application.user_id,
        ),

        h(
          'div',
          {},

          h(
            'p',
            {
              class:
                'mono-meta dim-text',
            },
            'INTERVIEW NOTES',
          ),

          notes.length
            ? h(
              'div',
              {
                class:
                  'history-list',
              },

              notes.map((note) =>
                h(
                  'div',
                  {
                    class:
                      'history-row',
                  },

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    archiveDateTime(
                      note.created_at,
                    ),
                  ),

                  h(
                    'span',
                    note.body,
                  ),
                ),
              ),
            )
            : h(
              'p',
              {
                class:
                  'mono-meta dim-text',
              },
              'None yet.',
            ),
        ),

        h(
          'form',
          {
            class:
              'portal-form',
          },

          noteField,

          h(
            'div',
            {
              class:
                'button-row',
            },

            action(
              'Add note',

              async () => {
                const textarea =
                  noteField.querySelector(
                    'textarea',
                  ) as HTMLTextAreaElement | null;

                const body =
                  textarea?.value.trim() ??
                  '';

                if (!body) {
                  toast(
                    'Write a note first.',
                  );
                  return;
                }

                try {
                  await addApplicationNote(
                    application.id,
                    body,
                  );

                  modal.close();

                  toast(
                    'Note saved.',
                  );

                  await draw();
                } catch (error) {
                  console.error(
                    'Could not save application note:',
                    error,
                  );

                  toast(
                    `Could not save note: ${errorMessage(error)}`,
                  );
                }
              },
            ),
          ),
        ),

        decided
          ? notice(
            'info',
            'This application has already been decided.',
          )
          : decisionForm,
      ),

      decided
        ? null
        : h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            'Approve',

            async () => {
              if (
                !decisionForm.reportValidity()
              ) {
                return;
              }

              const values =
                formValues(decisionForm);

              try {
                await approveApplication(
                  application.id,

                  textOf(
                    values,
                    'position_id',
                  ) || null,

                  textOf(
                    values,
                    'start_date',
                  ) ||
                  new Date()
                    .toISOString()
                    .slice(0, 10),

                  textOf(
                    values,
                    'reason',
                  ) || null,

                  textOf(
                    values,
                    'internal',
                  ) || null,
                );

                modal.close();

                toast(
                  `${application.full_name} is now an active member.`,
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not approve application:',
                  error,
                );

                toast(
                  `Could not approve application: ${errorMessage(error)}`,
                );
              }
            },

            'primary',
          ),

          application.status ===
            'submitted'
            ? action(
              'Mark for interview',

              async () => {
                const values =
                  formValues(
                    decisionForm,
                  );

                try {
                  await markForInterview(
                    application.id,

                    textOf(
                      values,
                      'reason',
                    ) || null,
                  );

                  modal.close();

                  toast(
                    'Marked for interview.',
                  );

                  await draw();
                } catch (error) {
                  console.error(
                    'Could not mark application for interview:',
                    error,
                  );

                  toast(
                    `Could not update application: ${errorMessage(error)}`,
                  );
                }
              },
            )
            : null,

          action(
            'Not accepted',

            async () => {
              const values =
                formValues(
                  decisionForm,
                );

              /*
               * Declining without an explanation tells a future
               * committee nothing, and leaves the applicant with
               * no idea what happened.
               */
              const reason =
                checkReason(
                  textOf(
                    values,
                    'reason',
                  ),
                  'decline this application',
                );

              if (!reason) {
                return;
              }

              try {
                await rejectApplication(
                  application.id,
                  reason,

                  textOf(
                    values,
                    'internal',
                  ) || null,
                );

                modal.close();

                toast(
                  'Application declined.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not decline application:',
                  error,
                );

                toast(
                  `Could not decline application: ${errorMessage(error)}`,
                );
              }
            },

            'danger',
          ),
        ),
    );
  }

  async function draw(): Promise<void> {
    render(content, loading());

    try {
      const selected =
        FILTERS[filter];

      if (!selected) {
        throw new Error(
          'Invalid application filter.',
        );
      }

      const rows = await applications(
        selected[1],
      );

      render(
        content,

        pageHeader(
          'ADMIN / APPLICATIONS',
          'Membership applications',
        ),

        h(
          'div',
          {
            class:
              'browser-toolbar',
          },

          FILTERS.map(
            ([label], index) =>
              h(
                'button',
                {
                  type: 'button',

                  class:
                    index === filter
                      ? 'btn-ghost active'
                      : 'btn-ghost',

                  style:
                    index === filter
                      ? {
                        borderColor:
                          'var(--accent-blue)',
                        color:
                          'var(--accent-blue)',
                      }
                      : {},

                  onclick: () => {
                    filter = index;
                    void draw();
                  },
                },
                label,
              ),
          ),
        ),

        panel(
          `${rows.length} application${rows.length === 1
            ? ''
            : 's'
          }`,

          rows.length
            ? dataTable(
              [
                'Applicant',
                'Student ID',
                'Major',
                'Year',
                'Interests',
                'Submitted',
                'Status',
                '',
              ],

              rows.map(
                (application) => [
                  h(
                    'div',
                    {},

                    h(
                      'strong',
                      application.full_name,
                    ),

                    h(
                      'p',
                      {
                        class:
                          'mono-meta dim-text',
                      },
                      application.psu_email,
                    ),
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    application.student_id,
                  ),

                  application.major,

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    application.academic_year,
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta dim-text',
                    },

                    application.interests
                      .slice(0, 3)
                      .join(', ') +
                    (
                      application
                        .interests
                        .length > 3
                        ? ` +${application
                          .interests
                          .length - 3
                        }`
                        : ''
                    ),
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    archiveDate(
                      application.created_at,
                    ),
                  ),

                  statusPill(
                    application.status,
                  ),

                  h(
                    'button',
                    {
                      type: 'button',
                      class:
                        'link-button',

                      onclick: () =>
                        void openApplication(
                          application,
                        ),
                    },
                    'REVIEW',
                  ),
                ],
              ),
            )
            : emptyState(
              'Nothing in this queue.',
              'Applications appear here as soon as students submit them.',
            ),
        ),

        notice(
          'info',
          'Membership is not a technical screening. Applications ask what someone wants ' +
          'to learn, not what they can already do.',
        ),
      );
    } catch (error) {
      console.error(
        'Applications page failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'ADMIN / APPLICATIONS',
          'Membership applications unavailable',
        ),

        notice(
          'err',
          `The application queue could not load: ${errorMessage(error)}`,
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
              type: 'button',
              class: 'btn-ghost',

              onclick: () =>
                void draw(),
            },
            'TRY AGAIN',
          ),
        ),
      );
    }
  }

  await draw();
}

void start();