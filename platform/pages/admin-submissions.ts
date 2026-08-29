/**
 * Archive submission review.
 *
 * The Cloudflare Workers AI assistant is advisory only.
 * It can summarize, classify, flag and recommend metadata, but it cannot:
 * - approve
 * - reject
 * - publish
 * - change visibility
 * - change administrative roles
 *
 * Human administrators remain responsible for every archive decision.
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
  isClubAdmin,
} from '../lib/session.js';

import {
  publishSubmission,
  decideSubmission,
} from '../lib/admin.js';

import {
  submissionQueue,
  archiveCategories,
  archiveFolders,
  projects,
  signedUrl,
  setting,
} from '../lib/api.js';

import {
  requireClient,
} from '../lib/supabase.js';

import {
  archiveDate,
  fileSize,
} from '../lib/format.js';

import type {
  ArchiveCategory,
  ArchiveFolder,
  ContentVisibility,
  Project,
  ReviewStatus,
} from '../lib/types.js';

const AI_REVIEW_URL =
  'https://acm-psu-ai-review.shoug-alomran.workers.dev';

type ConfidenceLevel =
  | 'low'
  | 'medium'
  | 'high'
  | 'very_high';

interface AiConfidence {
  score: number;
  level: ConfidenceLevel;
  reason: string;
}

interface AiSuggestedCategory {
  name: string | null;
  reason: string | null;
}

interface AiSuggestedProject {
  id: string | null;
  title: string | null;
  reason: string | null;
}

interface AiSuggestedVisibility {
  value: string | null;
  reason: string | null;
}

interface WorkerAiSuggestion {
  brief: string;

  confidence: AiConfidence;

  suggested_title: string | null;

  suggested_description: string | null;

  suggested_category:
  AiSuggestedCategory;

  suggested_project:
  AiSuggestedProject;

  suggested_tags: string[];

  suggested_visibility:
  AiSuggestedVisibility;

  sensitive_information:
  string[];

  duplicate_concerns:
  string[];

  missing_information:
  string[];

  warnings:
  string[];

  review_notes:
  string[];
}

interface WorkerAiResponse {
  ok: boolean;

  submission_id?: string;

  reviewer?: {
    user_id: string;
    role: string;
  };

  ai?: {
    model: string;
    advisory_only: boolean;
  };

  suggestion?:
  WorkerAiSuggestion;

  error?: string;
}

const FILTERS:
  Array<
    [
      string,
      ReviewStatus[],
    ]
  > = [
    [
      'Awaiting review',
      [
        'submitted',
      ],
    ],

    [
      'Changes requested',
      [
        'changes_requested',
      ],
    ],

    [
      'Published',
      [
        'approved',
      ],
    ],

    [
      'Declined',
      [
        'rejected',
      ],
    ],
  ];

const SECTIONS = [
  'overview',
  'files',
  'website',
  'workshops',
  'documents',
  'media',
  'branding',
  'results',
].map(
  (value) => ({
    value,
    label:
      value.toUpperCase(),
  }),
);

function errorMessage(
  error: unknown,
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error ===
    'object' &&
    error !== null &&
    'message' in error &&
    typeof (
      error as {
        message?: unknown;
      }
    ).message ===
    'string'
  ) {
    return (
      error as {
        message: string;
      }
    ).message;
  }

  return 'An unknown error occurred.';
}

function confidenceLabel(
  level: ConfidenceLevel,
): string {
  switch (level) {
    case 'very_high':
      return 'VERY HIGH';

    case 'high':
      return 'HIGH';

    case 'medium':
      return 'MEDIUM';

    default:
      return 'LOW';
  }
}

async function requestWorkerAiReview(
  submissionId: string,
): Promise<WorkerAiResponse> {
  const client =
    requireClient();

  const {
    data,
    error,
  } =
    await client.auth.getSession();

  if (error) {
    throw error;
  }

  if (
    !data.session
      ?.access_token
  ) {
    throw new Error(
      'You must be signed in to use AI review.',
    );
  }

  const response =
    await fetch(
      AI_REVIEW_URL,
      {
        method:
          'POST',

        headers: {
          Authorization:
            `Bearer ${data.session.access_token}`,

          'Content-Type':
            'application/json',
        },

        body:
          JSON.stringify({
            submission_id:
              submissionId,
          }),
      },
    );

  let payload:
    WorkerAiResponse;

  try {
    payload =
      await response.json() as
      WorkerAiResponse;
  } catch {
    throw new Error(
      `AI review returned an unreadable response (${response.status}).`,
    );
  }

  if (
    !response.ok ||
    !payload.ok
  ) {
    throw new Error(
      payload.error ??
      `AI review failed with status ${response.status}.`,
    );
  }

  return payload;
}

async function start(): Promise<void> {
  const viewer =
    await requireAdmin(
      'reviewer',
    );

  const content =
    shell(
      viewer,
      'admin',
      'Archive review',
    );

  render(
    content,
    loading(),
  );

  let categories:
    ArchiveCategory[] =
    [];

  let projectList:
    Project[] =
    [];

  let folders:
    ArchiveFolder[] =
    [];

  let aiEnabled =
    false;

  try {
    [
      categories,
      projectList,
      folders,
    ] =
      await Promise.all([
        archiveCategories(),
        projects(),
        archiveFolders(),
      ]);
  } catch (error) {
    console.error(
      'Could not load archive review metadata:',
      error,
    );

    render(
      content,

      pageHeader(
        'ADMIN / ARCHIVE',
        'Archive review unavailable',
      ),

      notice(
        'err',
        `Could not load archive configuration: ${errorMessage(error)}`,
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

  try {
    aiEnabled =
      await setting<boolean>(
        'ai_review_enabled',
        false,
      );
  } catch (error) {
    console.error(
      'Could not load AI review setting:',
      error,
    );

    aiEnabled =
      false;
  }

  let filter =
    0;

  async function review(
    row:
      Awaited<
        ReturnType<
          typeof submissionQueue
        >
      >[number],
  ): Promise<void> {
    const canPublish =
      isClubAdmin(
        viewer,
      );

    const acceptedSuggestions =
      new Set<string>();

    const form = h(
      'form',
      {
        class:
          'portal-form',
      },

      field({
        label:
          'Archive title',

        name:
          'title',

        value:
          row.title,

        maxlength:
          200,
      }),

      h(
        'div',
        {
          class:
            'field-pair',
        },

        field({
          label:
            'Category',

          name:
            'category',

          type:
            'select',

          value:
            row.category ??
            '',

          options: [
            {
              value:
                '',

              label:
                '— none —',
            },

            ...categories.map(
              (
                category:
                  ArchiveCategory,
              ) => ({
                value:
                  category.slug,

                label:
                  category.label,
              }),
            ),
          ],
        }),

        field({
          label:
            'Project',

          name:
            'project_id',

          type:
            'select',

          value:
            row.project_id ??
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
            'Folder',

          name:
            'folder_id',

          type:
            'select',

          value:
            row.folder_id ??
            '',

          options: [
            {
              value:
                '',

              label:
                '— project root —',
            },

            ...folders.map(
              (
                folder:
                  ArchiveFolder,
              ) => ({
                value:
                  folder.id,

                label:
                  folder.name,
              }),
            ),
          ],
        }),

        field({
          label:
            'Section',

          name:
            'section',

          type:
            'select',

          value:
            'files',

          options:
            SECTIONS,
        }),
      ),

      field({
        label:
          'Description',

        name:
          'description',

        type:
          'textarea',

        rows:
          4,

        value:
          row.description,
      }),

      field({
        label:
          'Visibility',

        name:
          'visibility',

        type:
          'select',

        value:
          row.suggested_visibility,

        options: [
          {
            value:
              'internal',

            label:
              'Internal — members and admins only',
          },

          {
            value:
              'public',

            label:
              'Public — anyone on the website',
          },
        ],

        hint:
          'Anything containing student IDs, grades or participant names stays internal.',
      }),

      reasonField({
        hint:
          'Required when declining, asking for changes, or publishing publicly something the member marked internal. Shown to them.',
      }),

      internalNoteField(),
    ) as HTMLFormElement;

    const setField =
      (
        name: string,
        value: string,
      ): void => {
        const input =
          form.querySelector<
            HTMLInputElement |
            HTMLSelectElement |
            HTMLTextAreaElement
          >(
            `[name="${name}"]`,
          );

        if (!input) {
          return;
        }

        input.value =
          value;

        input.style.borderColor =
          'var(--accent-blue)';
      };

    const aiHost =
      h(
        'div',
        {
          class:
            'ai-panel',
        },
      );

    function recommendation(
      label: string,
      value: string | null,
      target: string,
      reason?: string | null,
    ): HTMLElement | null {
      if (!value) {
        return null;
      }

      return h(
        'div',
        {
          class:
            'ai-suggestion',
        },

        h(
          'span',
          {
            class:
              'mono-meta dim-text',
          },
          label,
        ),

        h(
          'strong',
          value,
        ),

        reason
          ? h(
            'p',
            {
              class:
                'dim-text',
            },
            reason,
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
              type:
                'button',

              class:
                'btn-ghost',

              onclick:
                () => {
                  setField(
                    target,
                    value,
                  );

                  acceptedSuggestions.add(
                    target,
                  );

                  toast(
                    'Applied to the review form. You remain the deciding administrator.',
                  );
                },
            },
            'Accept',
          ),

          h(
            'button',
            {
              type:
                'button',

              class:
                'btn-ghost',

              onclick:
                () => {
                  setField(
                    target,
                    value,
                  );

                  acceptedSuggestions.add(
                    `${target}:edited`,
                  );

                  form.querySelector<
                    HTMLElement
                  >(
                    `[name="${target}"]`,
                  )?.focus();
                },
            },
            'Edit',
          ),

          h(
            'button',
            {
              type:
                'button',

              class:
                'btn-ghost',

              onclick:
                (
                  event:
                    Event,
                ) => {
                  (
                    event.currentTarget as
                    HTMLElement
                  )
                    .closest(
                      '.ai-suggestion',
                    )
                    ?.remove();
                },
            },
            'Ignore',
          ),
        ),
      );
    }

    function flagGroup(
      title: string,
      items: string[],
      severity:
        'info' |
        'warn' |
        'danger' =
        'warn',
    ): HTMLElement | null {
      if (
        !items.length
      ) {
        return null;
      }

      return h(
        'div',
        {
          class:
            'ai-suggestion',
        },

        h(
          'span',
          {
            class:
              'mono-meta dim-text',
          },
          title,
        ),

        h(
          'div',
          {},

          items.map(
            (
              item,
            ) =>
              h(
                'div',
                {
                  class:
                    `ai-flag ai-flag--${severity}`,
                },

                h(
                  'span',
                  item,
                ),
              ),
          ),
        ),
      );
    }

    function drawAi(
      result:
        WorkerAiResponse |
        null,

      failure:
        string |
        null,
    ): void {
      const suggestion =
        result?.suggestion ??
        null;

      if (
        failure
      ) {
        render(
          aiHost,

          h(
            'div',
            {
              class:
                'panel-head',
            },

            h(
              'h2',
              'AI review',
            ),
          ),

          notice(
            'warn',
            failure,
          ),

          h(
            'p',
            {
              class:
                'ai-disclaimer',
            },
            'ADVISORY ONLY. THE ASSISTANT CANNOT APPROVE, PUBLISH, REJECT OR CHANGE VISIBILITY.',
          ),
        );

        return;
      }

      if (
        !suggestion
      ) {
        render(
          aiHost,

          h(
            'div',
            {
              class:
                'panel-head',
            },

            h(
              'h2',
              'AI review',
            ),
          ),

          h(
            'div',
            {
              class:
                'ai-suggestion',
            },

            h(
              'span',
              {
                class:
                  'mono-meta dim-text',
              },
              'NO AI REVIEW YET',
            ),

            h(
              'p',
              {
                class:
                  'dim-text',
              },
              'Ask the assistant to generate a quick brief, confidence score, classification suggestions and review flags.',
            ),
          ),

          h(
            'p',
            {
              class:
                'ai-disclaimer',
            },
            'ADVISORY ONLY. THE ASSISTANT CANNOT APPROVE, PUBLISH, REJECT OR CHANGE VISIBILITY.',
          ),
        );

        return;
      }

      const suggestedCategoryName =
        suggestion
          .suggested_category
          ?.name
          ?.trim()
          .toLowerCase() ??
        '';

      const categoryMatch =
        categories.find(
          (
            category:
              ArchiveCategory,
          ) =>
            category.label
              .toLowerCase() ===
            suggestedCategoryName ||
            category.slug
              .toLowerCase() ===
            suggestedCategoryName,
        ) ??
        null;

      const projectMatch =
        suggestion
          .suggested_project
          ?.id
          ? projectList.find(
            (
              project,
            ) =>
              project.id ===
              suggestion
                .suggested_project
                .id,
          )
          : projectList.find(
            (
              project,
            ) =>
              project.title
                .toLowerCase() ===
              (
                suggestion
                  .suggested_project
                  ?.title ??
                ''
              ).toLowerCase(),
          );

      const confidence =
        suggestion.confidence;

      const score =
        Math.max(
          0,
          Math.min(
            100,
            confidence.score,
          ),
        );

      const suggestionRows:
        Array<
          HTMLElement |
          null
        > = [
          recommendation(
            'SUGGESTED TITLE',
            suggestion
              .suggested_title,
            'title',
          ),

          recommendation(
            'SUGGESTED DESCRIPTION',
            suggestion
              .suggested_description,
            'description',
          ),

          recommendation(
            'SUGGESTED CATEGORY',
            categoryMatch
              ?.label ??
            suggestion
              .suggested_category
              ?.name ??
            null,

            'category',

            suggestion
              .suggested_category
              ?.reason ??
            null,
          ),

          recommendation(
            'SUGGESTED VISIBILITY',
            suggestion
              .suggested_visibility
              ?.value ??
            null,

            'visibility',

            suggestion
              .suggested_visibility
              ?.reason ??
            null,
          ),
        ];

      /*
       * Category values in the form use the category slug.
       * Override the generic display-value behaviour when we have
       * an authoritative category match.
       */
      if (
        categoryMatch
      ) {
        const categoryRecommendation =
          suggestionRows[2];

        if (
          categoryRecommendation
        ) {
          const buttons =
            categoryRecommendation
              .querySelectorAll<
                HTMLButtonElement
              >(
                'button',
              );

          if (
            buttons[0]
          ) {
            buttons[0].onclick =
              () => {
                setField(
                  'category',
                  categoryMatch.slug,
                );

                acceptedSuggestions.add(
                  'category',
                );

                toast(
                  'Category applied.',
                );
              };
          }

          if (
            buttons[1]
          ) {
            buttons[1].onclick =
              () => {
                setField(
                  'category',
                  categoryMatch.slug,
                );

                acceptedSuggestions.add(
                  'category:edited',
                );

                form.querySelector<
                  HTMLElement
                >(
                  '[name="category"]',
                )?.focus();
              };
          }
        }
      }

      const projectRecommendation =
        suggestion
          .suggested_project
          ?.title
          ? h(
            'div',
            {
              class:
                'ai-suggestion',
            },

            h(
              'span',
              {
                class:
                  'mono-meta dim-text',
              },
              'LIKELY PROJECT',
            ),

            h(
              'strong',
              suggestion
                .suggested_project
                .title,
            ),

            suggestion
              .suggested_project
              .reason
              ? h(
                'p',
                {
                  class:
                    'dim-text',
                },
                suggestion
                  .suggested_project
                  .reason,
              )
              : null,

            projectMatch
              ? h(
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
                      () => {
                        setField(
                          'project_id',
                          projectMatch.id,
                        );

                        acceptedSuggestions.add(
                          'project_id',
                        );

                        toast(
                          'Project applied.',
                        );
                      },
                  },
                  'Accept',
                ),

                h(
                  'button',
                  {
                    type:
                      'button',

                    class:
                      'btn-ghost',

                    onclick:
                      () => {
                        setField(
                          'project_id',
                          projectMatch.id,
                        );

                        acceptedSuggestions.add(
                          'project_id:edited',
                        );

                        form.querySelector<
                          HTMLElement
                        >(
                          '[name="project_id"]',
                        )?.focus();
                      },
                  },
                  'Edit',
                ),
              )
              : h(
                'span',
                {
                  class:
                    'mono-meta dim-text',
                },
                'NO MATCHING PROJECT — VERIFY MANUALLY',
              ),
          )
          : null;

      render(
        aiHost,

        h(
          'div',
          {
            class:
              'panel-head',
          },

          h(
            'h2',
            'AI review',
          ),

          h(
            'span',
            {
              class:
                'mono-meta dim-text',
            },
            result?.ai
              ?.model ??
            '',
          ),
        ),

        /*
         * QUICK BRIEF
         */
        h(
          'div',
          {
            class:
              'ai-suggestion',
          },

          h(
            'span',
            {
              class:
                'mono-meta dim-text',
            },
            'QUICK BRIEF',
          ),

          h(
            'p',
            {
              style: {
                fontSize:
                  '1rem',

                lineHeight:
                  '1.65',

                marginBottom:
                  '0',
              },
            },
            suggestion.brief,
          ),
        ),

        /*
         * CONFIDENCE
         */
        h(
          'div',
          {
            class:
              'ai-suggestion',
          },

          h(
            'div',
            {
              style: {
                display:
                  'flex',

                justifyContent:
                  'space-between',

                alignItems:
                  'baseline',

                gap:
                  '1rem',
              },
            },

            h(
              'span',
              {
                class:
                  'mono-meta dim-text',
              },
              'AI CONFIDENCE',
            ),

            h(
              'strong',
              {
                style: {
                  fontSize:
                    '1.5rem',
                },
              },
              `${score}%`,
            ),
          ),

          h(
            'div',
            {
              style: {
                width:
                  '100%',

                height:
                  '8px',

                border:
                  '1px solid var(--border-color)',

                margin:
                  '0.75rem 0',

                overflow:
                  'hidden',
              },
            },

            h(
              'div',
              {
                style: {
                  width:
                    `${score}%`,

                  height:
                    '100%',

                  background:
                    'var(--accent-blue)',
                },
              },
            ),
          ),

          h(
            'strong',
            {
              class:
                'mono-meta',
            },
            confidenceLabel(
              confidence.level,
            ),
          ),

          h(
            'p',
            {
              class:
                'dim-text',
            },
            confidence.reason,
          ),

          h(
            'p',
            {
              class:
                'mono-meta dim-text',
            },
            'CONFIDENCE MEASURES THE RELIABILITY OF THE AI ANALYSIS — NOT THE LIKELIHOOD OF APPROVAL.',
          ),
        ),

        /*
         * CLASSIFICATION
         */
        h(
          'div',
          {
            class:
              'ai-suggestion',
          },

          h(
            'span',
            {
              class:
                'mono-meta dim-text',
            },
            'CLASSIFICATION',
          ),

          h(
            'div',
            {
              style: {
                display:
                  'grid',

                gap:
                  '0.5rem',

                marginTop:
                  '0.75rem',
              },
            },

            h(
              'div',
              {},
              h(
                'strong',
                'Category: ',
              ),
              suggestion
                .suggested_category
                ?.name ??
              '—',
            ),

            h(
              'div',
              {},
              h(
                'strong',
                'Project: ',
              ),
              suggestion
                .suggested_project
                ?.title ??
              '—',
            ),

            h(
              'div',
              {},
              h(
                'strong',
                'Visibility: ',
              ),
              suggestion
                .suggested_visibility
                ?.value ??
              '—',
            ),
          ),
        ),

        /*
         * TAGS
         */
        suggestion
          .suggested_tags
          .length
          ? h(
            'div',
            {
              class:
                'ai-suggestion',
            },

            h(
              'span',
              {
                class:
                  'mono-meta dim-text',
              },
              'SUGGESTED TAGS',
            ),

            h(
              'div',
              {
                style: {
                  marginTop:
                    '0.75rem',
                },
              },

              suggestion
                .suggested_tags
                .map(
                  (
                    tag,
                  ) =>
                    h(
                      'span',
                      {
                        class:
                          'tag',

                        style: {
                          marginRight:
                            '0.35rem',

                          marginBottom:
                            '0.35rem',
                        },
                      },
                      tag,
                    ),
                ),
            ),
          )
          : null,

        /*
         * APPLYABLE SUGGESTIONS
         */
        ...suggestionRows,

        projectRecommendation,

        /*
         * REVIEW FLAGS
         */
        flagGroup(
          'SENSITIVE INFORMATION',
          suggestion
            .sensitive_information,
          'danger',
        ),

        flagGroup(
          'MISSING INFORMATION',
          suggestion
            .missing_information,
          'warn',
        ),

        flagGroup(
          'POSSIBLE DUPLICATES',
          suggestion
            .duplicate_concerns,
          'warn',
        ),

        flagGroup(
          'WARNINGS',
          suggestion
            .warnings,
          'warn',
        ),

        flagGroup(
          'REVIEW NOTES',
          suggestion
            .review_notes,
          'info',
        ),

        h(
          'p',
          {
            class:
              'ai-disclaimer',
          },
          'ADVISORY ONLY. THE ASSISTANT CANNOT APPROVE, PUBLISH, REJECT OR CHANGE VISIBILITY. ' +
          'NOTHING HAPPENS UNTIL A HUMAN ADMINISTRATOR TAKES ACTION. ' +
          'THE AUDIT RECORD IDENTIFIES THE HUMAN ADMINISTRATOR AS THE DECISION MAKER.',
        ),
      );
    }

    /*
     * Initial AI panel.
     *
     * The new Cloudflare Worker does not automatically write its output
     * into the archive decision path. A fresh review is requested explicitly.
     */
    drawAi(
      null,
      null,
    );

    const preview =
      h(
        'div',
        {
          class:
            'preview-box',
        },

        h(
          'span',
          {
            class:
              'mono-meta dim-text',
          },
          'LOADING PREVIEW…',
        ),
      );

    void (
      async () => {
        try {
          if (
            row.external_url
          ) {
            render(
              preview,

              h(
                'div',
                {
                  style: {
                    padding:
                      '2rem',

                    textAlign:
                      'center',
                  },
                },

                h(
                  'p',
                  {
                    class:
                      'mono-meta dim-text',
                  },
                  'EXTERNAL LINK',
                ),

                h(
                  'a',
                  {
                    href:
                      row.external_url,

                    target:
                      '_blank',

                    rel:
                      'noopener noreferrer',
                  },
                  row.external_url,
                ),
              ),
            );

            return;
          }

          if (
            !row.storage_bucket ||
            !row.storage_path
          ) {
            render(
              preview,

              h(
                'span',
                {
                  class:
                    'mono-meta dim-text',
                },
                'NO FILE ATTACHED',
              ),
            );

            return;
          }

          const url =
            await signedUrl(
              row.storage_bucket,
              row.storage_path,
              900,
            );

          if (!url) {
            render(
              preview,

              h(
                'span',
                {
                  class:
                    'mono-meta dim-text',
                },
                'COULD NOT OPEN THIS FILE',
              ),
            );

            return;
          }

          const mime =
            row.mime_type ??
            '';

          if (
            mime.startsWith(
              'image/',
            )
          ) {
            render(
              preview,

              h(
                'img',
                {
                  src:
                    url,

                  alt:
                    row.title,
                },
              ),
            );

            return;
          }

          if (
            mime ===
            'application/pdf' ||
            mime ===
            'text/html'
          ) {
            render(
              preview,

              h(
                'iframe',
                {
                  src:
                    url,

                  title:
                    `${row.title} preview`,

                  loading:
                    'lazy',
                },
              ),
            );

            return;
          }

          render(
            preview,

            h(
              'div',
              {
                style: {
                  padding:
                    '2rem',

                  textAlign:
                    'center',
                },
              },

              h(
                'p',
                {
                  class:
                    'mono-meta dim-text',
                },
                (
                  row.mime_type ??
                  'FILE'
                ).toUpperCase(),
              ),

              h(
                'a',
                {
                  href:
                    url,

                  target:
                    '_blank',

                  rel:
                    'noopener',
                },
                'Open in a new tab',
              ),
            ),
          );
        } catch (error) {
          console.error(
            'Could not load archive submission preview:',
            error,
          );

          render(
            preview,

            notice(
              'warn',
              `Preview unavailable: ${errorMessage(error)}`,
            ),
          );
        }
      }
    )();

    const modal =
      dialog(
        `Review — ${row.title}`,

        h(
          'div',
          {
            class:
              'review-split',
          },

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
                'Submitted by',

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
                'File',

                row.file_name ??
                (
                  row.external_url
                    ? 'external link'
                    : '—'
                ),
              ],

              [
                'Type',

                row.mime_type ??
                '—',
              ],

              [
                'Size',

                fileSize(
                  row.size_bytes,
                ),
              ],

              [
                'Suggested visibility',

                row.suggested_visibility
                  .toUpperCase(),
              ],

              [
                'Other contributors',

                row.contributor_names
                  .join(
                    ', ',
                  ) ||
                '—',
              ],

              [
                'Member notes',

                row.notes ??
                '—',
              ],
            ]),

            preview,

            form,

            historyPanel(
              'archive_submission',
              row.id,
              row.submitted_by,
            ),
          ),

          h(
            'div',
            {
              style: {
                display:
                  'flex',

                flexDirection:
                  'column',

                gap:
                  '1rem',
              },
            },

            aiEnabled
              ? action(
                'Ask the assistant',

                async () => {
                  render(
                    aiHost,

                    h(
                      'div',
                      {
                        class:
                          'ai-suggestion',
                      },

                      h(
                        'span',
                        {
                          class:
                            'mono-meta dim-text',
                        },
                        'ANALYSING SUBMISSION…',
                      ),

                      h(
                        'p',
                        {
                          class:
                            'dim-text',
                        },
                        'Generating the administrator brief, confidence score, classifications and review flags.',
                      ),
                    ),
                  );

                  try {
                    const result =
                      await requestWorkerAiReview(
                        row.id,
                      );

                    drawAi(
                      result,
                      null,
                    );

                    toast(
                      'AI review ready.',
                      'ok',
                    );
                  } catch (error) {
                    console.error(
                      'AI review failed:',
                      error,
                    );

                    drawAi(
                      null,
                      `Assistant review failed: ${errorMessage(error)}`,
                    );

                    toast(
                      `Assistant review failed: ${errorMessage(error)}`,
                      'err',
                    );
                  }
                },
              )
              : notice(
                'info',
                'The review assistant is switched off. Turn it on in Administration → Settings.',
              ),

            aiHost,
          ),
        ),

        h(
          'div',
          {
            class:
              'button-row',
          },

          canPublish
            ? action(
              'Publish to archive',

              async () => {
                const values =
                  formValues(
                    form,
                  );

                const visibility =
                  textOf(
                    values,
                    'visibility',
                  ) as ContentVisibility;

                const override =
                  visibility ===
                  'public' &&
                  row.suggested_visibility ===
                  'internal';

                const reason =
                  override
                    ? checkReason(
                      textOf(
                        values,
                        'reason',
                      ),
                      'publish publicly something submitted as internal',
                    )
                    : textOf(
                      values,
                      'reason',
                    ) ||
                    null;

                if (
                  override &&
                  !reason
                ) {
                  return;
                }

                try {
                  await publishSubmission(
                    row.id,
                    {
                      title:
                        textOf(
                          values,
                          'title',
                        ),

                      category:
                        textOf(
                          values,
                          'category',
                        ) ||
                        null,

                      description:
                        textOf(
                          values,
                          'description',
                        ) ||
                        null,

                      folder:
                        textOf(
                          values,
                          'folder_id',
                        ) ||
                        null,

                      project:
                        textOf(
                          values,
                          'project_id',
                        ) ||
                        null,

                      visibility,

                      section:
                        textOf(
                          values,
                          'section',
                        ),

                      reason,

                      sourceBucket:
                        row.storage_bucket,

                      sourcePath:
                        row.storage_path,

                      aiAccepted:
                        [
                          ...acceptedSuggestions,
                        ],
                    },
                  );

                  modal.close();

                  toast(
                    'Published to the archive.',
                  );

                  await draw();
                } catch (error) {
                  console.error(
                    'Could not publish archive submission:',
                    error,
                  );

                  toast(
                    `Could not publish submission: ${errorMessage(error)}`,
                    'err',
                  );
                }
              },

              'primary',
            )
            : notice(
              'info',
              'Reviewers can request changes or decline. Publishing needs a club admin.',
            ),

          action(
            'Request changes',

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
                  'ask for changes',
                );

              if (!reason) {
                return;
              }

              try {
                await decideSubmission(
                  row.id,
                  'changes_requested',
                  reason,

                  textOf(
                    values,
                    'internal',
                  ) ||
                  null,
                );

                modal.close();

                toast(
                  'Sent back to the member.',
                );

                await draw();
              } catch (error) {
                console.error(
                  'Could not request archive changes:',
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
                formValues(
                  form,
                );

              const reason =
                checkReason(
                  textOf(
                    values,
                    'reason',
                  ),
                  'decline this submission',
                );

              if (!reason) {
                return;
              }

              try {
                await decideSubmission(
                  row.id,
                  'rejected',
                  reason,

                  textOf(
                    values,
                    'internal',
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
                  'Could not decline archive submission:',
                  error,
                );

                toast(
                  `Could not decline submission: ${errorMessage(error)}`,
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
      const currentFilter =
        FILTERS[
        filter
        ];

      if (!currentFilter) {
        throw new Error(
          'Invalid archive review filter.',
        );
      }

      const rows =
        await submissionQueue(
          currentFilter[1],
        );

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

      render(
        content,

        pageHeader(
          'ADMIN / ARCHIVE',
          'Archive submissions',
        ),

        h(
          'div',
          {
            class:
              'browser-toolbar',
          },

          FILTERS.map(
            (
              [
                label,
              ],
              index,
            ) =>
              h(
                'button',
                {
                  type:
                    'button',

                  class:
                    'btn-ghost',

                  style:
                    index ===
                      filter
                      ? {
                        borderColor:
                          'var(--accent-blue)',

                        color:
                          'var(--accent-blue)',
                      }
                      : {},

                  onclick:
                    () => {
                      filter =
                        index;

                      void draw();
                    },
                },
                label,
              ),
          ),
        ),

        panel(
          `${rows.length} in this queue`,

          rows.length
            ? dataTable(
              [
                'Submitted by',
                'Title',
                'Project',
                'Category',
                'Size',
                'Wants',
                'Status',
                '',
              ],

              rows.map(
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
                        archiveDate(
                          row.created_at,
                        ),
                      ),
                    ),

                    h(
                      'div',
                      {},

                      h(
                        'strong',
                        row.title,
                      ),

                      h(
                        'p',
                        {
                          class:
                            'mono-meta dim-text',
                        },
                        row.file_name ??
                        row.external_url ??
                        '',
                      ),
                    ),

                    row.project_id
                      ? projectTitle.get(
                        row.project_id,
                      ) ??
                      '—'
                      : '—',

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      (
                        row.category ??
                        '—'
                      ).toUpperCase(),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      row.external_url
                        ? 'LINK'
                        : fileSize(
                          row.size_bytes,
                        ),
                    ),

                    h(
                      'span',
                      {
                        class:
                          'mono-meta',
                      },
                      row.suggested_visibility
                        .toUpperCase(),
                    ),

                    statusPill(
                      row.status,
                    ),

                    h(
                      'button',
                      {
                        type:
                          'button',

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
            )
            : emptyState(
              'This queue is clear.',
            ),
        ),

        notice(
          'info',
          'Nothing a member uploads is public until it is published from here. ' +
          'When in doubt about personal information, publish it as internal.',
        ),
      );
    } catch (error) {
      console.error(
        'Archive review page failed to load:',
        error,
      );

      render(
        content,

        pageHeader(
          'ADMIN / ARCHIVE',
          'Archive review unavailable',
        ),

        notice(
          'err',
          `The archive review queue could not load: ${errorMessage(error)}`,
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