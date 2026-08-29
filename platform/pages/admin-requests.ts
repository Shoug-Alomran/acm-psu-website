/**
 * All member requests in one queue.
 *
 * Withdrawal, position change, profile removal, account deletion and event
 * volunteering arrive here. Each resolves through the RPC written for it, so
 * the side effects — closing a position, setting a membership status, creating
 * a verified participation record — happen the same way every time.
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

import {
  historyPanel,
} from '../lib/history.js';

import {
  requireAdmin,
} from '../lib/session.js';

import {
  memberRequests,
  positionRequests,
  eventRequests,
  resolveWithdrawal,
  resolveProfileRemoval,
  resolvePositionRequest,
  decideMemberRequest,
  decideEventRequest,
  type MemberRequestRow,
  type PositionRequestRow,
} from '../lib/admin.js';

import {
  positions,
} from '../lib/api.js';

import {
  archiveDate,
  enumLabel,
} from '../lib/format.js';

import type {
  MembershipStatus,
  Position,
} from '../lib/types.js';

interface EventRequestRow {
  id: string;
  created_at: string;
  status: string;
  availability: string | null;
  note: string | null;
  admin_note: string | null;

  member: {
    full_name: string;
    email: string;
  } | null;

  position: {
    title: string;
    openings: number;
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
    await requireAdmin(
      'club_admin',
    );

  const content =
    shell(
      viewer,
      'admin',
      'Requests',
    );

  render(
    content,
    loading(),
  );

  let positionList:
    Position[] =
    [];

  try {
    positionList =
      await positions();
  } catch (error) {
    console.error(
      'Could not load positions for requests page:',
      error,
    );

    render(
      content,

      pageHeader(
        'ADMIN / REQUESTS',
        'Requests unavailable',
      ),

      notice(
        'err',
        `Could not load club positions: ${errorMessage(error)}`,
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

  let showResolved =
    false;

  /* ------------------------------------------------------------ withdrawal */

  function withdrawalDialog(
    request:
      MemberRequestRow,
  ): void {
    const preferred =
      String(
        request.payload
          .preferred_outcome ??
        '',
      );

    const form = h(
      'form',
      {
        class:
          'portal-form',
      },

      notice(
        'info',
        'Position history and verified contributions are kept whatever you choose. ' +
        'This only changes the person’s standing.',
      ),

      field({
        label:
          'Resulting status',
        name: 'status',
        type: 'select',
        value:
          preferred ||
          'alumni',

        options: [
          {
            value:
              'alumni',
            label:
              'Alumni — finished their time here',
          },
          {
            value:
              'inactive',
            label:
              'Inactive — may return',
          },
          {
            value:
              'withdrawn',
            label:
              'Withdrawn',
          },
        ],
      }),

      field({
        label:
          'Close their current position?',
        name:
          'close_position',
        type:
          'select',
        value:
          'yes',

        options: [
          {
            value:
              'yes',
            label:
              'Yes — end the current term',
          },
          {
            value:
              'no',
            label:
              'No — leave it open',
          },
        ],
      }),

      reasonField({
        label:
          'Reason for this outcome',
        hint:
          'Required. Shown to the member and kept on the permanent record.',
      }),
    ) as HTMLFormElement;

    const modal =
      dialog(
        `Withdrawal — ${request.member?.full_name ?? ''}`,

        h(
          'div',
          {
            style: {
              display:
                'flex',
              flexDirection:
                'column',
              gap:
                '1.25rem',
            },
          },

          metaList([
            [
              'Requested',
              archiveDate(
                request.created_at,
              ),
            ],

            [
              'Preferred outcome',
              preferred
                ? enumLabel(
                  preferred,
                )
                : 'Left to the admins',
            ],

            [
              'Their message',
              request.message ??
              '—',
            ],
          ]),

          form,

          historyPanel(
            'member',
            request.user_id,
            request.user_id,
          ),
        ),

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            'Confirm withdrawal',

            async () => {
              const values =
                formValues(
                  form,
                );

              const reason =
                checkReason(
                  textOf(
                    values,
                    'reason',
                  ),
                  'end this membership',
                );

              if (!reason) {
                return;
              }

              try {
                await resolveWithdrawal(
                  request.id,

                  textOf(
                    values,
                    'status',
                  ) as MembershipStatus,

                  textOf(
                    values,
                    'close_position',
                  ) === 'yes',

                  reason,
                );

                modal.close();

                toast(
                  'Membership updated.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not resolve withdrawal:',
                  error,
                );

                toast(
                  `Could not update membership: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'primary',
          ),

          action(
            'Decline',

            async () => {
              const reason =
                checkReason(
                  textOf(
                    formValues(
                      form,
                    ),
                    'reason',
                  ),
                  'decline this request',
                );

              if (!reason) {
                return;
              }

              try {
                await decideMemberRequest(
                  request.id,
                  false,
                  reason,
                );

                modal.close();

                toast(
                  'Request declined.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not decline withdrawal request:',
                  error,
                );

                toast(
                  `Could not decline request: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'danger',
          ),
        ),
      );
  }

  /* -------------------------------------------------------- profile removal */

  function removalDialog(
    request:
      MemberRequestRow,
  ): void {
    const form = h(
      'form',
      {
        class:
          'portal-form',
      },

      notice(
        'info',
        'Approving sets their profile to private. Their membership, record and ' +
        'position history are untouched, and nothing is deleted.',
      ),

      reasonField({
        required:
          false,
        hint:
          'Optional when granting the request; required if you decline it.',
      }),
    ) as HTMLFormElement;

    const modal =
      dialog(
        `Profile removal — ${request.member?.full_name ?? ''}`,

        h(
          'div',
          {
            style: {
              display:
                'flex',
              flexDirection:
                'column',
              gap:
                '1.25rem',
            },
          },

          metaList([
            [
              'Requested',
              archiveDate(
                request.created_at,
              ),
            ],

            [
              'Their message',
              request.message ??
              '—',
            ],
          ]),

          form,
        ),

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            'Remove public profile',

            async () => {
              try {
                await resolveProfileRemoval(
                  request.id,
                  true,

                  textOf(
                    formValues(
                      form,
                    ),
                    'reason',
                  ) ||
                  null,
                );

                modal.close();

                toast(
                  'Profile hidden from the public site.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not approve profile removal:',
                  error,
                );

                toast(
                  `Could not hide profile: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'primary',
          ),

          action(
            'Decline',

            async () => {
              const reason =
                checkReason(
                  textOf(
                    formValues(
                      form,
                    ),
                    'reason',
                  ),
                  'decline a profile removal request',
                );

              if (!reason) {
                return;
              }

              try {
                await resolveProfileRemoval(
                  request.id,
                  false,
                  reason,
                );

                modal.close();

                toast(
                  'Request declined.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not decline profile removal:',
                  error,
                );

                toast(
                  `Could not decline request: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'danger',
          ),
        ),
      );
  }

  /* ---------------------------------------------------------------- generic */

  function genericDialog(
    request:
      MemberRequestRow,
  ): void {
    const form = h(
      'form',
      {
        class:
          'portal-form',
      },

      request.kind ===
        'account_deletion'
        ? notice(
          'warn',
          'Deleting an account removes sign-in only. Official records — position ' +
          'history, verified contributions, published archive items — are club ' +
          'records and stay. Talk to the person before doing anything irreversible; ' +
          'disabling the account from Members is usually the right first step.',
        )
        : null,

      reasonField({
        hint:
          'Required for account deletion requests and whenever you decline. Shown to the member.',
      }),

      internalNoteField(),
    ) as HTMLFormElement;

    const modal =
      dialog(
        `${enumLabel(request.kind)} — ${request.member?.full_name ?? ''}`,

        h(
          'div',
          {
            style: {
              display:
                'flex',
              flexDirection:
                'column',
              gap:
                '1.25rem',
            },
          },

          metaList([
            [
              'Requested',
              archiveDate(
                request.created_at,
              ),
            ],

            [
              'Email',
              request.member
                ?.email ??
              '—',
            ],

            [
              'Their message',
              request.message ??
              '—',
            ],
          ]),

          form,
        ),

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            'Mark handled',

            async () => {
              const values =
                formValues(
                  form,
                );

              const needsReason =
                request.kind ===
                'account_deletion';

              const reason =
                needsReason
                  ? checkReason(
                    textOf(
                      values,
                      'reason',
                    ),
                    'resolve an account deletion request',
                  )
                  : textOf(
                    values,
                    'reason',
                  ) ||
                  null;

              if (
                needsReason &&
                !reason
              ) {
                return;
              }

              try {
                await decideMemberRequest(
                  request.id,
                  true,
                  reason,

                  textOf(
                    values,
                    'internal',
                  ) ||
                  null,
                );

                modal.close();

                toast(
                  'Request closed.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not resolve member request:',
                  error,
                );

                toast(
                  `Could not resolve request: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'primary',
          ),

          action(
            'Decline',

            async () => {
              const values =
                formValues(
                  form,
                );

              const reason =
                checkReason(
                  textOf(
                    values,
                    'reason',
                  ),
                  'decline this request',
                );

              if (!reason) {
                return;
              }

              try {
                await decideMemberRequest(
                  request.id,
                  false,
                  reason,

                  textOf(
                    values,
                    'internal',
                  ) ||
                  null,
                );

                modal.close();

                toast(
                  'Request declined.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not decline member request:',
                  error,
                );

                toast(
                  `Could not decline request: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'danger',
          ),
        ),
      );
  }

  /* ------------------------------------------------------- position change */

  function positionDialog(
    request:
      PositionRequestRow,
  ): void {
    const form = h(
      'form',
      {
        class:
          'portal-form',
      },

      notice(
        'info',
        'Approving closes their current position and opens a new one. Nothing in ' +
        'their history is overwritten.',
      ),

      h(
        'div',
        {
          class:
            'field-pair',
        },

        field({
          label:
            'Position to grant',
          name:
            'position_id',
          type:
            'select',

          value:
            request
              .requested_position_id ??
            '',

          options: [
            {
              value:
                '',
              label:
                'Select…',
            },

            ...positionList.map(
              (
                position:
                  Position,
              ) => ({
                value:
                  position.id,
                label:
                  position.title,
              }),
            ),
          ],
        }),

        field({
          label:
            'Effective from',
          name:
            'effective_on',
          type:
            'date',

          value:
            new Date()
              .toISOString()
              .slice(
                0,
                10,
              ),
        }),
      ),

      reasonField({
        required:
          false,
        hint:
          'Optional when approving; required if you decline. Shown to the member.',
      }),
    ) as HTMLFormElement;

    const modal =
      dialog(
        `Position request — ${request.member?.full_name ?? ''}`,

        h(
          'div',
          {
            style: {
              display:
                'flex',
              flexDirection:
                'column',
              gap:
                '1.25rem',
            },
          },

          metaList([
            [
              'Requested',
              archiveDate(
                request.created_at,
              ),
            ],

            [
              'They asked for',
              request.requested
                ?.title ??
              request.requested_title ??
              '—',
            ],

            [
              'Why',
              request.reason ??
              '—',
            ],
          ]),

          form,
        ),

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            'Approve',

            async () => {
              const values =
                formValues(
                  form,
                );

              const positionId =
                textOf(
                  values,
                  'position_id',
                );

              if (!positionId) {
                toast(
                  'Choose the position being granted.',
                  'err',
                );

                return;
              }

              try {
                await resolvePositionRequest(
                  request.id,
                  true,
                  positionId,

                  textOf(
                    values,
                    'effective_on',
                  ) ||
                  new Date()
                    .toISOString()
                    .slice(
                      0,
                      10,
                    ),

                  textOf(
                    values,
                    'reason',
                  ) ||
                  null,
                );

                modal.close();

                toast(
                  'Position granted.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not approve position request:',
                  error,
                );

                toast(
                  `Could not grant position: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'primary',
          ),

          action(
            'Decline',

            async () => {
              const reason =
                checkReason(
                  textOf(
                    formValues(
                      form,
                    ),
                    'reason',
                  ),
                  'decline this position request',
                );

              if (!reason) {
                return;
              }

              try {
                await resolvePositionRequest(
                  request.id,
                  false,
                  null,

                  new Date()
                    .toISOString()
                    .slice(
                      0,
                      10,
                    ),

                  reason,
                );

                modal.close();

                toast(
                  'Request declined.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not decline position request:',
                  error,
                );

                toast(
                  `Could not decline request: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'danger',
          ),
        ),
      );
  }

  /* ------------------------------------------------------------------ event */

  function eventDialog(
    request:
      EventRequestRow,
  ): void {
    const member =
      request.member;

    const position =
      request.position;

    const form = h(
      'form',
      {
        class:
          'portal-form',
      },

      notice(
        'info',
        'Approving records verified participation on the event, which becomes part ' +
        'of their ACM record. Capacity is checked when you approve.',
      ),

      reasonField({
        required:
          false,
        hint:
          'Optional. Shown to the member with the outcome.',
      }),
    ) as HTMLFormElement;

    const modal =
      dialog(
        `Event position — ${member?.full_name ?? ''}`,

        h(
          'div',
          {
            style: {
              display:
                'flex',
              flexDirection:
                'column',
              gap:
                '1.25rem',
            },
          },

          metaList([
            [
              'Role',
              position
                ?.title ??
              '—',
            ],

            [
              'Openings',
              String(
                position
                  ?.openings ??
                '—',
              ),
            ],

            [
              'Availability',
              request.availability ??
              '—',
            ],

            [
              'Their note',
              request.note ??
              '—',
            ],
          ]),

          form,
        ),

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            'Approve',

            async () => {
              try {
                await decideEventRequest(
                  request.id,
                  true,

                  textOf(
                    formValues(
                      form,
                    ),
                    'reason',
                  ) ||
                  null,
                );

                modal.close();

                toast(
                  'Assigned.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not approve event position request:',
                  error,
                );

                toast(
                  `Could not assign member: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'primary',
          ),

          action(
            'Decline',

            async () => {
              try {
                await decideEventRequest(
                  request.id,
                  false,

                  textOf(
                    formValues(
                      form,
                    ),
                    'reason',
                  ) ||
                  null,
                );

                modal.close();

                toast(
                  'Declined.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not decline event position request:',
                  error,
                );

                toast(
                  `Could not decline request: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'danger',
          ),
        ),
      );
  }

  /* ------------------------------------------------------------------- draw */

  async function draw(): Promise<void> {
    render(
      content,
      loading(),
    );

    try {
      const statuses =
        showResolved
          ? [
            'pending',
            'approved',
            'rejected',
            'cancelled',
          ]
          : [
            'pending',
          ];

      const [
        general,
        position,
        eventRaw,
      ] =
        await Promise.all([
          memberRequests(
            statuses,
          ),

          positionRequests(
            statuses,
          ),

          eventRequests(
            statuses,
          ),
        ]);

      const event =
        eventRaw as unknown as EventRequestRow[];

      render(
        content,

        pageHeader(
          'ADMIN / REQUESTS',
          'Member requests',

          h(
            'button',
            {
              type:
                'button',
              class:
                'btn-ghost',

              onclick:
                () => {
                  showResolved =
                    !showResolved;

                  void draw();
                },
            },

            showResolved
              ? 'Show pending only'
              : 'Include resolved',
          ),
        ),

        panel(
          `Membership and privacy — ${general.length}`,

          general.length
            ? dataTable(
              [
                'Member',
                'Request',
                'Message',
                'Raised',
                'Status',
                '',
              ],

              general.map(
                (
                  request,
                ) => [
                    h(
                      'div',
                      {},

                      h(
                        'strong',
                        request.member
                          ?.full_name ??
                        '—',
                      ),

                      h(
                        'p',
                        {
                          class:
                            'mono-meta dim-text',
                        },
                        request.member
                          ?.email ??
                        '',
                      ),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta accent-text',
                      },
                      enumLabel(
                        request.kind,
                      ),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta dim-text',
                      },
                      (
                        request.message ??
                        ''
                      ).slice(
                        0,
                        90,
                      ) ||
                      '—',
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      archiveDate(
                        request.created_at,
                      ),
                    ),

                    statusPill(
                      request.status,
                    ),

                    request.status ===
                      'pending'
                      ? h(
                        'button',
                        {
                          type:
                            'button',
                          class:
                            'link-button',

                          onclick:
                            () => {
                              if (
                                request.kind ===
                                'withdrawal'
                              ) {
                                withdrawalDialog(
                                  request,
                                );

                                return;
                              }

                              if (
                                request.kind ===
                                'profile_removal'
                              ) {
                                removalDialog(
                                  request,
                                );

                                return;
                              }

                              genericDialog(
                                request,
                              );
                            },
                        },
                        'RESOLVE',
                      )
                      : h(
                        'span',
                        {
                          class:
                            'mono-meta dim-text',
                        },
                        request.admin_note ??
                        '',
                      ),
                  ],
              ),
            )
            : emptyState(
              'Nothing waiting.',
            ),
        ),

        panel(
          `Position changes — ${position.length}`,

          position.length
            ? dataTable(
              [
                'Member',
                'Asked for',
                'Why',
                'Raised',
                'Status',
                '',
              ],

              position.map(
                (
                  request,
                ) => [
                    request.member
                      ?.full_name ??
                    '—',

                    request.requested
                      ?.title ??
                    request.requested_title ??
                    '—',

                    h(
                      'span',
                      {
                        class:
                          'mono-meta dim-text',
                      },
                      (
                        request.reason ??
                        ''
                      ).slice(
                        0,
                        90,
                      ) ||
                      '—',
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      archiveDate(
                        request.created_at,
                      ),
                    ),

                    statusPill(
                      request.status,
                    ),

                    request.status ===
                      'pending'
                      ? h(
                        'button',
                        {
                          type:
                            'button',
                          class:
                            'link-button',

                          onclick:
                            () =>
                              positionDialog(
                                request,
                              ),
                        },
                        'RESOLVE',
                      )
                      : h(
                        'span',
                        {
                          class:
                            'mono-meta dim-text',
                        },
                        request.admin_note ??
                        '',
                      ),
                  ],
              ),
            )
            : emptyState(
              'Nothing waiting.',
            ),
        ),

        panel(
          `Event positions — ${event.length}`,

          event.length
            ? dataTable(
              [
                'Member',
                'Role',
                'Availability',
                'Raised',
                'Status',
                '',
              ],

              event.map(
                (
                  request,
                ) => [
                    request.member
                      ?.full_name ??
                    '—',

                    request.position
                      ?.title ??
                    '—',

                    h(
                      'span',
                      {
                        class:
                          'mono-meta dim-text',
                      },
                      (
                        request.availability ??
                        '—'
                      ).slice(
                        0,
                        60,
                      ),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      archiveDate(
                        request.created_at,
                      ),
                    ),

                    statusPill(
                      request.status,
                    ),

                    request.status ===
                      'pending'
                      ? h(
                        'button',
                        {
                          type:
                            'button',
                          class:
                            'link-button',

                          onclick:
                            () =>
                              eventDialog(
                                request,
                              ),
                        },
                        'RESOLVE',
                      )
                      : h(
                        'span',
                        {
                          class:
                            'mono-meta dim-text',
                        },
                        request.admin_note ??
                        '',
                      ),
                  ],
              ),
            )
            : emptyState(
              'Nothing waiting.',
            ),
        ),

        notice(
          'info',
          'Leaving ACM, hiding a public profile and deleting an account are three ' +
          'separate requests, and none of them erases verified work.',
        ),
      );
    } catch (error) {
      console.error(
        'Requests page failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'ADMIN / REQUESTS',
          'Requests unavailable',
        ),

        notice(
          'err',
          `The requests queue could not load: ${errorMessage(error)}`,
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