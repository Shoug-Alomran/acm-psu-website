/**
 * Member contributions.
 *
 * A member describes work they did; an admin verifies it. Approved rows stop
 * being editable here — not because the page hides the button, but because the
 * row no longer matches the member's UPDATE policy in the database.
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
  notice,
  toast,
  action,
  emptyState,
} from '../lib/ui.js';

import {
  requireMember,
  canSubmit,
} from '../lib/session.js';

import {
  myContributions,
  contributionTypes,
  projects,
  saveContribution,
  uploadPrivate,
} from '../lib/api.js';

import {
  requireClient,
} from '../lib/supabase.js';

import {
  archiveDate,
  enumLabel,
} from '../lib/format.js';

import type {
  Contribution,
  ContributionType,
  Project,
} from '../lib/types.js';

const MAX_EVIDENCE_BYTES =
  10 * 1024 * 1024;

const ALLOWED_EVIDENCE_EXTENSIONS =
  new Set([
    'pdf',
    'png',
    'jpg',
    'jpeg',
    'webp',
    'txt',
    'zip',
  ]);

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

function cleanLinks(
  raw: string,
): string[] {
  return raw
    .split('\n')
    .map(
      (line) =>
        line.trim(),
    )
    .filter(Boolean)
    .slice(
      0,
      10,
    );
}

function fileExtension(
  fileName: string,
): string {
  const last =
    fileName
      .split('.')
      .pop();

  return (
    last ??
    ''
  ).toLowerCase();
}

async function start(): Promise<void> {
  const viewer =
    await requireMember();

  const content =
    shell(
      viewer,
      'member',
      'Contributions',
    );

  render(
    content,
    loading(),
  );

  let types:
    ContributionType[] =
    [];

  let projectList:
    Project[] =
    [];

  try {
    [
      types,
      projectList,
    ] =
      await Promise.all([
        contributionTypes(),
        projects(),
      ]);
  } catch (error) {
    console.error(
      'Could not load contribution metadata:',
      error,
    );

    render(
      content,

      pageHeader(
        'MEMBER / CONTRIBUTIONS',
        'Contributions unavailable',
      ),

      notice(
        'err',
        `Could not load contribution options: ${errorMessage(error)}`,
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

  const projectTitle =
    new Map(
      projectList.map(
        (
          project:
            Project,
        ) => [
            project.id,
            project.title,
          ],
      ),
    );

  function editor(
    existing:
      Contribution |
      null,
  ): void {
    const status =
      h(
        'div',
      );

    const fileInput =
      h(
        'input',
        {
          type:
            'file',

          accept:
            '.pdf,.png,.jpg,.jpeg,.webp,.txt,.zip',
        },
      ) as HTMLInputElement;

    const typeOptions =
      types.map(
        (
          type:
            ContributionType,
        ) => ({
          value:
            type.slug,
          label:
            type.label,
        }),
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
          'Title',
        name:
          'title',
        required:
          true,
        maxlength:
          200,
        value:
          existing?.title,
        placeholder:
          'e.g. Built the CTF 3.0 registration site',
      }),

      h(
        'div',
        {
          class:
            'field-pair',
        },

        field({
          label:
            'Type',
          name:
            'type_slug',
          type:
            'select',
          required:
            true,
          value:
            existing?.type_slug ??
            '',

          options: [
            {
              value:
                '',
              label:
                'Select…',
            },

            ...typeOptions,
          ],
        }),

        field({
          label:
            'Related project or event',
          name:
            'project_id',
          type:
            'select',
          value:
            existing?.project_id ??
            '',

          options: [
            {
              value:
                '',
              label:
                '— none —',
            },

            ...projectList.map(
              (
                project:
                  Project,
              ) => ({
                value:
                  project.id,
                label:
                  project.title,
              }),
            ),
          ],
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
            'Your role',
          name:
            'role_text',
          maxlength:
            120,
          value:
            existing?.role_text,
          placeholder:
            'e.g. Lead developer',
        }),

        field({
          label:
            'Date',
          name:
            'occurred_on',
          type:
            'date',
          value:
            existing?.occurred_on,
        }),
      ),

      field({
        label:
          'What did you do?',
        name:
          'description',
        type:
          'textarea',
        rows:
          5,
        value:
          existing?.description,
        hint:
          'Enough detail for a reviewer to recognise the work.',
      }),

      field({
        label:
          'Links',
        name:
          'links',
        type:
          'textarea',
        rows:
          2,

        value:
          existing?.links
            .join(
              '\n',
            ),

        hint:
          'One per line. Repository, live page, slides — whatever applies.',
      }),

      field({
        label:
          'Note for the reviewer',
        name:
          'member_note',
        type:
          'textarea',
        rows:
          2,
        value:
          existing?.member_note,
        hint:
          'Optional.',
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
          'EVIDENCE (OPTIONAL)',
        ),

        h(
          'p',
          {
            class:
              'field-hint mono-meta dim-text',
          },
          'A file that shows the work. Stored privately — only you and reviewers can open it.',
        ),

        fileInput,

        h(
          'p',
          {
            class:
              'field-hint mono-meta dim-text',
          },
          'PDF, PNG, JPG, WEBP, TXT or ZIP. Maximum 10 MB.',
        ),
      ),

      status,
    ) as HTMLFormElement;

    const modal =
      dialog(
        existing
          ? 'Edit contribution'
          : 'Submit a contribution',

        form,

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            existing
              ? 'Save changes'
              : 'Submit for verification',

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

              const title =
                textOf(
                  values,
                  'title',
                ).trim();

              const typeSlug =
                textOf(
                  values,
                  'type_slug',
                );

              if (!title) {
                status.replaceChildren(
                  notice(
                    'err',
                    'Enter a contribution title.',
                  ),
                );

                return;
              }

              if (!typeSlug) {
                status.replaceChildren(
                  notice(
                    'err',
                    'Choose a contribution type.',
                  ),
                );

                return;
              }

              const file =
                fileInput
                  .files?.[0] ??
                null;

              if (file) {
                const extension =
                  fileExtension(
                    file.name,
                  );

                if (
                  !ALLOWED_EVIDENCE_EXTENSIONS.has(
                    extension,
                  )
                ) {
                  status.replaceChildren(
                    notice(
                      'err',
                      'Evidence must be a PDF, PNG, JPG, WEBP, TXT or ZIP file.',
                    ),
                  );

                  return;
                }

                if (
                  file.size >
                  MAX_EVIDENCE_BYTES
                ) {
                  status.replaceChildren(
                    notice(
                      'err',
                      'Evidence files must be 10 MB or smaller.',
                    ),
                  );

                  return;
                }
              }

              status.replaceChildren(
                notice(
                  'info',
                  existing
                    ? 'SAVING…'
                    : 'SUBMITTING…',
                ),
              );

              try {
                const saved =
                  await saveContribution({
                    ...(
                      existing
                        ? {
                          id:
                            existing.id,
                        }
                        : {}
                    ),

                    user_id:
                      viewer.userId,

                    title,

                    type_slug:
                      typeSlug,

                    project_id:
                      textOf(
                        values,
                        'project_id',
                      ) ||
                      null,

                    role_text:
                      textOf(
                        values,
                        'role_text',
                      ).trim() ||
                      null,

                    description:
                      textOf(
                        values,
                        'description',
                      ).trim() ||
                      null,

                    occurred_on:
                      textOf(
                        values,
                        'occurred_on',
                      ) ||
                      null,

                    links:
                      cleanLinks(
                        textOf(
                          values,
                          'links',
                        ),
                      ),

                    member_note:
                      textOf(
                        values,
                        'member_note',
                      ).trim() ||
                      null,

                    status:
                      'submitted',
                  });

                if (file) {
                  try {
                    const upload =
                      await uploadPrivate(
                        'evidence',
                        viewer.userId,
                        file,
                      );

                    const {
                      error,
                    } =
                      await requireClient()
                        .from(
                          'contribution_evidence',
                        )
                        .insert({
                          contribution_id:
                            saved.id,

                          storage_bucket:
                            upload.bucket,

                          storage_path:
                            upload.path,

                          file_name:
                            upload.fileName,

                          mime_type:
                            upload.mimeType,

                          size_bytes:
                            upload.size,
                        });

                    if (error) {
                      throw new Error(
                        error.message,
                      );
                    }
                  } catch (error) {
                    console.error(
                      'Contribution saved but evidence upload/record failed:',
                      error,
                    );

                    status.replaceChildren(
                      notice(
                        'warn',
                        `Your contribution was saved, but the evidence file could not be attached: ${errorMessage(error)}. You can close this window and edit the contribution again.`,
                      ),
                    );

                    return;
                  }
                }

                modal.close();

                toast(
                  existing
                    ? 'Contribution updated and sent for verification.'
                    : 'Sent for verification.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not save contribution:',
                  error,
                );

                status.replaceChildren(
                  notice(
                    'err',
                    `Could not save contribution: ${errorMessage(error)}`,
                  ),
                );
              }
            },

            'primary',
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
      const rows =
        await myContributions(
          viewer.userId,
        );

      const editable =
        (
          contribution:
            Contribution,
        ): boolean =>
          [
            'draft',
            'submitted',
            'changes_requested',
          ].includes(
            contribution.status,
          );

      render(
        content,

        pageHeader(
          'MEMBER / CONTRIBUTIONS',
          'Contributions',

          canSubmit(
            viewer,
          )
            ? h(
              'button',
              {
                type:
                  'button',
                class:
                  'btn-submit',

                style: {
                  marginTop:
                    '0',
                },

                onclick:
                  () =>
                    editor(
                      null,
                    ),
              },
              'Submit a contribution',
            )
            : null,
        ),

        notice(
          'info',
          'Describe work you did for the club. An admin reviews it, and once approved it ' +
          'becomes a verified item on your ACM record.',
        ),

        panel(
          'Your submissions',

          rows.length
            ? dataTable(
              [
                'Title',
                'Type',
                'Project',
                'Date',
                'Status',
                '',
              ],

              rows.map(
                (
                  contribution,
                ) => [
                    h(
                      'div',
                      {},

                      h(
                        'strong',
                        contribution.title,
                      ),

                      contribution.review_note
                        ? h(
                          'p',
                          {
                            class:
                              'mono-meta dim-text',
                          },
                          `REVIEWER: ${contribution.review_note}`,
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
                        contribution.type_slug,
                      ),
                    ),

                    contribution.project_id
                      ? projectTitle.get(
                        contribution.project_id,
                      ) ??
                      '—'
                      : '—',

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      archiveDate(
                        contribution.occurred_on,
                      ),
                    ),

                    statusPill(
                      contribution.status,
                    ),

                    editable(
                      contribution,
                    )
                      ? h(
                        'button',
                        {
                          type:
                            'button',
                          class:
                            'link-button',

                          onclick:
                            () =>
                              editor(
                                contribution,
                              ),
                        },
                        'EDIT',
                      )
                      : h(
                        'span',
                        {
                          class:
                            'mono-meta dim-text',
                        },
                        'LOCKED',
                      ),
                  ],
              ),
            )
            : emptyState(
              'Nothing submitted yet.',
              'Organised an event? Built something? Ran a workshop? It belongs here.',
            ),
        ),

        panel(
          'What counts',

          h(
            'p',
            'Anything you did that helped the club run. Some examples:',
          ),

          h(
            'div',
            {
              class:
                'interest-picker',
            },

            types.map(
              (
                type:
                  ContributionType,
              ) =>
                h(
                  'span',
                  {
                    class:
                      'tag',

                    style: {
                      marginRight:
                        '0.4rem',
                    },
                  },
                  type.label,
                ),
            ),
          ),
        ),
      );
    } catch (error) {
      console.error(
        'Contributions page failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'MEMBER / CONTRIBUTIONS',
          'Contributions unavailable',
        ),

        notice(
          'err',
          `Your contributions could not load: ${errorMessage(error)}`,
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