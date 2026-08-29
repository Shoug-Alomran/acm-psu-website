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
 *
 * The layout is built to make that division obvious rather than to state it
 * once in small print: machine output lives in its own column with its own
 * mini-actions (Accept / Edit / Ignore, which only fill in form fields), while
 * the three decisions that actually change the archive live alone in a
 * captioned bar at the foot of the dialog.
 */

import {
  h,
  render,
  formValues,
  textOf,
  type Child,
} from '../lib/dom.js';

import {
  shell,
  pageHeader,
  panel,
  statusPill,
  dataTable,
  dialog,
  field,
  notice,
  toast,
  action,
  emptyState,
  reasonField,
  internalNoteField,
  checkReason,
  tagList,
  spec,
  specGrid,
  skeletonList,
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
  submissionCounts,
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

const AI_REVIEW_URL = 'https://acm-psu-ai-review.shoug-alomran.workers.dev';

/* ---------------------------------------------------------------- AI shapes */

type ConfidenceLevel = 'low' | 'medium' | 'high' | 'very_high';

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
  suggested_category: AiSuggestedCategory;
  suggested_project: AiSuggestedProject;
  suggested_tags: string[];
  suggested_visibility: AiSuggestedVisibility;
  sensitive_information: string[];
  duplicate_concerns: string[];
  missing_information: string[];
  warnings: string[];
  review_notes: string[];
}

interface WorkerAiResponse {
  ok: boolean;
  submission_id?: string;
  reviewer?: { user_id: string; role: string };
  ai?: { model: string; advisory_only: boolean };
  suggestion?: WorkerAiSuggestion;
  error?: string;
}

/* ------------------------------------------------------------- queue config */

interface QueueFilter {
  label: string;
  statuses: ReviewStatus[];
  /** Shown under the page title while this queue is open. */
  blurb: string;
}

const FILTERS: QueueFilter[] = [
  {
    label: 'Awaiting review',
    statuses: ['submitted'],
    blurb: 'Submissions members have sent in and nobody has decided on yet.',
  },
  {
    label: 'Changes requested',
    statuses: ['changes_requested'],
    blurb: 'Sent back to the member with a reason. Waiting on them, not on you.',
  },
  {
    label: 'Published',
    statuses: ['approved'],
    blurb: 'Already in the archive. Open one to see who published it and why.',
  },
  {
    label: 'Declined',
    statuses: ['rejected'],
    blurb: 'Declined with a recorded reason. Kept for the audit trail.',
  },
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
].map((value) => ({ value, label: value.toUpperCase() }));

/* ------------------------------------------------------------------ helpers */

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (
    typeof error === 'object' && error !== null && 'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return 'An unknown error occurred.';
}

function confidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case 'very_high': return 'VERY HIGH';
    case 'high': return 'HIGH';
    case 'medium': return 'MEDIUM';
    default: return 'LOW';
  }
}

/** Low and medium readings are drawn in a warmer colour, not just labelled. */
function confidenceTone(level: ConfidenceLevel): string {
  return level === 'low' ? ' confidence-meter--low'
    : level === 'medium' ? ' confidence-meter--medium'
    : '';
}

function visibilityLabel(value: string | null | undefined): string {
  const key = String(value ?? '').toLowerCase();
  return key === 'public' ? 'Public' : key === 'internal' ? 'Internal' : '—';
}

async function requestWorkerAiReview(submissionId: string): Promise<WorkerAiResponse> {
  const client = requireClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;

  if (!data.session?.access_token) {
    throw new Error('You must be signed in to use AI review.');
  }

  const response = await fetch(AI_REVIEW_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ submission_id: submissionId }),
  });

  let payload: WorkerAiResponse;

  try {
    payload = await response.json() as WorkerAiResponse;
  } catch {
    throw new Error(`AI review returned an unreadable response (${response.status}).`);
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `AI review failed with status ${response.status}.`);
  }

  return payload;
}

