/**
 * Archive submission review — the page the AI assistant lives on.
 *
 * The assistant reads the submission's metadata and proposes a category, a
 * title, a description, tags and a visibility, and raises flags for things a
 * human should look at — student IDs, personal details, possible duplicates.
 * Every suggestion has ACCEPT / EDIT / IGNORE beside it and none of them do
 * anything until the admin fills the form and presses Publish.
 *
 * The AI cannot publish. publish_archive_submission() requires an
 * authenticated club admin, and there is no code path from the assistant to
 * it — the suggestions land in a separate table that the publish function
 * never reads.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, dataTable, loading, dialog, field,
  metaList, notice, toast, action, emptyState, reasonField, internalNoteField,
  checkReason,
} from '../lib/ui.js';
import { historyPanel } from '../lib/history.js';
import { requireAdmin, isClubAdmin } from '../lib/session.js';
import {
  publishSubmission, decideSubmission, requestAiReview,
} from '../lib/admin.js';
import {
  submissionQueue, submissionAi, archiveCategories, archiveFolders, projects,
  signedUrl, setting,
} from '../lib/api.js';
import { archiveDate, fileSize } from '../lib/format.js';
import type {
  AiFlag, AiSuggestions, ArchiveCategory, ArchiveFolder, ContentVisibility,
  Project, ReviewStatus,
} from '../lib/types.js';

const FILTERS: Array<[string, ReviewStatus[]]> = [
  ['Awaiting review', ['submitted']],
  ['Changes requested', ['changes_requested']],
  ['Published', ['approved']],
  ['Declined', ['rejected']],
];

const SECTIONS = ['overview', 'files', 'website', 'workshops', 'documents',
                  'media', 'branding', 'results']
  .map((value) => ({ value, label: value.toUpperCase() }));

async function start(): Promise<void> {
  const viewer = await requireAdmin('reviewer');
  const content = shell(viewer, 'admin', 'Archive review');
  render(content, loading());

  const [categories, projectList, folders, aiEnabled] = await Promise.all([
    archiveCategories(), projects(), archiveFolders(),
    setting<boolean>('ai_review_enabled', false),
  ]);

  let filter = 0;

  async function review(row: Awaited<ReturnType<typeof submissionQueue>>[number]): Promise<void> {
    const canPublish = isClubAdmin(viewer);

    // Which of the assistant's suggestions the admin actually took. Recorded
    // as attribution on the admin's decision — the assistant is never the
    // approving authority, and the audit entry says so explicitly.
    const acceptedSuggestions = new Set<string>();

    const form = h('form', { class: 'portal-form' },
      field({ label: 'Archive title', name: 'title', value: row.title, maxlength: 200 }),
      h('div', { class: 'field-pair' },
        field({ label: 'Category', name: 'category', type: 'select', value: row.category ?? '',
                options: [{ value: '', label: '— none —' },
                  ...categories.map((c: ArchiveCategory) => ({ value: c.slug, label: c.label }))] }),
        field({ label: 'Project', name: 'project_id', type: 'select',
                value: row.project_id ?? '',
                options: [{ value: '', label: '— none —' },
                  ...projectList.map((p: Project) => ({ value: p.id, label: p.title }))] })),
      h('div', { class: 'field-pair' },
        field({ label: 'Folder', name: 'folder_id', type: 'select', value: row.folder_id ?? '',
                options: [{ value: '', label: '— project root —' },
                  ...folders.map((f: ArchiveFolder) => ({ value: f.id, label: f.name }))] }),
        field({ label: 'Section', name: 'section', type: 'select', value: 'files',
                options: SECTIONS })),
      field({ label: 'Description', name: 'description', type: 'textarea', rows: 4,
              value: row.description }),
      field({
        label: 'Visibility', name: 'visibility', type: 'select',
        value: row.suggested_visibility,
        options: [{ value: 'internal', label: 'Internal — members and admins only' },
                  { value: 'public', label: 'Public — anyone on the website' }],
        hint: 'Anything containing student IDs, grades or participant names stays internal.',
      }),
      reasonField({
        hint: 'Required when declining, asking for changes, or publishing ' +
              'publicly something the member marked internal. Shown to them.',
      }),
      internalNoteField(),
    ) as HTMLFormElement;

    const setField = (name: string, value: string) => {
      const input = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        `[name="${name}"]`);
      if (input) { input.value = value; input.style.borderColor = 'var(--accent-blue)'; }
    };

    const aiHost = h('div', { class: 'ai-panel' });

    function drawAi(
      suggestions: AiSuggestions | null, flags: AiFlag[], model: string | null,
      failure: string | null,
    ): void {
      const rows: HTMLElement[] = [];

      const suggestion = (label: string, value: string | null, target: string) => {
        if (!value) return;
        rows.push(h('div', { class: 'ai-suggestion' },
          h('span', { class: 'mono-meta dim-text' }, label),
          h('strong', value),
          h('div', { class: 'button-row' },
            h('button', { type: 'button', class: 'btn-ghost',
              onclick: () => {
                setField(target, value);
                acceptedSuggestions.add(target);
                toast('Applied to the form. You are still the one deciding.');
              } }, 'Accept'),
            h('button', { type: 'button', class: 'btn-ghost',
              onclick: () => {
                setField(target, value);
                acceptedSuggestions.add(`${target}:edited`);
                form.querySelector<HTMLElement>(`[name="${target}"]`)?.focus();
              } }, 'Edit'),
            h('button', { type: 'button', class: 'btn-ghost',
              onclick: (event: Event) =>
                (event.currentTarget as HTMLElement).closest('.ai-suggestion')?.remove() },
              'Ignore'))));
      };

      if (suggestions) {
        suggestion('SUGGESTED TITLE', suggestions.title, 'title');
        suggestion('SUGGESTED DESCRIPTION', suggestions.description, 'description');
        suggestion('SUGGESTED CATEGORY', suggestions.category, 'category');
        suggestion('SUGGESTED VISIBILITY', suggestions.visibility, 'visibility');

        if (suggestions.project_hint) {
          const match = projectList.find((p: Project) =>
            p.title.toLowerCase().includes(suggestions.project_hint!.toLowerCase()) ||
            p.slug === suggestions.project_hint);
          rows.push(h('div', { class: 'ai-suggestion' },
            h('span', { class: 'mono-meta dim-text' }, 'LIKELY PROJECT'),
            h('strong', suggestions.project_hint),
            match
              ? h('div', { class: 'button-row' },
                  h('button', { type: 'button', class: 'btn-ghost',
                    onclick: () => {
                      setField('project_id', match.id);
                      acceptedSuggestions.add('project_id');
                      toast('Applied.');
                    } }, 'Accept'))
              : h('span', { class: 'mono-meta dim-text' }, 'NO MATCHING PROJECT — SET IT MANUALLY')));
        }

        if (suggestions.tags.length) {
          rows.push(h('div', { class: 'ai-suggestion' },
            h('span', { class: 'mono-meta dim-text' }, 'SUGGESTED TAGS'),
            h('div', {}, suggestions.tags.map((tag) =>
              h('span', { class: 'tag', style: { marginRight: '0.35rem' } }, tag)))));
        }

        if (suggestions.reasoning) {
          rows.push(h('div', { class: 'ai-suggestion' },
            h('span', { class: 'mono-meta dim-text' }, 'REASONING'),
            h('p', suggestions.reasoning)));
        }
      }

      render(aiHost,
        h('div', { class: 'panel-head' },
          h('h2', 'Review assistant'),
          h('span', { class: 'mono-meta dim-text' }, model ?? '')),

        failure ? notice('warn', failure) : null,

        flags.length
          ? h('div', {}, flags.map((flag) =>
              h('div', { class: `ai-flag ai-flag--${flag.severity}` },
                h('span', { class: 'mono-meta' }, flag.kind.replaceAll('_', ' ').toUpperCase()),
                h('span', flag.detail))))
          : null,

        rows.length ? h('div', {}, rows) : (failure ? null : h('div', { class: 'ai-suggestion' },
          h('span', { class: 'mono-meta dim-text' }, 'NO SUGGESTIONS YET'))),

        h('p', { class: 'ai-disclaimer' },
          'ADVISORY ONLY. THE ASSISTANT CANNOT APPROVE, PUBLISH OR CHANGE VISIBILITY. ' +
          'NOTHING HAPPENS UNTIL YOU PRESS PUBLISH, AND THE AUDIT RECORD NAMES ' +
          'YOU — NOT THE ASSISTANT — AS THE DECIDING ADMIN.'),
      );
    }

    const cached = await submissionAi(row.id);
    drawAi(
      cached && Object.keys(cached.suggestions).length ? cached.suggestions as AiSuggestions : null,
      cached?.flags ?? [],
      cached?.model ?? null,
      cached?.error ?? null,
    );

    const preview = h('div', { class: 'preview-box' },
      h('span', { class: 'mono-meta dim-text' }, 'LOADING PREVIEW…'));

    void (async () => {
      if (row.external_url) {
        render(preview, h('div', { style: { padding: '2rem', textAlign: 'center' } },
          h('p', { class: 'mono-meta dim-text' }, 'EXTERNAL LINK'),
          h('a', { href: row.external_url, target: '_blank', rel: 'noopener noreferrer' },
            row.external_url)));
        return;
      }
      if (!row.storage_bucket || !row.storage_path) {
        render(preview, h('span', { class: 'mono-meta dim-text' }, 'NO FILE ATTACHED'));
        return;
      }
      const url = await signedUrl(row.storage_bucket, row.storage_path, 900);
      if (!url) {
        render(preview, h('span', { class: 'mono-meta dim-text' }, 'COULD NOT OPEN THIS FILE'));
        return;
      }
      const mime = row.mime_type ?? '';
      if (mime.startsWith('image/')) {
        render(preview, h('img', { src: url, alt: row.title }));
      } else if (mime === 'application/pdf' || mime === 'text/html') {
        render(preview, h('iframe', { src: url, title: `${row.title} preview`, loading: 'lazy' }));
      } else {
        render(preview, h('div', { style: { padding: '2rem', textAlign: 'center' } },
          h('p', { class: 'mono-meta dim-text' }, (row.mime_type ?? 'FILE').toUpperCase()),
          h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open in a new tab')));
      }
    })();

    const modal = dialog(`Review — ${row.title}`,
      h('div', { class: 'review-split' },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1.25rem' } },
          metaList([
            ['Submitted by', row.member?.full_name ?? '—'],
            ['Email', row.member?.email ?? '—'],
            ['Submitted', archiveDate(row.created_at)],
            ['File', row.file_name ?? (row.external_url ? 'external link' : '—')],
            ['Type', row.mime_type ?? '—'],
            ['Size', fileSize(row.size_bytes)],
            ['Suggested visibility', row.suggested_visibility.toUpperCase()],
            ['Other contributors', row.contributor_names.join(', ') || '—'],
            ['Member notes', row.notes ?? '—'],
          ]),
          preview,
          form,
          historyPanel('archive_submission', row.id, row.submitted_by)),

        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1rem' } },
          aiEnabled
            ? action('Ask the assistant', async () => {
                const result = await requestAiReview(row.id);
                drawAi(result.suggestions as AiSuggestions | null,
                  result.flags as AiFlag[], null, result.error);
                toast(result.error ? 'The assistant had trouble — see the panel.' : 'Suggestions ready.',
                  result.error ? 'err' : 'ok');
              })
            : notice('info',
                'The review assistant is switched off. Turn it on in Administration → ' +
                'Settings once Cloudflare Workers AI is configured.'),
          aiHost)),

      h('div', { class: 'button-row' },
        canPublish
          ? action('Publish to archive', async () => {
              const values = formValues(form);
              const visibility = textOf(values, 'visibility') as ContentVisibility;
              // Overriding the member's own judgement about their material
              // needs an explanation; the database requires one too.
              const override = visibility === 'public'
                && row.suggested_visibility === 'internal';
              const reason = override
                ? checkReason(textOf(values, 'reason'),
                    'publish publicly something submitted as internal')
                : textOf(values, 'reason') || null;
              if (override && !reason) return;

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
            }, 'primary')
          : notice('info', 'Reviewers can request changes or decline. Publishing needs a club admin.'),

        action('Request changes', async () => {
          const values = formValues(form);
          const reason = checkReason(textOf(values, 'reason'), 'ask for changes');
          if (!reason) return;
          await decideSubmission(row.id, 'changes_requested', reason,
            textOf(values, 'internal') || null);
          modal.close();
          toast('Sent back to the member.');
          await draw();
        }),

        action('Decline', async () => {
          const values = formValues(form);
          const reason = checkReason(textOf(values, 'reason'),
            'decline this submission');
          if (!reason) return;
          await decideSubmission(row.id, 'rejected', reason,
            textOf(values, 'internal') || null);
          modal.close();
          toast('Declined.');
          await draw();
        }, 'danger')));
  }

  async function draw(): Promise<void> {
    const rows = await submissionQueue(FILTERS[filter]![1]);
    const projectTitle = new Map(projectList.map((p: Project) => [p.id, p.title]));

    render(content,
      pageHeader('ADMIN / ARCHIVE', 'Archive submissions'),

      h('div', { class: 'browser-toolbar' },
        FILTERS.map(([label], index) =>
          h('button', {
            type: 'button', class: 'btn-ghost',
            style: index === filter
              ? { borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' } : {},
            onclick: () => { filter = index; void draw(); },
          }, label))),

      panel(`${rows.length} in this queue`,
        rows.length
          ? dataTable(['Submitted by', 'Title', 'Project', 'Category', 'Size', 'Wants', 'Status', ''],
              rows.map((row) => [
                h('div', {},
                  h('strong', row.member?.full_name ?? '—'),
                  h('p', { class: 'mono-meta dim-text' }, archiveDate(row.created_at))),
                h('div', {},
                  h('strong', row.title),
                  h('p', { class: 'mono-meta dim-text' },
                    row.file_name ?? row.external_url ?? '')),
                row.project_id ? projectTitle.get(row.project_id) ?? '—' : '—',
                h('span', { class: 'mono-meta' }, (row.category ?? '—').toUpperCase()),
                h('span', { class: 'mono-meta' },
                  row.external_url ? 'LINK' : fileSize(row.size_bytes)),
                h('span', { class: 'mono-meta' }, row.suggested_visibility.toUpperCase()),
                statusPill(row.status),
                h('button', { type: 'button', class: 'link-button',
                  onclick: () => void review(row) }, 'REVIEW'),
              ]))
          : emptyState('This queue is clear.')),

      notice('info',
        'Nothing a member uploads is public until it is published from here. ' +
        'When in doubt about personal information, publish it as internal.'),
    );
  }

  await draw();
}

void start();
