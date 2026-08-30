/**
 * Administration — admins, settings, and the audit history.
 *
 * This page is what makes handover possible. Roles are grants with a trail
 * rather than a flag on a person, the settings that would otherwise be
 * hardcoded live in the database, and everything significant that anyone did
 * is on the record below.
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
  notice,
  toast,
  action,
  emptyState,
  reasonField,
  checkReason,
} from '../lib/ui.js';

import {
  requireAdmin,
  isSuperAdmin,
} from '../lib/session.js';

import {
  adminTeam,
  grantRole,
  revokeAdminWithDisposition,
  auditLog,
  members,
  type AdminRow,
} from '../lib/admin.js';

import {
  settings,
  saveSetting,
} from '../lib/api.js';

import {
  archiveDate,
  archiveDateTime,
  enumLabel,
} from '../lib/format.js';

import type { AdminRole } from '../lib/types.js';

const ROLES: Array<{
  value: AdminRole;
  label: string;
  blurb: string;
}> = [
    {
      value: 'super_admin',
      label: 'Super admin',
      blurb: 'Everything, including granting and revoking admin roles.',
    },
    {
      value: 'club_admin',
      label: 'Club admin',
      blurb: 'Applications, members, positions, projects, archive and exports.',
    },
  {
    value: 'reviewer',
      label: 'Reviewer',
      blurb: 'Review queues only. No member management, settings or exports.',
  },
  {
    value: 'advisory_instructor',
    label: 'Advisory instructor',
    blurb: 'Assigned projects, participants, attendance and contribution verification only.',
  },
];

/**
 * Settings a committee legitimately changes, and how to render each one.
 */
