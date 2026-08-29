/**
 * Contribution review.
 *
 * Four outcomes, matching how review actually goes: approve, edit and approve,
 * ask for changes, or decline. "Edit and approve" exists because the common
 * case is a real contribution described too vaguely — rejecting that would be
 * the wrong answer.
 */

import { h, render, formValues, textOf } from '../lib/dom.js';

import {
  shell,
  pageHeader,
  panel,
  statusPill,
  attentionRow,
  attentionLegend,
  ageAttention,
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
  verifyContribution,
  decideContribution,
} from '../lib/admin.js';

import {
  reviewQueue,
  contributionTypes,
  projects,
  signedUrl,
} from '../lib/api.js';

import { requireClient } from '../lib/supabase.js';

import {
  archiveDate,
  enumLabel,
} from '../lib/format.js';

import type {
  ContributionType,
  Project,
  ReviewStatus,
} from '../lib/types.js';

const FILTERS: Array<
  [string, ReviewStatus[]]
> = [
    [
      'Awaiting review',
      ['submitted'],
    ],
    [
      'Changes requested',
      ['changes_requested'],
    ],
    [
      'Verified',
      ['approved'],
    ],
    [
      'Declined',
      ['rejected'],
    ],
  ];

interface Evidence {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  external_url: string | null;
  file_name: string | null;
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
    await requireAdmin('reviewer');

  const content = shell(
    viewer,
    'admin',
    'Contribution review',
  );

  render(
    content,
    loading(),
  );

  let types: ContributionType[] = [];
  let projectList: Project[] = [];

  try {
    [types, projectList] =
      await Promise.all([
        contributionTypes(),
        projects(),
      ]);
  } catch (error) {
    console.error(
      'Could not load contribution review dependencies:',
      error,
    );

    render(
      content,

      pageHeader(
        'ADMIN / CONTRIBUTIONS',
        'Contribution review unavailable',
      ),

      notice(
        'err',
        `Could not load contribution types or projects: ${errorMessage(error)}`,
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

  const projectTitle = new Map(
    projectList.map(
      (project: Project) => [
        project.id,
        project.title,
      ],
    ),
  );

  let filter = 0;

  async function review(
    row: Awaited<
      ReturnType<typeof reviewQueue>
    >[number],
  ): Promise<void> {
    let evidence: Evidence[] = [];

    try {
      const result =
        await requireClient()
          .from(
            'contribution_evidence',
          )
          .select('*')
          .eq(
            'contribution_id',
            row.id,
          );

      if (result.error) {
        throw result.error;
      }

      evidence =
        (result.data ??
          []) as Evidence[];
    } catch (error) {
      console.error(
        `Could not load evidence for contribution ${row.id}:`,
        error,
      );

      toast(
        `Could not open contribution evidence: ${errorMessage(error)}`,
        'err',
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
        label: 'Title',
        name: 'title',
        value: row.title,
        maxlength: 200,
      }),

      h(
        'div',
        {
          class: 'field-pair',
        },

        field({
          label: 'Type',
          name: 'type_slug',
          type: 'select',
          value: row.type_slug,

          options: types.map(
            (
              type: ContributionType,
            ) => ({
              value: type.slug,
              label: type.label,
            }),
          ),
        }),

        field({
          label: 'Project',
          name: 'project_id',
          type: 'select',
          value:
            row.project_id ??
            '',

          options: [
            {
              value: '',
              label: '— none —',
            },

            ...projectList.map(
              (project: Project) => ({
                value:
                  project.id,
                label:
                  project.title,
              }),
            ),
          ],
        }),
      ),

      field({
        label: 'Role',
        name: 'role_text',
        value:
          row.role_text ??
          '',
        maxlength: 120,
      }),

      field({
        label: 'Description',
        name: 'description',
        type: 'textarea',
        rows: 4,
        value:
          row.description ??
          '',
      }),

      reasonField({
        hint:
          'Required when asking for changes or declining. Shown to the ' +
          'member and kept on the audit record.',
      }),

      internalNoteField(),
    ) as HTMLFormElement;

    const edits = () => {
      const values =
        formValues(form);

      return {
        title:
          textOf(
            values,
            'title',
          ),

        type:
          textOf(
            values,
            'type_slug',
          ),

        role:
          textOf(
            values,
            'role_text',
          ) || null,

        description:
          textOf(
            values,
            'description',
          ) || null,

        project:
          textOf(
            values,
            'project_id',
          ) || null,
      };
    };

    const modal = dialog(
      `Review — ${row.title}`,

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
            'Member',
            row.member
              ?.full_name ??
            '—',
          ],
          [
            'Email',
            row.member
              ?.email ??
            '—',
          ],
          [
            'Submitted',
            archiveDate(
              row.created_at,
            ),
          ],
          [
            'Date of work',
            archiveDate(
              row.occurred_on,
            ),
          ],
          [
            'Status',
            statusPill(
              row.status,
            ),
          ],
          [
            'Links',
            row.links.length
              ? h(
                'div',
                {},

                row.links.map(
                  (link) =>
                    h(
                      'p',
                      h(
                        'a',
                        {
                          href: link,
                          rel:
                            'noopener noreferrer',
                          target:
                            '_blank',
                        },
                        link,
                      ),
                    ),
                ),
              )
              : '—',
          ],
          [
            'Member note',
            row.member_note ??
            '—',
          ],
        ]),

        evidence.length
          ? h(
            'div',
            {},

            h(
              'p',
              {
                class:
                  'mono-meta dim-text',
              },
              'EVIDENCE',
            ),

            h(
              'div',
              {
                class:
                  'button-row',
              },

              evidence.map(
                (file) =>
                  action(
                    file.file_name ??
                    'OPEN FILE',

                    async () => {
                      try {
                        const url =
                          file.external_url ??
                          (
                            file.storage_bucket &&
                              file.storage_path
                              ? await signedUrl(
                                file.storage_bucket,
                                file.storage_path,
                              )
                              : null
                          );

                        if (!url) {
                          toast(
                            'Could not open that file.',
                            'err',
                          );

                          return;
                        }

                        window.open(
                          url,
                          '_blank',
                          'noopener',
                        );
                      } catch (error) {
                        console.error(
                          'Could not open contribution evidence:',
                          error,
                        );

                        toast(
                          `Could not open that file: ${errorMessage(error)}`,
                          'err',
                        );
                      }
                    },
                  ),
              ),
            ),
          )
          : null,

        h(
          'p',
          {
            class:
              'mono-meta dim-text',
          },
          'CORRECT ANYTHING BELOW BEFORE APPROVING — THE EDITED TEXT IS WHAT GETS VERIFIED',
        ),

        form,

        historyPanel(
          'contribution',
          row.id,
          row.user_id,
        ),
      ),

