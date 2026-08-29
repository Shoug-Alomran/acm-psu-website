/**
 * Member contributions.
 *
 * A member describes work they did; an admin verifies it. Approved rows stop
 * being editable here — not because the page hides the button, but because the
 * row no longer matches the member's UPDATE policy in the database.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, statusPill, dataTable, loading, dialog, field,
  notice, toast, action, emptyState,
} from '../lib/ui.js';
import { requireMember, canSubmit } from '../lib/session.js';
import {
  myContributions, contributionTypes, projects, saveContribution, uploadPrivate,
} from '../lib/api.js';
import { requireClient } from '../lib/supabase.js';
import { archiveDate, enumLabel } from '../lib/format.js';
import type { Contribution, ContributionType, Project } from '../lib/types.js';

async function start(): Promise<void> {
  const viewer = await requireMember();
  const content = shell(viewer, 'member', 'Contributions');
  render(content, loading());

  const [types, projectList] = await Promise.all([contributionTypes(), projects()]);
  const projectTitle = new Map(projectList.map((p: Project) => [p.id, p.title]));

  function editor(existing: Contribution | null): void {
    const status = h('div');
    const fileInput = h('input', {
      type: 'file',
      accept: '.pdf,.png,.jpg,.jpeg,.webp,.txt,.zip',
    }) as HTMLInputElement;

    const form = h('form', { class: 'portal-form', novalidate: true },
      field({ label: 'Title', name: 'title', required: true, maxlength: 200,
              value: existing?.title,
              placeholder: 'e.g. Built the CTF 3.0 registration site' }),

      h('div', { class: 'field-pair' },
        field({ label: 'Type', name: 'type_slug', type: 'select', required: true,
                value: existing?.type_slug,
                options: types.map((t: ContributionType) => ({ value: t.slug, label: t.label })) }),
        field({ label: 'Related project or event', name: 'project_id', type: 'select',
                value: existing?.project_id ?? '',
                options: [{ value: '', label: '— none —' },
                  ...projectList.map((p: Project) => ({ value: p.id, label: p.title }))] })),

      h('div', { class: 'field-pair' },
        field({ label: 'Your role', name: 'role_text', maxlength: 120, value: existing?.role_text,
                placeholder: 'e.g. Lead developer' }),
        field({ label: 'Date', name: 'occurred_on', type: 'date', value: existing?.occurred_on })),

      field({ label: 'What did you do?', name: 'description', type: 'textarea', rows: 5,
              value: existing?.description,
              hint: 'Enough detail for a reviewer to recognise the work.' }),

      field({ label: 'Links', name: 'links', type: 'textarea', rows: 2,
              value: existing?.links.join('\n'),
              hint: 'One per line. Repository, live page, slides — whatever applies.' }),

      field({ label: 'Note for the reviewer', name: 'member_note', type: 'textarea', rows: 2,
              value: existing?.member_note, hint: 'Optional.' }),

      h('div', { class: 'form-field' },
        h('span', { class: 'mono-meta' }, 'EVIDENCE (OPTIONAL)'),
        h('p', { class: 'field-hint mono-meta dim-text' },
          'A file that shows the work. Stored privately — only you and reviewers can open it.'),
        fileInput),

      status,
    ) as HTMLFormElement;

    const modal = dialog(existing ? 'Edit contribution' : 'Submit a contribution', form,
      h('div', { class: 'button-row' },
        action(existing ? 'Save changes' : 'Submit for verification', async () => {
          if (!form.reportValidity()) return;
          const values = formValues(form);

          const saved = await saveContribution({
            ...(existing ? { id: existing.id } : {}),
            user_id: viewer.userId,
            title: textOf(values, 'title'),
            type_slug: textOf(values, 'type_slug'),
            project_id: textOf(values, 'project_id') || null,
            role_text: textOf(values, 'role_text') || null,
            description: textOf(values, 'description') || null,
            occurred_on: textOf(values, 'occurred_on') || null,
            links: textOf(values, 'links').split('\n').map((l) => l.trim())
              .filter(Boolean).slice(0, 10),
            member_note: textOf(values, 'member_note') || null,
            status: 'submitted',
          });

          const file = fileInput.files?.[0];
          if (file) {
            const upload = await uploadPrivate('evidence', viewer.userId, file);
            const { error } = await requireClient().from('contribution_evidence').insert({
              contribution_id: saved.id,
              storage_bucket: upload.bucket,
              storage_path: upload.path,
              file_name: upload.fileName,
              mime_type: upload.mimeType,
              size_bytes: upload.size,
            });
            if (error) throw new Error(error.message);
          }

          modal.close();
          toast('Sent for verification.');
          await draw();
        }, 'primary')));
  }

  async function draw(): Promise<void> {
    const rows = await myContributions(viewer.userId);
    const editable = (c: Contribution) =>
      ['draft', 'submitted', 'changes_requested'].includes(c.status);

    render(content,
      pageHeader('MEMBER / CONTRIBUTIONS', 'Contributions',
        canSubmit(viewer)
          ? h('button', { type: 'button', class: 'btn-submit', style: { marginTop: '0' },
              onclick: () => editor(null) }, 'Submit a contribution')
          : null),

      notice('info',
        'Describe work you did for the club. An admin reviews it, and once approved it ' +
        'becomes a verified item on your ACM record.'),

      panel('Your submissions',
        rows.length
          ? dataTable(
              ['Title', 'Type', 'Project', 'Date', 'Status', ''],
              rows.map((c) => [
                h('div', {},
                  h('strong', c.title),
                  c.review_note
                    ? h('p', { class: 'mono-meta dim-text' }, `REVIEWER: ${c.review_note}`)
                    : null),
                h('span', { class: 'mono-meta' }, enumLabel(c.type_slug)),
                c.project_id ? projectTitle.get(c.project_id) ?? '—' : '—',
                h('span', { class: 'mono-meta' }, archiveDate(c.occurred_on)),
                statusPill(c.status),
                editable(c)
                  ? h('button', { type: 'button', class: 'link-button',
                      onclick: () => editor(c) }, 'EDIT')
                  : h('span', { class: 'mono-meta dim-text' }, 'LOCKED'),
              ]))
          : emptyState('Nothing submitted yet.',
              'Organised an event? Built something? Ran a workshop? It belongs here.')),

      panel('What counts',
        h('p', 'Anything you did that helped the club run. Some examples:'),
        h('div', { class: 'interest-picker' },
          types.map((t: ContributionType) =>
            h('span', { class: 'tag', style: { marginRight: '0.4rem' } }, t.label)))),
    );
  }

  await draw();
}

void start();