/* --------------------------------------------------------- shared fragments */

function caption(text: string): HTMLElement {
  return h('div', { class: 'review-caption' }, text.toUpperCase());
}

/**
 * The standing statement of what the assistant is and is not allowed to do.
 * Rendered on every state of the panel, including the failure state.
 */
function advisoryStatement(): HTMLElement {
  return h('div', { class: 'ai-disclaimer' },
    h('strong', 'Advisory only.'),
    ' The assistant reads the submission and proposes metadata. It has no ' +
    'authority over the archive.',
    h('ul',
      h('li', 'It cannot approve, publish, decline or change visibility.'),
      h('li', 'Accepting a suggestion only fills in a field on this form.'),
      h('li', 'The audit record names the administrator who decides, never the model.')));
}

/** A reviewer-attention group. Empty groups render nothing at all. */
function flagGroup(
  title: string,
  items: string[],
  severity: 'info' | 'warn' | 'danger',
  marker: string,
): HTMLElement | null {
  const entries = items.filter((item) => item.trim().length > 0);
  if (!entries.length) return null;

  return h('div', { class: `flag-group flag-group--${severity}` },
    h('div', { class: 'flag-group__label' },
      h('span', title.toUpperCase()),
      h('span', { class: 'flag-group__count' }, String(entries.length))),
    h('ul', { class: 'flag-list' },
      entries.map((item) => h('li', { class: `flag flag--${severity}` },
        h('span', { class: 'flag__marker' }, marker),
        h('span', item)))));
}

/* --------------------------------------------------------------------- page */

