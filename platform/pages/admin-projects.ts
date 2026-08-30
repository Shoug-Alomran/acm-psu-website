/**
 * Projects and events, and the archive workspace attached to each one.
 *
 * One table backs both. The workspace is deliberately partial by design:
 * a project uses the sections it actually has, and nothing forces an event
 * to invent a folder or section it never produced.
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
  metaList,
  confirmDialog,
  reasonField,
  checkReason,
} from '../lib/ui.js';

import {
  historyPanel,
} from '../lib/history.js';

import {
  requireAdmin,
} from '../lib/session.js';

import {
  projects,
  archiveFolders,
  archiveItems,
  itemUrl,
  setting,
  bestEffortFunctionSync,
} from '../lib/api.js';

import {
  requireClient,
} from '../lib/supabase.js';

import {
  members,
  setArchiveVisibility,
} from '../lib/admin.js';

import {
  archiveDate,
  enumLabel,
  fileSize,
} from '../lib/format.js';

import type {
  ArchiveFolder,
  ArchiveItem,
  Project,
} from '../lib/types.js';

const KINDS = [
  'event',
  'project',
  'workshop_series',
  'initiative',
].map((value) => ({
  value,
  label: enumLabel(value),
}));

const STATUSES = [
  'planning',
  'active',
  'completed',
  'archived',
].map((value) => ({
  value,
  label: enumLabel(value),
}));

const SECTIONS = [
  'overview',
  'files',
  'website',
  'workshops',
  'documents',
  'media',
  'branding',
  'results',
  'organizers',
].map((value) => ({
  value,
  label: enumLabel(value),
}));

interface OrganizerRow {
  id: string;
  project_id: string;
  user_id: string;
  role_text: string;
  member: {
    full_name: string;
    email: string;
  } | null;
}

interface OpeningRow {
  event_position_id: string;
  title: string;
  filled: number;
  openings: number;
  pending: number;
  closes_on: string | null;
  is_open: boolean;
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

function slugify(
  text: string,
): string {
  return text
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      '-',
    )
    .replace(
      /^-|-$/g,
      '',
    )
    .slice(
      0,
      60,
    );
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
      'Projects & events',
    );

  render(
    content,
    loading(),
  );

  let chapter =
    String(
      new Date().getFullYear(),
    );

  try {
    chapter =
      await setting<string>(
        'current_chapter_year',
        chapter,
      );
  } catch (error) {
    console.error(
      'Could not load current chapter year:',
      error,
    );
  }

  let selectedId =
    new URLSearchParams(
      window.location.search,
    ).get(
      'project',
    );

  /* ------------------------------------------------------------ project form */

  function projectEditor(
    existing: Project | null,
  ): void {
    const form = h(
      'form',
      {
        class: 'portal-form',
        novalidate: true,
      },

      field({
        label: 'Title',
        name: 'title',
        required: true,
        maxlength: 140,
        value:
          existing?.title,
      }),

      h(
        'div',
        {
          class: 'field-pair',
        },

        field({
          label: 'Kind',
          name: 'kind',
          type: 'select',
          value:
            existing?.kind ??
            'event',
          options:
            KINDS,
        }),

        field({
          label: 'Status',
          name: 'status',
          type: 'select',
          value:
            existing?.status ??
            'planning',
          options:
            STATUSES,
        }),
      ),

      h(
        'div',
        {
          class: 'field-pair',
        },

        field({
          label: 'Starts',
          name: 'starts_on',
          type: 'date',
          value:
            existing?.starts_on,
        }),

        field({
          label: 'Ends',
          name: 'ends_on',
          type: 'date',
          value:
            existing?.ends_on,
        }),
      ),

      h(
        'div',
        {
          class: 'field-pair',
        },

        field({
          label: 'Chapter year',
          name: 'chapter_year',
          value:
            existing?.chapter_year ??
            chapter,
        }),

        field({
          label: 'Filter category',
          name: 'category',
          value:
            existing?.category,
          hint:
            'Matches the public projects page tabs, e.g. ctf, jam, workshops.',
        }),
      ),

      field({
        label: 'Summary',
        name: 'summary',
        type: 'textarea',
        rows: 2,
        value:
          existing?.summary,
      }),

      h(
        'div',
        {
          class: 'field-pair',
        },

        field({
          label: 'Page on the website',
          name: 'site_path',
          value:
            existing?.site_path,
          placeholder:
            '/projects/ctfs/ctf-3.0/',
        }),

        field({
          label: 'Repository',
          name: 'repo_url',
          type: 'url',
          value:
            existing?.repo_url,
        }),
      ),

      field({
        label: 'Visibility',
        name: 'visibility',
        type: 'select',
        value:
          existing?.visibility ??
          'internal',

        options: [
          {
            value: 'internal',
            label:
              'Internal — members and admins',
          },
          {
            value: 'public',
            label:
              'Public — anyone',
          },
        ],
      }),
    ) as HTMLFormElement;

    const modal =
      dialog(
        existing
          ? `Edit — ${existing.title}`
          : 'New project or event',

        form,

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            existing
              ? 'Save'
              : 'Create',

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

              if (!title) {
                toast(
                  'Enter a title.',
                  'err',
                );

                return;
              }

              const startsOn =
                textOf(
                  values,
                  'starts_on',
                ) || null;

              const endsOn =
                textOf(
                  values,
                  'ends_on',
                ) || null;

              if (
                startsOn &&
                endsOn &&
                endsOn < startsOn
              ) {
                toast(
                  'The end date cannot be before the start date.',
                  'err',
                );

                return;
              }

              const patch = {
                title,

                kind:
                  textOf(
                    values,
                    'kind',
                  ),

                status:
                  textOf(
                    values,
                    'status',
                  ),

                starts_on:
                  startsOn,

                ends_on:
                  endsOn,

                chapter_year:
                  textOf(
                    values,
                    'chapter_year',
                  ) ||
                  null,

                category:
                  textOf(
                    values,
                    'category',
                  ) ||
                  null,

                summary:
                  textOf(
                    values,
                    'summary',
                  ) ||
                  null,

                site_path:
                  textOf(
                    values,
                    'site_path',
                  ) ||
                  null,

                repo_url:
                  textOf(
                    values,
                    'repo_url',
                  ) ||
                  null,

                visibility:
                  textOf(
                    values,
                    'visibility',
                  ),
              };

              try {
                const client =
                  requireClient();

                if (existing) {
                  const {
                    error,
                  } = await client
                    .from(
                      'projects',
                    )
                    .update(
                      patch,
                    )
                    .eq(
                      'id',
                      existing.id,
                    );

                  if (error) {
                    throw new Error(
                      error.message,
                    );
                  }
                } else {
                  const slug =
                    slugify(
                      title,
                    );

                  if (!slug) {
                    toast(
                      'The title must contain at least one letter or number.',
                      'err',
                    );

                    return;
                  }

                  const {
                    data,
                    error,
                  } = await client
                    .from(
                      'projects',
                    )
                    .insert({
                      ...patch,
                      slug,
                      created_by:
                        viewer.userId,
                    })
                    .select(
                      'id',
                    )
                    .single();

                  if (error) {
                    throw new Error(
                      error.message,
                    );
                  }

                  selectedId =
                    data.id;

                  history.replaceState(
                    null,
                    '',
                    `?project=${data.id}`,
                  );
                }

                modal.close();

                toast(
                  existing
                    ? 'Project updated.'
                    : 'Project created.',
                );

                await draw();
              } catch (error) {
                console.error(
                  existing
                    ? 'Could not update project:'
                    : 'Could not create project:',
                  error,
                );

                toast(
                  existing
                    ? `Could not update project: ${errorMessage(error)}`
                    : `Could not create project: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'primary',
          ),
        ),
      );
  }

  /* --------------------------------------------------------- opportunities */

  function opportunityEditor(
    project: Project,
  ): void {
    const form = h(
      'form',
      {
        class: 'portal-form',
        novalidate: true,
      },

      field({
        label: 'Role title',
        name: 'title',
        required: true,
        maxlength: 80,
        placeholder:
          'e.g. Workshop Assistant',
      }),

      h(
        'div',
        {
          class: 'field-pair',
        },

        field({
          label: 'Openings',
          name: 'openings',
          type: 'number',
          required: true,
          value: '1',
        }),

        field({
          label: 'Closes on',
          name: 'closes_on',
          type: 'date',
        }),
      ),

      field({
        label:
          'What the role involves',
        name: 'description',
        type: 'textarea',
        rows: 3,
        hint:
          'Say what someone would actually do. Do not list prerequisites that would put a beginner off.',
      }),
    ) as HTMLFormElement;

    const modal =
      dialog(
        `New opening — ${project.title}`,

        form,

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            'Create opening',

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

              try {
                const {
                  error,
                } =
                  await requireClient()
                    .from(
                      'event_positions',
                    )
                    .insert({
                      project_id:
                        project.id,

                      title:
                        textOf(
                          values,
                          'title',
                        ).trim(),

                      openings:
                        Math.max(
                          1,
                          Number(
                            textOf(
                              values,
                              'openings',
                            ),
                          ) ||
                          1,
                        ),

                      closes_on:
                        textOf(
                          values,
                          'closes_on',
                        ) ||
                        null,

                      description:
                        textOf(
                          values,
                          'description',
                        ) ||
                        null,

                      created_by:
                        viewer.userId,
                    });

                if (error) {
                  throw new Error(
                    error.message,
                  );
                }

                modal.close();

                toast(
                  'Opening published to members.',
                );

                void bestEffortFunctionSync(
                  'club-records-sheet-sync',
                  { sheets: ['opportunity_positions'] },
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not create event opening:',
                  error,
                );

                toast(
                  `Could not create opening: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'primary',
          ),
        ),
      );
  }

  /* ---------------------------------------------------------------- folders */

  function folderEditor(
    project: Project,
    folders: ArchiveFolder[],
  ): void {
    const form = h(
      'form',
      {
        class: 'portal-form',
        novalidate: true,
      },

      field({
        label: 'Folder name',
        name: 'name',
        required: true,
        maxlength: 80,
      }),

      h(
        'div',
        {
          class: 'field-pair',
        },

        field({
          label: 'Section',
          name: 'section',
          type: 'select',
          value: 'files',
          options:
            SECTIONS,
        }),

        field({
          label: 'Inside',
          name: 'parent_id',
          type: 'select',

          options: [
            {
              value: '',
              label:
                '— top level —',
            },

            ...folders.map(
              (folder) => ({
                value:
                  folder.id,
                label:
                  folder.name,
              }),
            ),
          ],
        }),
      ),

      field({
        label: 'Description',
        name: 'description',
        type: 'textarea',
        rows: 2,
      }),

      field({
        label: 'Visibility',
        name: 'visibility',
        type: 'select',
        value: 'internal',

        options: [
          {
            value: 'internal',
            label: 'Internal',
          },
          {
            value: 'public',
            label: 'Public',
          },
        ],
      }),
    ) as HTMLFormElement;

    const modal =
      dialog(
        `New folder — ${project.title}`,

        form,

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            'Create folder',

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

              const name =
                textOf(
                  values,
                  'name',
                ).trim();

              const slug =
                slugify(
                  name,
                );

              if (!slug) {
                toast(
                  'The folder name must contain at least one letter or number.',
                  'err',
                );

                return;
              }

              try {
                const {
                  error,
                } =
                  await requireClient()
                    .from(
                      'archive_folders',
                    )
                    .insert({
                      project_id:
                        project.id,

                      parent_id:
                        textOf(
                          values,
                          'parent_id',
                        ) ||
                        null,

                      name,
                      slug,

                      section:
                        textOf(
                          values,
                          'section',
                        ),

                      description:
                        textOf(
                          values,
                          'description',
                        ) ||
                        null,

                      visibility:
                        textOf(
                          values,
                          'visibility',
                        ),

                      created_by:
                        viewer.userId,
                    });

                if (error) {
                  throw new Error(
                    error.message,
                  );
                }

                modal.close();

                toast(
                  'Folder created.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not create archive folder:',
                  error,
                );

                toast(
                  `Could not create folder: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'primary',
          ),
        ),
      );
  }

  /* ------------------------------------------------------------- organizers */

  async function organizerEditor(
    project: Project,
  ): Promise<void> {
    let memberList;

    try {
      memberList =
        await members(
          '',
          '',
        );
    } catch (error) {
      console.error(
        'Could not load members for organizer picker:',
        error,
      );

      toast(
        `Could not load members: ${errorMessage(error)}`,
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
        label: 'Person',
        name: 'user_id',
        type: 'select',
        required: true,

        options: [
          {
            value: '',
            label: 'Select…',
          },

          ...memberList.map(
            (member) => ({
              value:
                member.id,

              label:
                `${member.full_name} — ${member.email}`,
            }),
          ),
        ],
      }),

      field({
        label:
          'Role on this project',
        name: 'role_text',
        value: 'Organizer',
        maxlength: 80,
      }),
    ) as HTMLFormElement;

    const modal =
      dialog(
        `Add organiser — ${project.title}`,

        form,

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            'Add',

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

              try {
                const {
                  error,
                } =
                  await requireClient()
                    .from(
                      'project_organizers',
                    )
                    .insert({
                      project_id:
                        project.id,

                      user_id:
                        textOf(
                          values,
                          'user_id',
                        ),

                      role_text:
                        textOf(
                          values,
                          'role_text',
                        ) ||
                        'Organizer',

                      added_by:
                        viewer.userId,
                    });

                if (error) {
                  throw new Error(
                    error.message,
                  );
                }

                modal.close();

                toast(
                  'Organiser added.',
                );

                void bestEffortFunctionSync(
                  'club-records-sheet-sync',
                  { sheets: ['people', 'opportunity_positions'] },
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not add project organizer:',
                  error,
                );

                toast(
                  `Could not add organiser: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            'primary',
          ),
        ),
      );
  }

  /* -------------------------------------------------- archive visibility */

  function visibilityDialog(
    item: ArchiveItem,
  ): void {
    const next:
      'public' |
      'internal' =
      item.visibility ===
        'public'
        ? 'internal'
        : 'public';

    const form = h(
      'form',
      {
        class: 'portal-form',
      },

      notice(
        next === 'public'
          ? 'warn'
          : 'info',

        next === 'public'
          ? 'This will make the item visible to anyone on the website. Check it first for student IDs, grades or participant names.'
          : 'This removes the item from the public website. It stays in the archive for members and admins.',
      ),

      reasonField({
        label:
          `Why is this being made ${next}?`,

        hint:
          'Required. Changing what the public can see is recorded permanently.',
      }),
    ) as HTMLFormElement;

    const modal =
      dialog(
        `Make "${item.name}" ${next}`,

        form,

        h(
          'div',
          {
            class:
              'button-row',
          },

          action(
            `Make ${next}`,

            async () => {
              const reason =
                checkReason(
                  textOf(
                    formValues(
                      form,
                    ),
                    'reason',
                  ),

                  `make this ${next}`,
                );

              if (!reason) {
                return;
              }

              if (
                next === 'public' &&
                item.storage_path &&
                item.storage_bucket !==
                'public-archive'
              ) {
                toast(
                  'This item’s file is in private storage. Republish it from Archive Review so the file moves with it.',
                  'err',
                );

                return;
              }

              try {
                await setArchiveVisibility(
                  item.id,
                  next,
                  reason,
                );

                modal.close();

                toast(
                  'Visibility updated.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not update archive visibility:',
                  error,
                );

                toast(
                  `Could not update visibility: ${errorMessage(error)}`,
                  'err',
                );
              }
            },

            next === 'public'
              ? 'primary'
              : 'ghost',
          ),
        ),
      );
  }

  /* ----------------------------------------------------------------- render */

  async function draw(): Promise<void> {
    render(
      content,
      loading(),
    );

    try {
      const list =
        await projects();

      const selected =
        list.find(
          (project) =>
            project.id ===
            selectedId,
        ) ??
        null;

      const detail:
        HTMLElement[] =
        [];

      if (selected) {
        const [
          folders,
          items,
          organizersResult,
          openingsResult,
        ] =
          await Promise.all([
            archiveFolders(
              selected.id,
            ),

            archiveItems({
              projectId:
                selected.id,
            }),

            requireClient()
              .from(
                'project_organizers',
              )
              .select(`
                id,
                project_id,
                user_id,
                role_text,
                member:app_users!project_organizers_user_id_fkey(
                  full_name,
                  email
                )
              `)
              .eq(
                'project_id',
                selected.id,
              ),

            requireClient()
              .from(
                'event_position_availability',
              )
              .select(
                '*',
              )
              .eq(
                'project_id',
                selected.id,
              ),
          ]);

        if (
          organizersResult.error
        ) {
          throw new Error(
            organizersResult
              .error
              .message,
          );
        }

        if (
          openingsResult.error
        ) {
          throw new Error(
            openingsResult
              .error
              .message,
          );
        }

        const organizers =
          (
            organizersResult.data ??
            []
          ) as unknown as OrganizerRow[];

        const openings =
          (
            openingsResult.data ??
            []
          ) as unknown as OpeningRow[];

        const folderName =
          new Map(
            folders.map(
              (
                folder:
                  ArchiveFolder,
              ) => [
                  folder.id,
                  folder.name,
                ],
            ),
          );

        detail.push(
          panel(
            selected.title,

            metaList([
              [
                'Kind',
                enumLabel(
                  selected.kind,
                ),
              ],

              [
                'Status',
                statusPill(
                  selected.status,
                ),
              ],

              [
                'Visibility',
                statusPill(
                  selected.visibility ===
                    'public'
                    ? 'active'
                    : 'inactive',
                ),
              ],

              [
                'Runs',
                `${archiveDate(selected.starts_on)} — ${archiveDate(selected.ends_on)}`,
              ],

              [
                'Chapter',
                selected.chapter_year ??
                '—',
              ],

              [
                'Website page',
                selected.site_path ??
                '—',
              ],

              [
                'Repository',
                selected.repo_url
                  ? h(
                    'a',
                    {
                      href:
                        selected.repo_url,
                      rel:
                        'noopener',
                      target:
                        '_blank',
                    },
                    selected.repo_url,
                  )
                  : '—',
              ],
            ]),

            selected.summary
              ? h(
                'p',
                selected.summary,
              )
              : null,

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
                      projectEditor(
                        selected,
                      ),
                },
                'Edit project',
              ),

              h(
                'button',
                {
                  type: 'button',
                  class:
                    'btn-ghost',

                  onclick:
                    () =>
                      opportunityEditor(
                        selected,
                      ),
                },
                'New opening',
              ),

              h(
                'button',
                {
                  type: 'button',
                  class:
                    'btn-ghost',

                  onclick:
                    () =>
                      folderEditor(
                        selected,
                        folders,
                      ),
                },
                'New folder',
              ),

              h(
                'button',
                {
                  type: 'button',
                  class:
                    'btn-ghost',

                  onclick:
                    () =>
                      void organizerEditor(
                        selected,
                      ),
                },
                'Add organiser',
              ),
            ),
          ),

          panel(
            'Open positions',

            dataTable(
              [
                'Role',
                'Filled',
                'Pending',
                'Closes',
                '',
              ],

              openings.map(
                (
                  opening,
                ) => [
                    opening.title,

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      `${opening.filled} / ${opening.openings}`,
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      String(
                        opening.pending,
                      ),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      opening.closes_on
                        ? archiveDate(
                          opening.closes_on,
                        )
                        : '—',
                    ),

                    action(
                      opening.is_open
                        ? 'CLOSE'
                        : 'REOPEN',

                      async () => {
                        try {
                          const {
                            error,
                          } =
                            await requireClient()
                              .from(
                                'event_positions',
                              )
                              .update({
                                is_open:
                                  !opening.is_open,
                              })
                              .eq(
                                'id',
                                opening.event_position_id,
                              );

                          if (error) {
                            throw new Error(
                              error.message,
                            );
                          }

                          toast(
                            opening.is_open
                              ? 'Opening closed.'
                              : 'Opening reopened.',
                          );

                          void bestEffortFunctionSync(
                            'club-records-sheet-sync',
                            { sheets: ['opportunity_positions'] },
                          );

                          await draw();
                        } catch (error) {
                          console.error(
                            'Could not change opening state:',
                            error,
                          );

                          toast(
                            `Could not update opening: ${errorMessage(error)}`,
                            'err',
                          );
                        }
                      },
                    ),
                  ],
              ),

              {
                empty:
                  'No openings on this project. Create one to make the work visible to members.',
              },
            ),
          ),

          panel(
            'Organisers',

            dataTable(
              [
                'Member',
                'Role',
                '',
              ],

              organizers.map(
                (
                  row,
                ) => [
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

                    row.role_text,

                    action(
                      'REMOVE',

                      async () => {
                        const confirmed =
                          await confirmDialog(
                            'Remove organiser',
                            'Remove them from this project’s organiser list?',
                            'Remove',
                          );

                        if (
                          !confirmed
                        ) {
                          return;
                        }

                        try {
                          const {
                            error,
                          } =
                            await requireClient()
                              .from(
                                'project_organizers',
                              )
                              .delete()
                              .eq(
                                'id',
                                row.id,
                              );

                          if (error) {
                            throw new Error(
                              error.message,
                            );
                          }

                          toast(
                            'Organiser removed.',
                          );

                          void bestEffortFunctionSync(
                            'club-records-sheet-sync',
                            { sheets: ['people', 'opportunity_positions'] },
                          );

                          await draw();
                        } catch (error) {
                          console.error(
                            'Could not remove organizer:',
                            error,
                          );

                          toast(
                            `Could not remove organiser: ${errorMessage(error)}`,
                            'err',
                          );
                        }
                      },

                      'danger',
                    ),
                  ],
              ),

              {
                empty:
                  'No organisers recorded yet.',
              },
            ),
          ),

          panel(
            `Archive — ${items.length} item${items.length === 1 ? '' : 's'}`,

            folders.length
              ? h(
                'p',
                {
                  class:
                    'mono-meta dim-text',
                },
                'FOLDERS: ' +
                folders
                  .map(
                    (
                      folder:
                        ArchiveFolder,
                    ) =>
                      folder.name,
                  )
                  .join(
                    ' · ',
                  ),
              )
              : null,

            dataTable(
              [
                'Item',
                'Folder',
                'Category',
                'Size',
                'Visibility',
                '',
              ],

              items.map(
                (
                  item:
                    ArchiveItem,
                ) => [
                    h(
                      'div',
                      {},

                      h(
                        'strong',
                        item.name,
                      ),

                      item.description
                        ? h(
                          'p',
                          {
                            class:
                              'mono-meta dim-text',
                          },
                          item.description.slice(
                            0,
                            110,
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
                      item.folder_id
                        ? folderName.get(
                          item.folder_id,
                        ) ??
                        '—'
                        : '—',
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      (
                        item.category ??
                        '—'
                      ).toUpperCase(),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      item.size_label ??
                      fileSize(
                        item.size_bytes,
                      ),
                    ),

                    statusPill(
                      item.visibility ===
                        'public'
                        ? 'active'
                        : 'inactive',
                    ),

                    h(
                      'div',
                      {
                        class:
                          'button-row',
                      },

                      action(
                        'OPEN',

                        async () => {
                          try {
                            const url =
                              await itemUrl(
                                item,
                              );

                            if (url) {
                              window.open(
                                url,
                                '_blank',
                                'noopener',
                              );

                              return;
                            }

                            toast(
                              'This item has no file or link on record.',
                              'err',
                            );
                          } catch (error) {
                            console.error(
                              'Could not open archive item:',
                              error,
                            );

                            toast(
                              `Could not open item: ${errorMessage(error)}`,
                              'err',
                            );
                          }
                        },
                      ),

                      h(
                        'button',
                        {
                          type: 'button',
                          class:
                            'btn-ghost',

                          onclick:
                            () =>
                              visibilityDialog(
                                item,
                              ),
                        },
                        item.visibility ===
                          'public'
                          ? 'MAKE INTERNAL'
                          : 'MAKE PUBLIC',
                      ),
                    ),
                  ],
              ),

              {
                empty:
                  'Nothing archived for this project yet.',
              },
            ),
          ),

          historyPanel(
            'project',
            selected.id,
          ),
        );
      }

      render(
        content,

        pageHeader(
          'ADMIN / PROJECTS',
          'Projects & events',

          h(
            'button',
            {
              type: 'button',
              class:
                'btn-submit',
              style: {
                marginTop: '0',
              },

              onclick:
                () =>
                  projectEditor(
                    null,
                  ),
            },
            'New project',
          ),
        ),

        notice(
          'info',
          'A project is the unit everything else hangs off: opportunities, participation, contributions and the archive all point at one. Create the project first.',
        ),

        panel(
          'All projects and events',

          list.length
            ? dataTable(
              [
                'Title',
                'Kind',
                'Status',
                'Chapter',
                'Runs',
                'Visibility',
                '',
              ],

              list.map(
                (
                  project,
                ) => [
                    h(
                      'strong',
                      project.title,
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      enumLabel(
                        project.kind,
                      ),
                    ),

                    statusPill(
                      project.status,
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      project.chapter_year ??
                      '—',
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      archiveDate(
                        project.starts_on,
                      ),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      project.visibility
                        .toUpperCase(),
                    ),

                    h(
                      'button',
                      {
                        type: 'button',
                        class:
                          'link-button',

                        onclick:
                          () => {
                            selectedId =
                              project.id;

                            history.replaceState(
                              null,
                              '',
                              `?project=${project.id}`,
                            );

                            void draw();
                          },
                      },
                      selectedId ===
                        project.id
                        ? 'OPEN'
                        : 'MANAGE',
                    ),
                  ],
              ),
            )
            : emptyState(
              'No projects yet.',
              'Create one to start an archive workspace.',
            ),
        ),

        ...detail,
      );
    } catch (error) {
      console.error(
        'Projects page failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'ADMIN / PROJECTS',
          'Projects unavailable',
        ),

        notice(
          'err',
          `The projects workspace could not load: ${errorMessage(error)}`,
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
