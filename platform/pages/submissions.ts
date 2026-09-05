/**
 * Archive submissions.
 *
 * Members never write to the public archive. They submit here, an admin
 * reviews, and publishing happens through publish_archive_submission() — the
 * single path from a submission to a published item. That is enforced by row
 * level security, not by this page.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, filterableTable, loading, dialog, field,
  notice, toast, action, emptyState,
} from '../lib/ui.js';
import { requireParticipant, canSubmit } from '../lib/session.js';
import {
  mySubmissions, archiveCategories, projects, archiveFolders, uploadPrivate,
} from '../lib/api.js';
import { requireClient } from '../lib/supabase.js';
import { archiveDate, fileSize } from '../lib/format.js';
import type { ArchiveCategory, ArchiveFolder, ArchiveSubmission, Project } from '../lib/types.js';

async function start(): Promise<void> {
  const viewer = await requireParticipant();
  const content = shell(viewer, 'member', 'Archive submissions');
  render(content, loading());

  const [categories, projectList, folders] = await Promise.all([
    archiveCategories(), projects(), archiveFolders(),
  ]);

  function submissionForm(original?: ArchiveSubmission): void {
    const status = h('div');
    const fileInput = h('input', {
      type: 'file',
      accept: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.png,.jpg,.jpeg,.webp,.gif,.html,.txt,.md,.csv',
    }) as HTMLInputElement;

    const projectSelect = field({
      label: 'Project or event', name: 'project_id', type: 'select', required: true,
      options: [{ value: '', label: 'Select…' },
        ...projectList.map((p: Project) => ({ value: p.id, label: p.title }))],
    });

    const folderSelect = field({
      label: 'Suggested folder', name: 'folder_id', type: 'select',
      options: [{ value: '', label: '— let the reviewer decide —' }],
      hint: 'Optional. Reviewers can move it anywhere.',
    });

    // Only offer folders belonging to the chosen project.
    projectSelect.querySelector('select')!.addEventListener('change', (event) => {
      const projectId = (event.target as HTMLSelectElement).value;
      const select = folderSelect.querySelector('select')!;
      select.replaceChildren(h('option', { value: '' }, '— let the reviewer decide —'));
      for (const folder of folders.filter((f: ArchiveFolder) => f.project_id === projectId)) {
        select.appendChild(h('option', { value: folder.id }, folder.name));
      }
    });

    const form = h('form', { class: 'portal-form', novalidate: true },
      field({ label: 'Title', name: 'title', required: true, maxlength: 200,
              placeholder: 'e.g. Day 2 workshop handout' }),

      h('div', { class: 'field-pair' }, projectSelect,
        field({ label: 'Category', name: 'category', type: 'select', required: true,
                options: [{ value: '', label: 'Select…' },
                  ...categories.map((c: ArchiveCategory) => ({ value: c.slug, label: c.label }))] })),

      folderSelect,

      field({ label: 'Description', name: 'description', type: 'textarea', rows: 3,
              hint: 'What is it, and what was it for? This becomes the archive description.' }),

      h('div', { class: 'form-field' },
        h('span', { class: 'mono-meta' }, 'FILE'),
        h('p', { class: 'field-hint mono-meta dim-text' },
          'PDF, DOCX, PPTX, XLSX, ZIP, image, or HTML. Leave empty if you are submitting a link.'),
        fileInput),

      field({ label: 'Or a link', name: 'external_url', type: 'url',
              placeholder: 'https://github.com/… or any public URL' }),

      h('div', { class: 'field-pair' },
        field({ label: 'Other contributors', name: 'contributor_names',
                hint: 'Comma separated. You are credited automatically.' }),
        field({ label: 'Date', name: 'occurred_on', type: 'date' })),

      field({
        label: 'Suggested visibility', name: 'suggested_visibility', type: 'select',
        value: 'internal',
        options: [
          { value: 'internal', label: 'Internal — members and admins only' },
          { value: 'public', label: 'Public — anyone on the website' },
        ],
        hint: 'A suggestion only. The reviewer makes the final call, and anything ' +
              'containing student IDs or personal details stays internal.',
      }),

      field({ label: 'Notes for the reviewer', name: 'notes', type: 'textarea', rows: 2 }),
      original ? field({ label: 'Why are you updating this submission?', name: 'update_reason', type: 'textarea', required: true, maxlength: 1500, rows: 3, hint: 'Explain what changed and why so the reviewer can assess this revision.' }) : null,
      status,
    ) as HTMLFormElement;

    if (original) {
      const initial: Record<string, string> = {
        title: original.title, project_id: original.project_id ?? '', category: original.category ?? '',
        description: original.description ?? '', external_url: original.external_url ?? '',
        contributor_names: original.contributor_names.join(', '), occurred_on: original.occurred_on ?? '',
        suggested_visibility: original.suggested_visibility,
      };
      for (const [name, value] of Object.entries(initial)) {
        const input = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
        if (input) input.value = value;
      }
      projectSelect.querySelector('select')!.dispatchEvent(new Event('change'));
      folderSelect.querySelector('select')!.value = original.folder_id ?? '';
      form.prepend(notice('info', 'This creates a new revision for review. Your original submission and any published version stay unchanged until a reviewer handles the update.'),
        notice('info', original.file_name ? `Current file: ${original.file_name}. Leave the file input empty to keep it, or choose a replacement.` : 'Update the link or attach a replacement file.'));
    }

    const modal = dialog(original ? 'Update archive submission' : 'Submit to the archive', form,
      h('div', { class: 'button-row' },
        action(original ? 'Send updated revision for review' : 'Submit for review', async () => {
          if (!form.reportValidity()) return;
          const values = formValues(form);
          const file = fileInput.files?.[0];
          const url = textOf(values, 'external_url');

          const reason = textOf(values, 'update_reason').trim();
          if (original && !reason) {
            status.replaceChildren(notice('err', 'Explain why you are updating this submission.'));
            return;
          }

          if (!file && !url && !original?.storage_path) {
            status.replaceChildren(notice('err', 'Attach a file or provide a link.'));
            return;
          }

          const upload = file
            ? await uploadPrivate('submissions', viewer.userId, file)
            : null;

          const { error } = await requireClient().from('archive_submissions').insert({
            submitted_by: viewer.userId,
            project_id: textOf(values, 'project_id') || null,
            folder_id: textOf(values, 'folder_id') || null,
            title: textOf(values, 'title'),
            category: textOf(values, 'category') || null,
            description: textOf(values, 'description') || null,
            occurred_on: textOf(values, 'occurred_on') || null,
            notes: original
              ? `REVISION OF: ${original.id}\nOriginal title: ${original.title}\nReason for update: ${reason}\n\n${textOf(values, 'notes')}`
              : textOf(values, 'notes') || null,
            storage_bucket: upload?.bucket ?? (url ? null : original?.storage_bucket ?? null),
            storage_path: upload?.path ?? (url ? null : original?.storage_path ?? null),
            external_url: file ? null : url || null,
            file_name: upload?.fileName ?? (url ? null : original?.file_name ?? null),
            mime_type: upload?.mimeType ?? (url ? null : original?.mime_type ?? null),
            size_bytes: upload?.size ?? (url ? null : original?.size_bytes ?? null),
            contributor_names: textOf(values, 'contributor_names')
              .split(',').map((n) => n.trim()).filter(Boolean),
            suggested_visibility: textOf(values, 'suggested_visibility'),
            status: 'submitted',
          });

          if (error) throw new Error(error.message);

          modal.close();
          toast(original ? 'Updated revision sent for review.' : 'Submitted for review.');
          await draw();
        }, 'primary')));
  }

  async function draw(): Promise<void> {
    const rows = await mySubmissions(viewer.userId);
    const projectTitle = new Map(projectList.map((p: Project) => [p.id, p.title]));

    render(content,
      pageHeader('MEMBER / ARCHIVE', 'Archive submissions',
        canSubmit(viewer)
          ? h('button', { type: 'button', class: 'btn-submit', style: { marginTop: '0' },
              onclick: () => submissionForm() }, 'Submit a file')
          : null),

      notice('info',
        'Files you submit are reviewed before they appear anywhere. Nothing you upload ' +
        'here is public until an admin publishes it.'),

      panel('Your submissions',
        rows.length
          ? filterableTable(
              ['Title', 'Project', 'Category', 'Size', 'Submitted', 'Status', 'Actions'],
              rows.map((s) => [
                h('div', {},
                  h('strong', s.title),
                  s.notes?.startsWith('REVISION OF:')
                    ? h('p', { class: 'field-hint', style: { whiteSpace: 'pre-wrap' } }, s.notes)
                    : null,
                  s.review_note
                    ? h('p', { class: 'mono-meta dim-text' }, `REVIEWER: ${s.review_note}`)
                    : null),
                s.project_id ? projectTitle.get(s.project_id) ?? '—' : '—',
                h('span', { class: 'mono-meta' }, (s.category ?? '—').toUpperCase()),
                h('span', { class: 'mono-meta' },
                  s.external_url ? 'LINK' : fileSize(s.size_bytes)),
                h('span', { class: 'mono-meta' }, archiveDate(s.created_at)),
                statusPill(s.status),
                canSubmit(viewer) ? h('button', { type: 'button', class: 'btn-ghost', onclick: () => submissionForm(s) }, 'Update submission') : null,
              ]))
          : emptyState('Nothing submitted yet.',
              'Workshop material, posters, reports, planning documents and source code ' +
              'all belong in the archive.')),
    );
  }

  await draw();
}

void start();