      h(
        'div',
        {
          class: 'button-row',
        },

        action(
          'Verify',

          async () => {
            if (
              !form.reportValidity()
            ) {
              return;
            }

            const values =
              formValues(form);

            try {
              await verifyContribution(
                row.id,
                edits(),
                textOf(
                  values,
                  'reason',
                ) || null,
              );

              modal.close();

              toast(
                'Contribution verified.',
              );

              await draw();
            } catch (error) {
              console.error(
                'Could not verify contribution:',
                error,
              );

              toast(
                `Could not verify contribution: ${errorMessage(error)}`,
                'err',
              );
            }
          },

          'primary',
        ),

        action(
          'Request changes',

          async () => {
            const values =
              formValues(form);

            const reason =
              checkReason(
                textOf(
                  values,
                  'reason',
                ),
                'ask for changes',
              );

            if (!reason) {
              return;
            }

            try {
              await decideContribution(
                row.id,
                'changes_requested',
                reason,

                textOf(
                  values,
                  'internal',
                ) || null,
              );

              modal.close();

              toast(
                'Sent back to the member.',
              );

              await draw();
            } catch (error) {
              console.error(
                'Could not request changes to contribution:',
                error,
              );

              toast(
                `Could not request changes: ${errorMessage(error)}`,
                'err',
              );
            }
          },
        ),

        action(
          'Decline',

          async () => {
            const values =
              formValues(form);

            const reason =
              checkReason(
                textOf(
                  values,
                  'reason',
                ),
                'decline this contribution',
              );

            if (!reason) {
              return;
            }

            try {
              await decideContribution(
                row.id,
                'rejected',
                reason,

                textOf(
                  values,
                  'internal',
                ) || null,
              );

              modal.close();

              toast(
                'Declined.',
              );

              await draw();
            } catch (error) {
              console.error(
                'Could not decline contribution:',
                error,
              );

              toast(
                `Could not decline contribution: ${errorMessage(error)}`,
                'err',
              );
            }
          },

          'danger',
        ),
      ),
    );
  }

  async function draw(): Promise<void> {
    render(
      content,
      loading(),
    );

    try {
      const selected =
        FILTERS[filter];

      if (!selected) {
        throw new Error(
          'Invalid contribution filter.',
        );
      }

      const rows =
        await reviewQueue(
          selected[1],
        );

      render(
        content,

        pageHeader(
          'ADMIN / CONTRIBUTIONS',
          'Contribution review',
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
                    'btn-ghost',

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

        attentionLegend(
          ['now', 'Waiting 14 days or more'],
          ['review', 'Waiting on verification'],
          ['ok', 'Decided'],
        ),

        panel(
          `${rows.length} in this queue`,

          rows.length
            ? dataTable(
              [
                'Member',
                'Contribution',
                'Type',
                'Project',
                'Date',
                'Status',
                '',
              ],

              rows.map(
                (row) => [
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
                    'div',
                    {},

                    h(
                      'strong',
                      row.title,
                    ),

                    row.description
                      ? h(
                        'p',
                        {
                          class:
                            'mono-meta dim-text',
                        },

                        row.description.slice(
                          0,
                          120,
                        ),
                      )
                      : null,
                  ),

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    enumLabel(
                      row.type_slug,
                    ),
                  ),

                  row.project_id
                    ? projectTitle.get(
                      row.project_id,
                    ) ?? '—'
                    : '—',

                  h(
                    'span',
                    {
                      class:
                        'mono-meta',
                    },
                    archiveDate(
                      row.occurred_on,
                    ),
                  ),

                  statusPill(
                    row.status,
                  ),

                  h(
                    'button',
                    {
                      type: 'button',
                      class:
                        'link-button',

                      onclick:
                        () =>
                          void review(
                            row,
                          ),
                    },
                    'REVIEW',
                  ),
                ],
              ),

              {
                rowClass: (index) => {
                  const row = rows[index];
                  if (!row) return '';
                  return attentionRow(
                    row.status === 'submitted'
                      ? ageAttention(row.created_at).level
                      : 'ok',
                  );
                },
              },
            )
            : emptyState(
              'This queue is clear.',
            ),
        ),

        notice(
          'info',
          'Verifying a contribution puts it on the member’s permanent ACM record. ' +
          'Correct the wording rather than declining work that genuinely happened.',
        ),
      );
    } catch (error) {
      console.error(
        'Contribution review page failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'ADMIN / CONTRIBUTIONS',
          'Contribution review unavailable',
        ),

        notice(
          'err',
          `The contribution review queue could not load: ${errorMessage(error)}`,
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