const EDITABLE: Array<{
  key: string;
  label: string;
  kind: 'text' | 'bool' | 'list';
  hint: string;
}> = [
    {
      key: 'current_chapter_year',
      label: 'Current chapter year',
      kind: 'text',
      hint: 'Bump this once per academic year. Nothing in the code hardcodes a year.',
    },
    {
      key: 'chapter_years',
      label: 'Chapter years shown publicly',
      kind: 'list',
      hint: 'Newest first, comma separated.',
    },
    {
      key: 'applications_open',
      label: 'Accepting membership applications',
      kind: 'bool',
      hint: 'Turning this off closes the application form for everyone.',
    },
    {
      key: 'club_email',
      label: 'Club contact email',
      kind: 'text',
      hint: '',
    },
    {
      key: 'psu_email_domains',
      label: 'Accepted PSU email domains',
      kind: 'list',
      hint: 'Comma separated, without the @.',
    },
    {
      key: 'ai_review_enabled',
      label: 'Review assistant (Cloudflare Workers AI)',
      kind: 'bool',
      hint: 'Needs the Edge Function secrets from docs/SETUP.md step 4.',
    },
    {
      key: 'google_sheets_enabled',
      label: 'Google Sheets export',
      kind: 'bool',
      hint: 'Needs the service account from docs/SETUP.md step 5.',
    },
    {
      key: 'max_upload_bytes',
      label: 'Maximum upload size (bytes)',
      kind: 'text',
      hint: '',
    },
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
    'Administration',
  );

  render(content, loading());

  const superAdmin = isSuperAdmin(viewer);

  async function grantDialog(): Promise<void> {
    let memberList;

    try {
      memberList = await members('', '');
    } catch (error) {
      console.error(
        'Could not load members for admin-role grant:',
        error,
      );

      toast(
        `Could not load accounts: ${errorMessage(error)}`,
      );

      return;
    }

    const form = h(
      'form',
      {
        class: 'portal-form',
        novalidate: true,
      },

      field({
        label: 'Person',
        name: 'user_id',
        type: 'select',
        required: true,
        options: [
          {
            value: '',
            label: 'Select…',
          },
          ...memberList.map((member) => ({
            value: member.id,
            label:
              `${member.full_name} — ${member.email}`,
          })),
        ],
        hint: 'They must already have an account.',
      }),

      field({
        label: 'Role',
        name: 'role',
        type: 'select',
        required: true,
        options: ROLES.map((role) => ({
          value: role.value,
          label: role.label,
        })),
      }),

      reasonField({
        label: 'Why is this role being granted?',
        hint:
          'Required. Recorded on the grant and the audit trail, e.g. ' +
          '"2027 committee handover". This is how a future committee ' +
          'reconstructs who was given authority, and by whom.',
      }),

      field({
        label: 'What should happen to the person’s membership and profile?',
        name: 'disposition',
        type: 'select',
        required: true,
        value: 'admin_only',
        options: [
          { value: 'admin_only', label: 'Revoke admin access only — keep membership unchanged' },
          { value: 'archive_public', label: 'Mark as alumni — keep official record public' },
          { value: 'archive_private', label: 'Mark as alumni — keep official record private' },
          { value: 'erase_personal_data', label: 'Delete personal information — anonymize official history' },
        ],
        hint: 'Official position history and verified ACM work are preserved. The deletion option removes personal profile/account data and anonymizes the retained official history.',
      }),

      field({
        label: 'Type DELETE to confirm personal-data deletion',
        name: 'delete_confirmation',
        maxlength: 6,
        placeholder: 'Required only for deletion',
      }),

      notice(
        'info',
        ROLES
          .map(
            (role) =>
              `${role.label}: ${role.blurb}`,
          )
          .join('  '),
      ),
    ) as HTMLFormElement;

    const modal = dialog(
      'Grant an admin role',
      form,

      h(
        'div',
        { class: 'button-row' },

        action(
          'Grant role',
          async () => {
            if (!form.reportValidity()) {
              return;
            }

            const values = formValues(form);

            const reason = checkReason(
              textOf(values, 'reason'),
              'grant an admin role',
            );

            if (!reason) {
              return;
            }

            try {
              await grantRole(
                textOf(values, 'user_id'),
                textOf(values, 'role') as AdminRole,
                reason,
              );

              modal.close();

              toast('Role granted.');

              await draw();
            } catch (error) {
              console.error(
                'Could not grant admin role:',
                error,
              );

              toast(
                `Could not grant role: ${errorMessage(error)}`,
              );
            }
          },
          'primary',
        ),
      ),
    );
  }

  function revokeDialog(row: AdminRow): void {
    const form = h(
      'form',
      { class: 'portal-form' },

      notice(
        'warn',
        `This removes ${enumLabel(row.role)} from ` +
        `${row.member?.full_name ?? 'this person'}. ` +
        'The grant stays on file under Previous admins — ' +
        'that is the record of who ran the club, and when.',
      ),

      reasonField({
        label: 'Why is this role being revoked?',
        hint:
          'Required, e.g. "End of 2026 term" or ' +
          '"Handed over to the incoming president".',
      }),
    ) as HTMLFormElement;

    const modal = dialog(
      `Revoke ${enumLabel(row.role)}`,
      form,

      h(
        'div',
        { class: 'button-row' },

        action(
          'Revoke role',
          async () => {
            const reason = checkReason(
              textOf(
                formValues(form),
                'reason',
              ),
              'revoke an admin role',
            );

            if (!reason) {
              return;
            }

            const values = formValues(form);
            const disposition = textOf(values, 'disposition') as
              'admin_only' | 'archive_public' | 'archive_private' | 'erase_personal_data';
            if (disposition === 'erase_personal_data' &&
                textOf(values, 'delete_confirmation') !== 'DELETE') {
              toast('Type DELETE to confirm personal-data deletion.', 'err');
              return;
            }

            try {
              await revokeAdminWithDisposition(
                row.id,
                disposition,
                reason,
              );

              modal.close();

              toast('Role revoked.');

              await draw();
            } catch (error) {
              console.error(
                'Could not revoke admin role:',
                error,
              );

              toast(
                `Could not revoke role: ${errorMessage(error)}`,
              );
            }
          },
          'danger',
        ),
      ),
    );
  }

  function settingRow(
    key: string,
    value: unknown,
    spec: typeof EDITABLE[number],
  ): HTMLElement {
    if (spec.kind === 'bool') {
      const on = value === true;

      return h(
        'div',
        { class: 'history-row' },

        h(
          'span',
          { class: 'mono-meta' },
          spec.label.toUpperCase(),
        ),

        h(
          'div',
          {},

          statusPill(
            on ? 'active' : 'inactive',
          ),

          spec.hint
            ? h(
              'p',
              {
                class:
                  'mono-meta dim-text',
              },
              spec.hint,
            )
            : null,

          h(
            'div',
            { class: 'button-row' },

            action(
              on
                ? 'Turn off'
                : 'Turn on',

              async () => {
                try {
                  await saveSetting(
                    key,
                    !on,
                    `Switched ${on ? 'off' : 'on'
                    } from the admin console`,
                  );

                  toast(
                    'Setting updated.',
                  );

                  await draw();
                } catch (error) {
                  console.error(
                    `Could not update setting ${key}:`,
                    error,
                  );

                  toast(
                    `Could not update setting: ${errorMessage(error)}`,
                  );
                }
              },
            ),
          ),
        ),
      );
    }

    const current =
      spec.kind === 'list'
        ? Array.isArray(value)
          ? value.join(', ')
          : ''
        : String(value ?? '');

    const input = h(
      'input',
      {
        type: 'text',
        value: current,
      },
    ) as HTMLInputElement;

    return h(
      'div',
      { class: 'history-row' },

      h(
        'span',
        { class: 'mono-meta' },
        spec.label.toUpperCase(),
      ),

      h(
        'div',
        {},

        h(
          'div',
          { class: 'form-field' },
          input,
        ),

        spec.hint
          ? h(
            'p',
            {
              class:
                'mono-meta dim-text',
            },
            spec.hint,
          )
          : null,

        h(
          'div',
          { class: 'button-row' },

          action(
            'Save',
            async () => {
              const raw =
                input.value.trim();

              const next: unknown =
                spec.kind === 'list'
                  ? raw
                    .split(',')
                    .map((value) =>
                      value.trim(),
                    )
                    .filter(Boolean)
                  : /^\d+$/.test(raw)
                    ? Number(raw)
                    : raw;

              try {
                await saveSetting(
                  key,
                  next,
                  'Changed from the admin console',
                );

                toast('Setting saved.');

                await draw();
              } catch (error) {
                console.error(
                  `Could not save setting ${key}:`,
                  error,
                );

                toast(
                  `Could not save setting: ${errorMessage(error)}`,
                );
              }
            },
          ),
        ),
      ),
    );
  }

  async function draw(): Promise<void> {
    render(content, loading());

    try {
      const [
        team,
        revoked,
        config,
        activity,
      ] = await Promise.all([
        adminTeam(false),
        adminTeam(true),
        settings(),
        auditLog(120),
      ]);

      const past = revoked.filter(
        (row: AdminRow) =>
          row.revoked_at !== null,
      );

      render(
        content,

        pageHeader(
          'ADMIN / ADMINISTRATION',
          'Administration',

          superAdmin
            ? h(
              'button',
              {
                type: 'button',
                class: 'btn-submit',
                style: {
                  marginTop: '0',
                },
                onclick: () =>
                  void grantDialog(),
              },
              'Grant a role',
            )
            : null,
        ),

        notice(
          'info',
          'No single person owns this system. Roles are grants that can be transferred, ' +
          'and the last super admin cannot be revoked until another one exists — so the ' +
          'club can never be locked out of its own platform. See docs/HANDOVER.md.',
        ),

        panel(
          'Current admins',

          team.length
            ? dataTable(
              [
                'Person',
                'Role',
                'Granted',
                'Why',
                '',
              ],

              team.map(
                (row: AdminRow) => [
                  h(
                    'div',
                    {},

                    h(
                      'strong',
                      row.member
                        ?.full_name ??
                      '—',
                    ),

                    h(
                      'p',
                      {
                        class:
                          'mono-meta dim-text',
                      },
                      row.member
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
                      row.role,
                    ),
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    archiveDate(
                      row.granted_at,
                    ),
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta dim-text',
                    },
                    row.note ?? '—',
                  ),

                  superAdmin
                    ? h(
                      'button',
                      {
                        type: 'button',
                        class:
                          'btn-ghost btn-danger',
                        onclick: () =>
                          revokeDialog(
                            row,
                          ),
                      },
                      'REVOKE',
                    )
                    : h(
                      'span',
                      {
                        class:
                          'mono-meta dim-text',
                      },
                      'SUPER ADMIN ONLY',
                    ),
                ],
              ),
            )
            : emptyState(
              'No admin roles recorded.',
            ),
        ),

        past.length
          ? panel(
            'Previous admins',

            dataTable(
              [
                'Person',
                'Role',
                'Granted',
                'Revoked',
              ],

              past.map(
                (row: AdminRow) => [
                  row.member
                    ?.full_name ??
                  '—',

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    enumLabel(
                      row.role,
                    ),
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    archiveDate(
                      row.granted_at,
                    ),
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    archiveDate(
                      row.revoked_at,
                    ),
                  ),
                ],
              ),
            ),

            h(
              'p',
              {
                class:
                  'mono-meta dim-text',
              },
              'Kept on purpose: this is the record of who ran the club, and when.',
            ),
          )
          : null,

        panel(
          'Settings',

          h(
            'p',
            'Everything here would otherwise be hardcoded. ' +
            'Changing the chapter year is the one thing ' +
            'a new committee should always do.',
          ),

          h(
            'div',
            {
              class:
                'history-list',
            },

            EDITABLE.map(
              (spec) =>
                settingRow(
                  spec.key,
                  config.get(
                    spec.key,
                  ),
                  spec,
                ),
            ),
          ),
        ),

        h(
          'section',
          {
            class: 'panel',
            id: 'audit',
          },

          h(
            'div',
            {
              class:
                'panel-head',
            },

            h(
              'h2',
              'Audit history',
            ),
          ),

          h(
            'div',
            {
              class:
                'panel-body',
            },

            h(
              'p',
              {
                class:
                  'mono-meta dim-text',
              },
              'Append-only. No role, including super admin, can edit or delete an ' +
              'entry — the database rejects both.',
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
                    '/admin/audit.html',
                },
                'Open the full audit history',
              ),
            ),

            activity.length
              ? dataTable(
                [
                  'When',
                  'Who',
                  'Action',
                  'Detail',
                  'Target',
                ],

                activity.map(
                  (entry) => [
                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      archiveDateTime(
                        entry.created_at,
                      ),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      entry.actor_email ??
                      'system',
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta accent-text',
                      },
                      entry.action,
                    ),

                    entry.summary,

                    h(
                      'span',
                      {
                        class:
                          'mono-meta dim-text',
                      },
                      entry.entity_type
                        ? entry.entity_type
                        : '—',
                    ),
                  ],
                ),
              )
              : emptyState(
                'No recorded actions yet.',
              ),
          ),
        ),
      );
    } catch (error) {
      console.error(
        'Administration page failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'ADMIN / ADMINISTRATION',
          'Administration unavailable',
        ),

        notice(
          'err',
          `The administration page could not load: ${errorMessage(error)}`,
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