async function start(): Promise<void> {
  const viewer = await requireAdmin('reviewer');
  const content = shell(viewer, 'admin', 'Archive review');

  render(content,
    pageHeader('ADMIN / ARCHIVE', 'Archive submissions'),
    skeletonList(6));

  let categories: ArchiveCategory[] = [];
  let projectList: Project[] = [];
  let folders: ArchiveFolder[] = [];
  let aiEnabled = false;

  try {
    [categories, projectList, folders] = await Promise.all([
      archiveCategories(),
      projects(),
      archiveFolders(),
    ]);
  } catch (error) {
    console.error('Could not load archive review metadata:', error);

    render(content,
      pageHeader('ADMIN / ARCHIVE', 'Archive review unavailable'),
      notice('err', `Could not load archive configuration: ${errorMessage(error)}`),
      h('div', { class: 'button-row' },
        h('button', {
          type: 'button',
          class: 'btn-ghost',
          onclick: () => window.location.reload(),
        }, 'TRY AGAIN')));

    return;
  }

  try {
    aiEnabled = await setting<boolean>('ai_review_enabled', false);
  } catch (error) {
    console.error('Could not load AI review setting:', error);
    aiEnabled = false;
  }

  let filter = 0;

  /* ------------------------------------------------------- review workspace */

  async function review(
    row: Awaited<ReturnType<typeof submissionQueue>>[number],
  ): Promise<void> {
    const canPublish = isClubAdmin(viewer);
    const acceptedSuggestions = new Set<string>();

    const form = h('form', { class: 'portal-form' },
      field({ label: 'Archive title', name: 'title', value: row.title, maxlength: 200 }),

      h('div', { class: 'field-pair' },
        field({
          label: 'Category',
          name: 'category',
          type: 'select',
          value: row.category ?? '',
          options: [
            { value: '', label: '— none —' },
            ...categories.map((category: ArchiveCategory) => ({
              value: category.slug,
              label: category.label,
            })),
          ],
        }),

        field({
          label: 'Project',
          name: 'project_id',
          type: 'select',
          value: row.project_id ?? '',
          options: [
            { value: '', label: '— none —' },
            ...projectList.map((project: Project) => ({
              value: project.id,
              label: project.title,
            })),
          ],
        })),

      h('div', { class: 'field-pair' },
        field({
          label: 'Folder',
          name: 'folder_id',
          type: 'select',
          value: row.folder_id ?? '',
          options: [
            { value: '', label: '— project root —' },
            ...folders.map((folder: ArchiveFolder) => ({
              value: folder.id,
              label: folder.name,
            })),
          ],
        }),

        field({
          label: 'Section',
          name: 'section',
          type: 'select',
          value: 'files',
          options: SECTIONS,
        })),

      field({
        label: 'Description',
        name: 'description',
        type: 'textarea',
        rows: 4,
        value: row.description,
      }),

      field({
        label: 'Visibility',
        name: 'visibility',
        type: 'select',
        value: row.suggested_visibility,
        options: [
          { value: 'internal', label: 'Internal — members and admins only' },
          { value: 'public', label: 'Public — anyone on the website' },
        ],
        hint: 'Anything containing student IDs, grades or participant names stays internal.',
      }),

      reasonField({
        hint: 'Required when declining, asking for changes, or publishing publicly ' +
          'something the member marked internal. Shown to them.',
      }),

      internalNoteField(),
    ) as HTMLFormElement;

    /** Writes a value into the review form and marks the field as touched. */
    const setField = (name: string, value: string): void => {
      const input = form.querySelector<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >(`[name="${name}"]`);

      if (!input) return;
      input.value = value;
      input.style.borderColor = 'var(--accent-blue)';
    };

    const focusField = (name: string): void => {
      form.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
    };

    const aiHost = h('div', { class: 'ai-panel' });

    /* ------------------------------------------------------ AI suggestions */

    interface SuggestionOptions {
      label: string;
      /** What the reviewer reads. */
      value: string | null;
      /** The form field this suggestion targets. */
      target: string;
      /** What is actually written into the field, when it differs (slugs, ids). */
      applyValue?: string | null;
      reason?: string | null;
      /** Project suggestions offer no Ignore, matching the existing behaviour. */
      allowIgnore?: boolean;
      /** Shown instead of the actions when the value cannot be applied. */
      unavailable?: string;
    }

    function suggestion(options: SuggestionOptions): HTMLElement | null {
      if (!options.value) return null;

      const applied = h('span', { class: 'suggestion__applied', hidden: true }, 'APPLIED');
      const written = options.applyValue ?? options.value;

      const accept = h('button', {
        type: 'button',
        class: 'btn-mini',
        onclick: () => {
          setField(options.target, written);
          acceptedSuggestions.add(options.target);
          block.classList.add('is-applied');
          applied.hidden = false;
          toast('Applied to the review form. You remain the deciding administrator.');
        },
      }, 'Accept');

      const edit = h('button', {
        type: 'button',
        class: 'btn-mini',
        onclick: () => {
          setField(options.target, written);
          acceptedSuggestions.add(`${options.target}:edited`);
          block.classList.add('is-applied');
          applied.hidden = false;
          focusField(options.target);
        },
      }, 'Edit');

      const ignore = h('button', {
        type: 'button',
        class: 'btn-mini btn-mini--quiet',
        onclick: () => block.remove(),
      }, 'Ignore');

      const block = h('div', { class: 'suggestion' },
        h('div', { class: 'suggestion__label' },
          h('span', options.label.toUpperCase()),
          applied),
        h('p', { class: 'suggestion__value' }, options.value),
        options.reason ? h('p', { class: 'suggestion__reason' }, options.reason) : null,
        options.unavailable
          ? h('p', { class: 'suggestion__unavailable' }, options.unavailable)
          : h('div', { class: 'suggestion__actions' },
              accept, edit, options.allowIgnore === false ? null : ignore));

      return block;
    }

    /* ------------------------------------------------------- the AI surface */

    /** Head + body + standing advisory statement, for every panel state. */
    function aiFrame(model: string | null, ...body: Child[]): void {
      render(aiHost,
        h('div', { class: 'panel-head' },
          h('h2', 'AI review'),
          model ? h('span', { class: 'ai-model' }, model) : null),
        h('div', { class: 'ai-body' }, body),
        advisoryStatement());
    }

    function drawIdle(): void {
      aiFrame(null,
        h('div', { class: 'ai-empty' },
          h('span', { class: 'ai-section__label' }, 'NO ANALYSIS YET'),
          h('p', 'Ask the assistant for a quick brief, a reliability reading, ' +
            'classification suggestions and anything that may need your attention. ' +
            'Nothing is sent to the member and nothing is decided.')));
    }

    function drawRunning(): void {
      aiFrame(null,
        h('div', { class: 'ai-empty' },
          h('div', { class: 'ai-running', role: 'status' },
            h('span', { class: 'ai-spinner' }),
            h('span', 'Analysing submission')),
          h('p', 'Reading the submission and drafting the administrator brief.')),
        h('div', { class: 'ai-skeleton', 'aria-hidden': 'true' },
          h('div', { class: 'skeleton-bar', style: { width: '92%' } }),
          h('div', { class: 'skeleton-bar', style: { width: '78%' } }),
          h('div', { class: 'skeleton-bar', style: { width: '86%' } }),
          h('div', { class: 'skeleton-bar', style: { width: '44%' } })));
    }

    function drawFailure(message: string, retry: () => void): void {
      aiFrame(null,
        h('div', { class: 'ai-empty' },
          notice('err', message),
          h('p', 'The rest of this review is unaffected — you can decide without ' +
            'the assistant.'),
          h('div', { class: 'button-row' },
            h('button', { type: 'button', class: 'btn-mini', onclick: retry },
              'Try again'))));
    }

    function drawResult(result: WorkerAiResponse): void {
      const suggestionData = result.suggestion;
      if (!suggestionData) {
        drawIdle();
        return;
      }

      const suggestedCategoryName =
        suggestionData.suggested_category?.name?.trim().toLowerCase() ?? '';

      const categoryMatch = categories.find((category: ArchiveCategory) =>
        category.label.toLowerCase() === suggestedCategoryName ||
        category.slug.toLowerCase() === suggestedCategoryName) ?? null;

      const projectMatch = suggestionData.suggested_project?.id
        ? projectList.find((project) =>
            project.id === suggestionData.suggested_project.id)
        : projectList.find((project) =>
            project.title.toLowerCase() ===
            (suggestionData.suggested_project?.title ?? '').toLowerCase());

      const confidence = suggestionData.confidence;
      const score = Math.max(0, Math.min(100, confidence.score));

      /* Classification: what the model believes this artifact is. */
      const classification = specGrid(
        spec('Category',
          suggestionData.suggested_category?.name ?? '—',
          !suggestionData.suggested_category?.name),
        spec('Project',
          suggestionData.suggested_project?.title ?? '—',
          !suggestionData.suggested_project?.title),
        spec('Visibility',
          visibilityLabel(suggestionData.suggested_visibility?.value),
          !suggestionData.suggested_visibility?.value));

      /*
       * Applyable suggestions. The category suggestion writes the category
       * slug rather than the display label whenever the name resolves to a
       * real archive category.
       */
      const suggestionBlocks = [
        suggestion({
          label: 'Suggested title',
          value: suggestionData.suggested_title,
          target: 'title',
        }),

        suggestion({
          label: 'Suggested description',
          value: suggestionData.suggested_description,
          target: 'description',
        }),

        suggestion({
          label: 'Suggested category',
          value: categoryMatch?.label ?? suggestionData.suggested_category?.name ?? null,
          applyValue: categoryMatch?.slug ?? null,
          target: 'category',
          reason: suggestionData.suggested_category?.reason ?? null,
        }),

        suggestion({
          label: 'Suggested visibility',
          value: suggestionData.suggested_visibility?.value ?? null,
          target: 'visibility',
          reason: suggestionData.suggested_visibility?.reason ?? null,
        }),

        suggestion({
          label: 'Likely project',
          value: suggestionData.suggested_project?.title ?? null,
          applyValue: projectMatch?.id ?? null,
          target: 'project_id',
          reason: suggestionData.suggested_project?.reason ?? null,
          allowIgnore: false,
          unavailable: projectMatch
            ? undefined
            : 'NO MATCHING PROJECT — VERIFY MANUALLY',
        }),
      ].filter((block): block is HTMLElement => block !== null);

      const flags = [
        flagGroup('Sensitive information', suggestionData.sensitive_information,
          'danger', 'SENSITIVE'),
        flagGroup('Missing information', suggestionData.missing_information,
          'warn', 'MISSING'),
        flagGroup('Possible duplicates', suggestionData.duplicate_concerns,
          'warn', 'COMPARE'),
        flagGroup('Warnings', suggestionData.warnings, 'warn', 'WARNING'),
      ].filter((block): block is HTMLElement => block !== null);

      const tags = tagList(suggestionData.suggested_tags);
      const notes = suggestionData.review_notes.filter((note) => note.trim().length > 0);

      aiFrame(result.ai?.model ?? null,
        /* Quick brief — the first and loudest thing in the panel. */
        h('div', { class: 'ai-section ai-brief ai-reveal' },
          h('span', { class: 'ai-section__label' }, 'QUICK BRIEF'),
          h('p', suggestionData.brief)),

        /* Confidence — a reliability reading, never an approval score. */
        h('div', { class: 'ai-section' },
          h('div', { class: 'confidence-head' },
            h('span', { class: 'ai-section__label' }, 'ANALYSIS CONFIDENCE'),
            h('div', { class: 'confidence-reading' },
              h('strong', { class: 'confidence-score' }, `${score}%`),
              h('span', { class: 'confidence-level' },
                confidenceLabel(confidence.level)))),
          h('div', {
            class: `confidence-meter${confidenceTone(confidence.level)}`,
            role: 'img',
            'aria-label': `Analysis confidence ${score} per cent, ` +
              `${confidenceLabel(confidence.level).toLowerCase()}`,
          },
            h('div', { class: 'confidence-meter__fill', style: { width: `${score}%` } })),
          confidence.reason
            ? h('p', { class: 'confidence-reason' }, confidence.reason)
            : null,
          h('p', { class: 'confidence-note' },
            'Confidence measures the reliability of the analysis — not the ' +
            'likelihood of approval.')),

        /* Classification. */
        h('div', { class: 'ai-section' },
          h('span', { class: 'ai-section__label' }, 'CLASSIFICATION'),
          classification),

        tags
          ? h('div', { class: 'ai-section' },
              h('span', { class: 'ai-section__label' }, 'SUGGESTED TAGS'),
              tags)
          : null,

        suggestionBlocks.length
          ? h('div', { class: 'ai-section', style: { padding: '0' } },
              h('div', { class: 'ai-section__label', style: { padding: '1.1rem 1.25rem 0' } },
                'SUGGESTED METADATA — FILLS IN THE FORM, DECIDES NOTHING'),
              suggestionBlocks)
          : null,

        flags.length ? flags : null,

        notes.length
          ? h('div', { class: 'ai-section' },
              h('span', { class: 'ai-section__label' }, 'REVIEWER GUIDANCE'),
              h('ol', { class: 'note-list' },
                notes.map((note) => h('li', { class: 'note-item' }, note))))
          : null);
    }

    drawIdle();

    /* ------------------------------------------------------ artifact preview */

    const preview = h('div', { class: 'preview-box' },
      h('span', { class: 'mono-meta dim-text' }, 'LOADING PREVIEW…'));

    void (async () => {
      try {
        if (row.external_url) {
          render(preview,
            h('div', { class: 'preview-empty' },
              h('span', { class: 'mono-meta dim-text' }, 'EXTERNAL LINK'),
              h('a', {
                class: 'review-link',
                href: row.external_url,
                target: '_blank',
                rel: 'noopener noreferrer',
              }, row.external_url)));

          return;
        }

        if (!row.storage_bucket || !row.storage_path) {
          render(preview,
            h('div', { class: 'preview-empty' },
              h('span', { class: 'mono-meta dim-text' }, 'NO FILE ATTACHED')));

          return;
        }

        const url = await signedUrl(row.storage_bucket, row.storage_path, 900);

        if (!url) {
          render(preview,
            h('div', { class: 'preview-empty' },
              h('span', { class: 'mono-meta dim-text' }, 'COULD NOT OPEN THIS FILE')));

          return;
        }

        const mime = row.mime_type ?? '';

        if (mime.startsWith('image/')) {
          render(preview, h('img', { src: url, alt: row.title }));
          return;
        }

        if (mime === 'application/pdf' || mime === 'text/html') {
          render(preview, h('iframe', {
            src: url,
            title: `${row.title} preview`,
            loading: 'lazy',
          }));

          return;
        }

        render(preview,
          h('div', { class: 'preview-empty' },
            h('span', { class: 'mono-meta dim-text' },
              (row.mime_type ?? 'FILE').toUpperCase()),
            h('a', {
              class: 'review-link',
              href: url,
              target: '_blank',
              rel: 'noopener',
            }, 'Open in a new tab')));
      } catch (error) {
        console.error('Could not load archive submission preview:', error);

        render(preview,
          h('div', { class: 'preview-empty' },
            notice('warn', `Preview unavailable: ${errorMessage(error)}`)));
      }
    })();

    /* ------------------------------------------------------------- assemble */

    const askButton = aiEnabled
      ? action('Ask the assistant', async () => {
          drawRunning();

          try {
            const result = await requestWorkerAiReview(row.id);
            drawResult(result);
            toast('AI review ready.', 'ok');
          } catch (error) {
            console.error('AI review failed:', error);

            drawFailure(
              `Assistant review failed: ${errorMessage(error)}`,
              () => askButton?.click(),
            );

            toast(`Assistant review failed: ${errorMessage(error)}`, 'err');
          }
        })
      : null;

    const projectName = row.project?.title
      ?? (row.project_id ? projectList.find((p) => p.id === row.project_id)?.title : null)
      ?? null;

    const modal = dialog(
      /* Title bar: the submission's own identity, not a generic modal label. */
      h('div', { class: 'review-head' },
        h('div', { class: 'breadcrumb mono-meta' }, 'ARCHIVE REVIEW'),
        h('h2', row.title),
        statusPill(row.status)),

      h('div', { class: 'review-grid' },
        /* LEFT — the submission and what the member actually sent. */
        h('div', { class: 'review-primary' },
          h('div', { class: 'review-identity' },
            h('h3', row.title),
            h('div', { class: 'review-byline' },
              h('span', 'Submitted by ', h('strong', row.member?.full_name ?? 'Unknown')),
              h('span', { class: 'mono-meta' }, row.member?.email ?? '—'),
              h('span', { class: 'mono-meta' }, archiveDate(row.created_at).toUpperCase()))),

          caption('Submitted artifact'),
          preview,

          specGrid(
            spec('File', row.file_name ?? (row.external_url ? 'External link' : '—'),
              !row.file_name && !row.external_url),
            spec('Type', row.mime_type ?? '—', !row.mime_type),
            spec('Size', row.external_url ? '—' : fileSize(row.size_bytes)),
            spec('Proposed visibility', visibilityLabel(row.suggested_visibility)),
            spec('Category', row.category ?? '—', !row.category),
            spec('Project', projectName ?? '—', !projectName)),

          row.contributor_names.length || row.notes
            ? h('div', { class: 'review-block' },
                h('div', { class: 'review-block__head' }, h('h3', 'From the member')),
                h('div', { class: 'review-block__body' },
                  row.contributor_names.length
                    ? h('div', {},
                        h('span', { class: 'spec__label' }, 'OTHER CONTRIBUTORS'),
                        h('div', { style: { marginTop: '0.5rem' } },
                          tagList(row.contributor_names)))
                    : null,
                  row.notes
                    ? h('div', {},
                        h('span', { class: 'spec__label' }, 'NOTES'),
                        h('p', { class: 'review-longtext', style: { marginTop: '0.4rem' } },
                          row.notes))
                    : null))
            : null,

          caption('Archive record'),
          h('p', { class: 'review-longtext' },
            'These values are what gets written to the archive if you publish. ' +
            'They start from what the member submitted.'),
          form,

          caption('History'),
          historyPanel('archive_submission', row.id, row.submitted_by)),

        /* RIGHT — advisory analysis, clearly a separate surface. */
        h('div', { class: 'review-analysis' },
          caption('Advisory analysis'),
          askButton ?? notice('info',
            'The review assistant is switched off. Turn it on in Administration → Settings.'),
          aiHost)),

      /* FOOT — the only controls in this dialog that change anything. */
      h('div', { class: 'decision-bar' },
        h('div', { class: 'decision-bar__caption' },
          h('span', { class: 'mono-meta' }, 'ADMINISTRATIVE DECISION'),
          h('span', 'Recorded permanently against your account.')),

        h('div', { class: 'decision-bar__actions' },
          canPublish
            ? action('Publish to archive', async () => {
                const values = formValues(form);
                const visibility = textOf(values, 'visibility') as ContentVisibility;

                const override = visibility === 'public' &&
                  row.suggested_visibility === 'internal';

                const reason = override
                  ? checkReason(textOf(values, 'reason'),
                      'publish publicly something submitted as internal')
                  : textOf(values, 'reason') || null;

                if (override && !reason) return;

                try {
                  await publishSubmission(row.id, {
                    title: textOf(values, 'title'),
                    category: textOf(values, 'category') || null,
                    description: textOf(values, 'description') || null,
                    folder: textOf(values, 'folder_id') || null,
                    project: textOf(values, 'project_id') || null,
                    visibility,
                    section: textOf(values, 'section'),
                    reason,
                    sourceBucket: row.storage_bucket,
                    sourcePath: row.storage_path,
                    aiAccepted: [...acceptedSuggestions],
                  });

                  modal.close();
                  toast('Published to the archive.');
                  await draw();
                } catch (error) {
                  console.error('Could not publish archive submission:', error);
                  toast(`Could not publish submission: ${errorMessage(error)}`, 'err');
                }
              }, 'primary')
            : notice('info',
                'Reviewers can request changes or decline. Publishing needs a club admin.'),

          action('Request changes', async () => {
            const values = formValues(form);
            const reason = checkReason(textOf(values, 'reason'), 'ask for changes');
            if (!reason) return;

            try {
              await decideSubmission(row.id, 'changes_requested', reason,
                textOf(values, 'internal') || null);

              modal.close();
              toast('Sent back to the member.');
              await draw();
            } catch (error) {
              console.error('Could not request archive changes:', error);
              toast(`Could not request changes: ${errorMessage(error)}`, 'err');
            }
          }),

          action('Decline', async () => {
            const values = formValues(form);
            const reason = checkReason(textOf(values, 'reason'), 'decline this submission');
            if (!reason) return;

            try {
              await decideSubmission(row.id, 'rejected', reason,
                textOf(values, 'internal') || null);

              modal.close();
              toast('Declined.');
              await draw();
            } catch (error) {
              console.error('Could not decline archive submission:', error);
              toast(`Could not decline submission: ${errorMessage(error)}`, 'err');
            }
          }, 'danger'))),

      { class: 'portal-dialog--review', footClass: 'portal-dialog-foot--decision' },
    );
  }

  /* --------------------------------------------------------------- the queue */

  function queueTabs(counts: Record<string, number>): HTMLElement {
    return h('div', { class: 'queue-tabs', role: 'group', 'aria-label': 'Submission queues' },
      FILTERS.map((entry, index) => {
        const total = entry.statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);

        return h('button', {
          type: 'button',
          class: index === filter ? 'queue-tab is-active' : 'queue-tab',
          'aria-pressed': index === filter ? 'true' : 'false',
          onclick: () => {
            if (index === filter) return;
            filter = index;
            void draw();
          },
        },
          h('span', entry.label),
          h('span', { class: 'queue-tab__count' }, String(total)));
      }));
  }

  async function draw(): Promise<void> {
    const currentFilter = FILTERS[filter];

    if (!currentFilter) {
      throw new Error('Invalid archive review filter.');
    }

    render(content,
      pageHeader('ADMIN / ARCHIVE', 'Archive submissions'),
      h('p', { class: 'queue-summary' }, currentFilter.blurb),
      skeletonList(6));

    try {
      const [rows, counts] = await Promise.all([
        submissionQueue(currentFilter.statuses),
        submissionCounts().catch(() => ({} as Record<string, number>)),
      ]);

      const projectTitle = new Map(
        projectList.map((project: Project) => [project.id, project.title]));

      const pending = counts['submitted'] ?? 0;

      render(content,
        pageHeader('ADMIN / ARCHIVE', 'Archive submissions'),

        h('p', { class: 'queue-summary' },
          h('span', currentFilter.blurb),
          h('span', { class: 'mono-meta' },
            pending === 1 ? '1 AWAITING REVIEW' : `${pending} AWAITING REVIEW`)),

        queueTabs(counts),

        panel(`${currentFilter.label} — ${rows.length}`,
          rows.length
            ? dataTable(
                ['Submission', 'Contributor', 'Project', 'Category',
                 'Wants', 'Size', 'Status', ''],

                rows.map((row) => [
                  h('div', { class: 'queue-identity' },
                    h('strong', row.title),
                    h('span', { class: 'queue-sub' },
                      row.file_name ?? row.external_url ?? 'No file')),

                  h('div', { class: 'queue-identity' },
                    h('strong', row.member?.full_name ?? '—'),
                    h('span', { class: 'queue-sub' }, archiveDate(row.created_at))),

                  h('span', { class: 'queue-meta' },
                    row.project_id
                      ? projectTitle.get(row.project_id) ?? '—'
                      : '—'),

                  h('span', { class: 'queue-meta' },
                    (row.category ?? '—').toUpperCase()),

                  h('span', { class: 'queue-meta queue-meta--dim' },
                    row.suggested_visibility.toUpperCase()),

                  h('span', { class: 'queue-meta queue-meta--dim' },
                    row.external_url ? 'LINK' : fileSize(row.size_bytes)),

                  statusPill(row.status),

                  h('div', { class: 'queue-actions' },
                    h('button', {
                      type: 'button',
                      class: 'btn-review',
                      'aria-label': `Review ${row.title}`,
                      onclick: () => void review(row),
                    }, 'Review')),
                ]),

                {
                  tableClass: 'queue-table',
                  rowClass: (index) => {
                    const status = rows[index]?.status;
                    return status === 'submitted' ? 'queue-row queue-row--pending'
                      : status === 'changes_requested' ? 'queue-row queue-row--attention'
                      : 'queue-row';
                  },
                  cellClass: (column) =>
                    column === 7 ? 'queue-actions' : null,
                })
            : emptyState('This queue is clear.',
                'Nothing here needs a decision right now.')),

        notice('info',
          'Nothing a member uploads is public until it is published from here. ' +
          'When in doubt about personal information, publish it as internal.'));
    } catch (error) {
      console.error('Archive review page failed to load:', error);

      render(content,
        pageHeader('ADMIN / ARCHIVE', 'Archive review unavailable'),
        notice('err', `The archive review queue could not load: ${errorMessage(error)}`),
        h('div', { class: 'button-row' },
          h('button', {
            type: 'button',
            class: 'btn-ghost',
            onclick: () => void draw(),
          }, 'TRY AGAIN')));
    }
  }

  await draw();
}

void start();
