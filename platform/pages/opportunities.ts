/**
 * Event opportunities.
 *
 * The point of this page is that opportunity is visible to everyone rather
 * than circulating privately. Every open role on every upcoming event is
 * listed, with how many places are left, and registering interest asks for
 * only what a decision actually needs.
 */

import {
  h,
  render,
  formValues,
  textOf,
} from '../lib/dom.js';

import {
  shell,
  pageHeader,
  panel,
  statusPill,
  emptyState,
  loading,
  dialog,
  field,
  notice,
  toast,
  action,
} from '../lib/ui.js';

import {
  requireMember,
  canSubmit,
} from '../lib/session.js';

import {
  openOpportunities,
  myEventApplications,
  registerInterest,
} from '../lib/api.js';

import {
  archiveDate,
  enumLabel,
} from '../lib/format.js';

interface MyApplicationRow {
  id: string;
  event_position_id: string;
  status: string;
  admin_note: string | null;
  created_at: string;

  position: {
    title: string;
    project_id: string;
  } | null;
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

async function start(): Promise<void> {
  const viewer =
    await requireMember();

  const content =
    shell(
      viewer,
      'member',
      'Opportunities',
    );

  async function draw(): Promise<void> {
    render(
      content,
      loading(
        'LOADING OPEN POSITIONS',
      ),
    );

    try {
      /*
       * Both datasets are required for this screen:
       *
       * - opportunities tells us what is currently available
       * - mine prevents duplicate applications and shows current status
       *
       * If either fails, showing a partial screen could incorrectly let someone
       * attempt to apply twice or make an already-applied role appear available.
       */
      const [
        opportunities,
        mineRaw,
      ] =
        await Promise.all([
          openOpportunities(),

          myEventApplications(
            viewer.userId,
          ),
        ]);

      const mine =
        mineRaw as unknown as MyApplicationRow[];

      const applied =
        new Map(
          mine.map(
            (
              row,
            ) => [
                row.event_position_id,
                row,
              ],
          ),
        );

      /*
       * One card per project, with the project's open roles underneath.
       */
      const byProject =
        new Map<
          string,
          typeof opportunities
        >();

      for (
        const opportunity
        of opportunities
      ) {
        const key =
          opportunity.project?.id ??
          'other';

        const list =
          byProject.get(
            key,
          ) ??
          [];

        list.push(
          opportunity,
        );

        byProject.set(
          key,
          list,
        );
      }

      function registerButton(
        opportunity:
          typeof opportunities[number],
      ): HTMLElement {
        const existing =
          applied.get(
            opportunity.event_position_id,
          );

        if (existing) {
          return statusPill(
            existing.status,
          );
        }

        if (
          !canSubmit(
            viewer,
          )
        ) {
          return h(
            'span',
            {
              class:
                'mono-meta dim-text',
            },
            'ACTIVE MEMBERS ONLY',
          );
        }

        if (
          opportunity.remaining <=
          0
        ) {
          return h(
            'span',
            {
              class:
                'mono-meta dim-text',
            },
            'FULL',
          );
        }

        return h(
          'button',
          {
            type:
              'button',

            class:
              'btn-ghost',

            onclick:
              () => {
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
                    'p',
                    {
                      class:
                        'mono-meta dim-text',
                    },
                    `${opportunity.title.toUpperCase()} — ${opportunity.remaining} OF ${opportunity.openings} REMAINING`,
                  ),

                  field({
                    label:
                      'When are you available?',
                    name:
                      'availability',
                    required:
                      true,
                    maxlength:
                      500,

                    placeholder:
                      'e.g. Weekday afternoons, and the full event weekend',
                  }),

                  field({
                    label:
                      'Anything the organisers should know?',
                    name:
                      'note',
                    type:
                      'textarea',
                    rows:
                      3,
                    maxlength:
                      800,
                    hint:
                      'Optional.',
                  }),

                  status,
                ) as HTMLFormElement;

                const modal =
                  dialog(
                    `Register interest — ${opportunity.title}`,

                    form,

                    h(
                      'div',
                      {
                        class:
                          'button-row',
                      },

                      action(
                        'Send request',

                        async () => {
                          if (
                            !form.reportValidity()
                          ) {
                            return;
                          }

                          const values =
                            formValues(
                              form,
                            );

                          const availability =
                            textOf(
                              values,
                              'availability',
                            ).trim();

                          const note =
                            textOf(
                              values,
                              'note',
                            ).trim();

                          if (
                            !availability
                          ) {
                            status.replaceChildren(
                              notice(
                                'err',
                                'Tell the organisers when you are available.',
                              ),
                            );

                            return;
                          }

                          /*
                           * Re-check the locally loaded state before submitting.
                           * Database/RPC rules remain the actual protection
                           * against duplicates or closed roles.
                           */
                          if (
                            applied.has(
                              opportunity.event_position_id,
                            )
                          ) {
                            status.replaceChildren(
                              notice(
                                'warn',
                                'You already have a request for this position.',
                              ),
                            );

                            return;
                          }

                          if (
                            opportunity.remaining <=
                            0
                          ) {
                            status.replaceChildren(
                              notice(
                                'warn',
                                'This position is now full.',
                              ),
                            );

                            return;
                          }

                          status.replaceChildren(
                            notice(
                              'info',
                              'SENDING REQUEST…',
                            ),
                          );

                          try {
                            await registerInterest({
                              event_position_id:
                                opportunity.event_position_id,

                              user_id:
                                viewer.userId,

                              availability,

                              note:
                                note ||
                                null,
                            });

                            modal.close();

                            toast(
                              'Request sent. An organiser will review it.',
                            );

                            try {
                              await draw();
                            } catch (error) {
                              /*
                               * draw() already has its own error rendering,
                               * but keep this guarded so a successful request
                               * never becomes an unhandled rejection.
                               */
                              console.error(
                                'Request succeeded but opportunities could not refresh:',
                                error,
                              );
                            }
                          } catch (error) {
                            console.error(
                              'Could not register interest in event position:',
                              error,
                            );

                            status.replaceChildren(
                              notice(
                                'err',
                                `Could not send your request: ${errorMessage(error)}`,
                              ),
                            );
                          }
                        },

                        'primary',
                      ),
                    ),
                  );
              },
          },
          'Register interest',
        );
      }

      render(
        content,

        pageHeader(
          'MEMBER / OPPORTUNITIES',

          'Open positions',

          h(
            'a',
            {
              class:
                'btn-ghost',
              href:
                '/portal/index.html',
            },
            'Dashboard',
          ),
        ),

        notice(
          'info',
          'These are roles on upcoming ACM events. No prior experience is expected — ' +
          'that is what taking one is for. Approved involvement becomes part of your verified record.',
        ),

        opportunities.length
          ? [
            ...byProject.entries(),
          ].map(
            (
              [
                ,
                list,
              ],
            ) => {
              const project =
                list[0]
                  ?.project;

              return panel(
                project?.title ??
                'Other',

                project?.summary
                  ? h(
                    'p',
                    project.summary,
                  )
                  : null,

                project?.starts_on
                  ? h(
                    'p',
                    {
                      class:
                        'mono-meta dim-text',
                    },
                    `STARTS ${archiveDate(project.starts_on)}`,
                  )
                  : null,

                h(
                  'div',
                  {
                    class:
                      'browser-list',
                  },

                  list.map(
                    (
                      opportunity,
                    ) =>
                      h(
                        'div',
                        {
                          class:
                            'browser-row',

                          style: {
                            cursor:
                              'default',
                          },
                        },

                        h(
                          'div',
                          {
                            class:
                              'fname',
                          },

                          h(
                            'span',
                            {
                              class:
                                'icon',
                            },
                            '◆',
                          ),

                          h(
                            'span',
                            opportunity.title,
                          ),
                        ),

                        h(
                          'span',
                          {
                            class:
                              'fcell',
                          },
                          `${opportunity.remaining}/${opportunity.openings} OPEN`,
                        ),

                        h(
                          'span',
                          {
                            class:
                              'fcell col-hide',
                          },
                          opportunity.description ??
                          '',
                        ),

                        h(
                          'span',
                          {
                            class:
                              'fcell col-hide',
                          },

                          opportunity.closes_on
                            ? `CLOSES ${archiveDate(opportunity.closes_on)}`
                            : '',
                        ),

                        registerButton(
                          opportunity,
                        ),
                      ),
                  ),
                ),
              );
            },
          )
          : panel(
            'Nothing open right now',

            emptyState(
              'There are no open positions at the moment.',
              'New roles are posted here whenever an event is being organised.',
            ),
          ),

        mine.length
          ? panel(
            'Your requests',

            h(
              'div',
              {
                class:
                  'history-list',
              },

              mine.map(
                (
                  row,
                ) =>
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
                      archiveDate(
                        row.created_at,
                      ),
                    ),

                    h(
                      'div',
                      {},

                      h(
                        'strong',
                        row.position?.title ??
                        enumLabel(
                          'event position',
                        ),
                      ),

                      ' ',

                      statusPill(
                        row.status,
                      ),

                      row.admin_note
                        ? h(
                          'p',
                          {
                            class:
                              'mono-meta dim-text',
                          },
                          row.admin_note,
                        )
                        : null,
                    ),
                  ),
              ),
            ),
          )
          : null,
      );
    } catch (error) {
      console.error(
        'Opportunities page failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'MEMBER / OPPORTUNITIES',
          'Opportunities unavailable',

          h(
            'a',
            {
              class:
                'btn-ghost',
              href:
                '/portal/index.html',
            },
            'Dashboard',
          ),
        ),

        notice(
          'err',
          `Open positions could not load: ${errorMessage(error)}`,
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