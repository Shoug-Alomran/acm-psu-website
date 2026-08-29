/**
 * Member directory and management.
 *
 * Everything on this page writes to ACM-controlled records, so every action
 * goes through an audited path. Member-controlled fields — bio, links, chosen
 * visibility — are shown but not edited here; those belong to the member.
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

import {
  requireAdmin,
  isSuperAdmin,
} from '../lib/session.js';

import {
  members,
  setMembershipStatus,
  setAccountState,
  grantPosition,
  type MemberRow,
} from '../lib/admin.js';

import {
  positions,
  positionHistory,
  memberStats,
} from '../lib/api.js';

import {
  archiveDate,
  term,
  enumLabel,
} from '../lib/format.js';

import type {
  MembershipStatus,
  Position,
} from '../lib/types.js';

const STATUSES: MembershipStatus[] = [
  'active',
  'applicant',
  'alumni',
  'inactive',
  'withdrawn',
  'rejected',
];

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
    await requireAdmin('club_admin');

  const content = shell(
    viewer,
    'admin',
    'Members',
  );

  render(
    content,
    loading(),
  );

  let positionList: Position[] = [];

  try {
    positionList =
      await positions();
  } catch (error) {
    console.error(
      'Could not load positions for member management:',
      error,
    );

    render(
      content,

      pageHeader(
        'ADMIN / MEMBERS',
        'Members unavailable',
      ),

      notice(
        'err',
        `Could not load club positions: ${errorMessage(error)}`,
      ),

      h(
        'div',
        {
          class: 'button-row',
        },

        h(
          'button',
          {
            type: 'button',
            class: 'btn-ghost',
            onclick: () =>
              window.location.reload(),
          },
          'TRY AGAIN',
        ),
      ),
    );

    return;
  }

  let search = '';
  let statusFilter = '';
  let roleFilter = '';
  let profileFilter = '';
  let majorFilter = '';
  let sinceFilter = '';

  async function openMember(
    member: MemberRow,
  ): Promise<void> {
    let history;
    let stats;

    try {
      [history, stats] =
        await Promise.all([
          positionHistory(
            member.id,
          ),
          memberStats(
            member.id,
          ),
        ]);
    } catch (error) {
      console.error(
        `Could not load member details for ${member.id}:`,
        error,
      );

      toast(
        `Could not open member details: ${errorMessage(error)}`,
        'err',
      );

      return;
    }

    const positionForm = h(
      'form',
      {
        class: 'portal-form',
        novalidate: true,
      },

      h(
        'div',
        {
          class: 'field-pair',
        },

        field({
          label: 'Grant position',
          name: 'position_id',
          type: 'select',
          options: [
            {
              value: '',
              label: 'Select…',
            },

            ...positionList.map(
              (position: Position) => ({
                value:
                  position.id,
                label:
                  position.title,
              }),
            ),
          ],
        }),

        field({
          label: 'Effective from',
          name: 'effective_on',
          type: 'date',
          value: new Date()
            .toISOString()
            .slice(0, 10),
        }),
      ),

      reasonField({
        label:
          'Why this position?',
        required: false,
        hint:
          'Recorded on their position history and the audit record.',
      }),
    ) as HTMLFormElement;

    const statusForm = h(
      'form',
      {
        class: 'portal-form',
        novalidate: true,
      },

      field({
        label:
          'Membership status',
        name: 'status',
        type: 'select',
        value:
          member.membership
            ?.status ??
          'applicant',

        options:
          STATUSES.map(
            (status) => ({
              value: status,
              label:
                enumLabel(
                  status,
                ),
            }),
          ),
      }),

      reasonField({
        hint:
          'Required when ending a membership (alumni, inactive, withdrawn ' +
          'or rejected). Shown to the member and kept permanently.',
      }),

      internalNoteField(
        member.membership
          ?.internal_note,
      ),
    ) as HTMLFormElement;

    const modal = dialog(
      member.full_name,

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
            'Membership',
            statusPill(
              member.membership
                ?.status,
            ),
          ],
          [
            'Account',
            statusPill(
              member.account_state,
            ),
          ],
          [
            'Email',
            member.email,
          ],
          [
            'Student ID',
            member.student_id ??
            '—',
          ],
          [
            'Major',
            member.major ??
            '—',
          ],
          [
            'Academic year',
            member.profile
              ?.academic_year ??
            '—',
          ],
          [
            'Member since',
            archiveDate(
              member.membership
                ?.started_on,
            ),
          ],
          [
            'Chapter',
            member.membership
              ?.chapter_year ??
            '—',
          ],
          [
            'Public profile',
            member.profile
              ?.visibility ===
              'public'
              ? 'Listed'
              : 'Private',
          ],
          [
            'Verified contributions',
            String(
              stats.verified_contributions,
            ),
          ],
          [
            'Events',
            String(
              stats.events_count,
            ),
          ],
        ]),

        h(
          'div',
          {},

          h(
            'p',
            {
              class:
                'mono-meta dim-text',
            },
            'POSITION HISTORY',
          ),

          history.length
            ? h(
              'div',
              {
                class:
                  'history-list',
              },

              history.map(
                (row) =>
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
                      term(
                        row.started_on,
                        row.ended_on,
                      ),
                    ),

                    h(
                      'strong',
                      row.title_snapshot,
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
              'None recorded.',
            ),
        ),

        historyPanel(
          'member',
          member.id,
          member.id,
        ),

        panel(
          'Grant a position',

          positionForm,

          h(
            'p',
            {
              class:
                'mono-meta dim-text',
            },
            'The current position is closed automatically; nothing is overwritten.',
          ),

          h(
            'div',
            {
              class:
                'button-row',
            },

            action(
              'Grant',

              async () => {
                if (
                  !positionForm.reportValidity()
                ) {
                  return;
                }

                const values =
                  formValues(
                    positionForm,
                  );

                const positionId =
                  textOf(
                    values,
                    'position_id',
                  );

                if (!positionId) {
                  toast(
                    'Choose a position.',
                    'err',
                  );

                  return;
                }

                try {
                  await grantPosition(
                    member.id,
                    positionId,

                    textOf(
                      values,
                      'effective_on',
                    ) ||
                    new Date()
                      .toISOString()
                      .slice(0, 10),

                    textOf(
                      values,
                      'reason',
                    ) || null,
                  );

                  modal.close();

                  toast(
                    'Position granted.',
                  );

                  await draw();
                } catch (error) {
                  console.error(
                    'Could not grant member position:',
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
          ),
        ),

        panel(
          'Membership status',

          statusForm,

          h(
            'div',
            {
              class:
                'button-row',
            },

            action(
              'Update status',

              async () => {
                if (
                  !statusForm.reportValidity()
                ) {
                  return;
                }

                const values =
                  formValues(
                    statusForm,
                  );

                const status =
                  textOf(
                    values,
                    'status',
                  ) as MembershipStatus;

                /*
                 * Ending or refusing a membership needs an account of why;
                 * reinstating does not. The database enforces the same rule.
                 */
                const needsReason =
                  [
                    'withdrawn',
                    'inactive',
                    'rejected',
                    'alumni',
                  ].includes(
                    status,
                  );

                const reason =
                  needsReason
                    ? checkReason(
                      textOf(
                        values,
                        'reason',
                      ),
                      `set this membership to ${status}`,
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
                  await setMembershipStatus(
                    member.id,
                    status,
                    reason,

                    textOf(
                      values,
                      'internal',
                    ) ||
                    null,
                  );

                  modal.close();

                  toast(
                    'Status updated.',
                  );

                  await draw();
                } catch (error) {
                  console.error(
                    'Could not update membership status:',
                    error,
                  );

                  toast(
                    `Could not update status: ${errorMessage(error)}`,
                    'err',
                  );
                }
              },

              'primary',
            ),
          ),
        ),

        isSuperAdmin(viewer)
          ? panel(
            'Account access',

            h(
              'p',
              {
                class:
                  'mono-meta dim-text',
              },
              'Disabling stops sign-in. It does not remove the person’s record, ' +
              'history or verified contributions. Write the reason in the ' +
              'Membership status box above — it is recorded permanently.',
            ),

            h(
              'div',
              {
                class:
                  'button-row',
              },

              action(
                member.account_state ===
                  'active'
                  ? 'Disable sign-in'
                  : 'Re-enable sign-in',

                async () => {
                  const next =
                    member.account_state ===
                      'active'
                      ? 'disabled'
                      : 'active';

                  const reason =
                    checkReason(
                      textOf(
                        formValues(
                          statusForm,
                        ),
                        'reason',
                      ),

                      `${next ===
                        'disabled'
                        ? 'disable'
                        : 're-enable'
                      } this account`,
                    );

                  if (!reason) {
                    return;
                  }

                  try {
                    await setAccountState(
                      member.id,
                      next,
                      reason,
                    );

                    modal.close();

                    toast(
                      'Account updated.',
                    );

                    await draw();
                  } catch (error) {
                    console.error(
                      'Could not update member account state:',
                      error,
                    );

                    toast(
                      `Could not update account: ${errorMessage(error)}`,
                      'err',
                    );
                  }
                },

                member.account_state ===
                  'active'
                  ? 'danger'
                  : 'ghost',
              ),
            ),
          )
          : null,
      ),
    );
  }

  async function draw(): Promise<void> {
    render(
      content,
      loading(),
    );

    try {
      const allRows =
        await members(
          search,
          '',
        );

      const rows = allRows.filter((member) =>
        (!statusFilter || member.membership?.status === statusFilter) &&
        (!roleFilter || (member.current_position ?? 'No current role') === roleFilter) &&
        (!profileFilter || (member.profile?.visibility ?? 'private') === profileFilter) &&
        (!majorFilter || (member.major ?? 'Not recorded') === majorFilter) &&
        (!sinceFilter || (member.membership?.started_on?.slice(0, 4) ?? 'Not recorded') === sinceFilter));

      const searchInput = h(
        'input',
        {
          type: 'search',
          placeholder:
            'Name, email or student ID…',
          value: search,
          'aria-label':
            'Search members',
        },
      ) as HTMLInputElement;

      let timer = 0;

      searchInput.addEventListener(
        'input',
        () => {
          window.clearTimeout(
            timer,
          );

          timer =
            window.setTimeout(
              () => {
                search =
                  searchInput.value.trim();

                void draw();
              },
              300,
            );
        },
      );

      const statusSelect = h(
        'select',
        {
          'aria-label':
            'Filter by membership status',
        },

        h(
          'option',
          {
            value: '',
            selected:
              statusFilter === '',
          },
          'All statuses',
        ),

        STATUSES.map(
          (status) =>
            h(
              'option',
              {
                value: status,
                selected:
                  status ===
                  statusFilter,
              },
              enumLabel(
                status,
              ),
            ),
        ),
      ) as HTMLSelectElement;

      statusSelect.addEventListener(
        'change',
        () => {
          statusFilter =
            statusSelect.value;

          void draw();
        },
      );

      const filterSelect = (
        label: string,
        value: string,
        options: string[],
        changed: (value: string) => void,
      ): HTMLSelectElement => {
        const select = h('select', { 'aria-label': `Filter by ${label.toLowerCase()}` },
          h('option', { value: '', selected: value === '' }, `All ${label.toLowerCase()}`),
          options.map((option) => h('option', {
            value: option,
            selected: value === option,
          }, option)),
        ) as HTMLSelectElement;
        select.addEventListener('change', () => {
          changed(select.value);
          void draw();
        });
        return select;
      };

      const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
      const roleSelect = filterSelect(
        'roles', roleFilter,
        unique(allRows.map((member) => member.current_position ?? 'No current role')),
        (value) => { roleFilter = value; },
      );
      const profileSelect = filterSelect(
        'profiles', profileFilter, ['public', 'private'],
        (value) => { profileFilter = value; },
      );
      const majorSelect = filterSelect(
        'majors', majorFilter,
        unique(allRows.map((member) => member.major ?? 'Not recorded')),
        (value) => { majorFilter = value; },
      );
      const sinceSelect = filterSelect(
        'start years', sinceFilter,
        unique(allRows.map((member) => member.membership?.started_on?.slice(0, 4) ?? 'Not recorded')),
        (value) => { sinceFilter = value; },
      );

      render(
        content,

        pageHeader(
          'ADMIN / MEMBERS',
          'Members',

          h(
            'a',
            {
              class:
                'btn-ghost',
              href:
                '/admin/university-records.html',
            },
            'University records',
          ),
        ),

        h(
          'div',
          {
            class:
              'browser-toolbar',
          },

          searchInput,

          statusSelect,

          roleSelect,

          profileSelect,

          sinceSelect,

          majorSelect,

          h(
            'span',
            {
              class:
                'mono-meta dim-text',
            },
            `${rows.length} SHOWN`,
          ),
        ),

        panel(
          'Directory',

          rows.length
            ? dataTable(
              [
                'Member',
                'Student ID',
                'Role',
                'Major',
                'Status',
                'Since',
                'Profile',
                '',
              ],

              rows.map(
                (member) => [
                  h(
                    'div',
                    {},

                    h(
                      'strong',
                      member.full_name,
                    ),

                    h(
                      'p',
                      {
                        class:
                          'mono-meta dim-text',
                      },
                      member.email,
                    ),
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    member.student_id ??
                    '—',
                  ),

                  h(
                    'span',
                    { class: 'mono-meta accent-text' },
                    member.current_position ?? 'MEMBER',
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta dim-text',
                    },
                    member.major ??
                    '—',
                  ),

                  statusPill(
                    member.membership
                      ?.status,
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    archiveDate(
                      member.membership
                        ?.started_on,
                    ),
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    member.profile
                      ?.visibility ===
                      'public'
                      ? 'PUBLIC'
                      : 'PRIVATE',
                  ),

                  h(
                    'button',
                    {
                      type: 'button',
                      class:
                        'link-button',

                      onclick:
                        () =>
                          void openMember(
                            member,
                          ),
                    },
                    'MANAGE',
                  ),
                ],
              ),
            )
            : emptyState(
              'No members match that.',
              'Members appear here once their application is approved.',
            ),
        ),

        notice(
          'info',
          'Bios, links and profile visibility belong to the member and are not edited here. ' +
          'If someone asks for their public profile to be removed, that arrives as a request.',
        ),
      );

      /*
       * Restore the caret after a redraw so typing in search is not interrupted.
       */
      if (search) {
        searchInput.focus();

        searchInput.setSelectionRange(
          search.length,
          search.length,
        );
      }
    } catch (error) {
      console.error(
        'Members page failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'ADMIN / MEMBERS',
          'Members unavailable',
        ),

        notice(
          'err',
          `The member directory could not load: ${errorMessage(error)}`,
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
