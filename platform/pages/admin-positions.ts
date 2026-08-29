/**
 * Position catalogue.
 *
 * Positions are data, not code, so a future committee can invent "Outreach
 * Lead" without anyone touching this repository. Archiving a position keeps
 * every historical record that referenced it intact — position_history stores
 * the title as it was at the time.
 */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, dataTable, loading, dialog, field, notice, toast,
  action, emptyState, statusPill,
} from '../lib/ui.js';
import { requireAdmin } from '../lib/session.js';
import { positions } from '../lib/api.js';
import { requireClient } from '../lib/supabase.js';
import { term } from '../lib/format.js';
import type { Position } from '../lib/types.js';

interface Holder { user_id: string; title_snapshot: string; started_on: string;
                   ended_on: string | null; position_id: string | null;
                   member: { full_name: string } | null }

const CATEGORIES = ['executive', 'lead', 'committee', 'general']
  .map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }));

async function holders(): Promise<Holder[]> {
  const { data } = await requireClient().from('position_history')
    .select('user_id, title_snapshot, started_on, ended_on, position_id, member:app_users!position_history_user_id_fkey(full_name)')
    .is('ended_on', null);
  return (data ?? []) as unknown as Holder[];
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

async function start(): Promise<void> {
  const viewer = await requireAdmin('club_admin');
  const content = shell(viewer, 'admin', 'Positions');
  render(content, loading());

  function editor(existing: Position | null): void {
    const form = h('form', { class: 'portal-form', novalidate: true },
      h('div', { class: 'field-pair' },
        field({ label: 'Title', name: 'title', required: true, maxlength: 80,
                value: existing?.title }),
        field({ label: 'Title (Arabic)', name: 'title_ar', maxlength: 80,
                value: existing?.title_ar })),
      h('div', { class: 'field-pair' },
        field({ label: 'Category', name: 'category', type: 'select',
                value: existing?.category ?? 'general', options: CATEGORIES }),
        field({ label: 'Display rank', name: 'rank', type: 'number',
                value: String(existing?.rank ?? 100),
                hint: 'Lower sorts first. Executive roles use small numbers.' })),
      field({ label: 'Description', name: 'description', type: 'textarea', rows: 3,
              value: existing?.description }),
    ) as HTMLFormElement;

    const modal = dialog(existing ? `Edit — ${existing.title}` : 'New position', form,
      h('div', { class: 'button-row' },
        action(existing ? 'Save' : 'Create', async () => {
          if (!form.reportValidity()) return;
          const values = formValues(form);
          const title = textOf(values, 'title');

          const patch = {
            title,
            title_ar: textOf(values, 'title_ar') || null,
            category: textOf(values, 'category'),
            rank: Number(textOf(values, 'rank')) || 100,
            description: textOf(values, 'description') || null,
          };

          const client = requireClient();
          if (existing) {
            // The positions table carries an audit trigger, so the change and
            // its record are one transaction — nothing to write from here.
            const { error } = await client.from('positions').update(patch).eq('id', existing.id);
            if (error) throw new Error(error.message);
          } else {
            const { data, error } = await client.from('positions')
              .insert({ ...patch, slug: slugify(title) }).select('id').single();
            if (error) throw new Error(error.message);
            void data;
          }

          modal.close();
          toast('Saved.');
          await draw();
        }, 'primary')));
  }

  async function draw(): Promise<void> {
    const [all, current] = await Promise.all([positions(true), holders()]);

    const byPosition = new Map<string, Holder[]>();
    for (const holder of current) {
      if (!holder.position_id) continue;
      const list = byPosition.get(holder.position_id) ?? [];
      list.push(holder);
      byPosition.set(holder.position_id, list);
    }

    render(content,
      pageHeader('ADMIN / POSITIONS', 'ACM positions',
        h('button', { type: 'button', class: 'btn-submit', style: { marginTop: '0' },
          onclick: () => editor(null) }, 'New position')),

      notice('info',
        'Archiving a position hides it from new grants. Everyone who has ever held it ' +
        'keeps that entry in their history — the title is stored on the record itself.'),

      panel('Catalogue',
        all.length
          ? dataTable(
              ['Position', 'Category', 'Rank', 'Currently held by', 'State', ''],
              all.map((position) => {
                const held = byPosition.get(position.id) ?? [];
                return [
                  h('div', {},
                    h('strong', position.title),
                    position.description
                      ? h('p', { class: 'mono-meta dim-text' }, position.description)
                      : null),
                  h('span', { class: 'mono-meta' }, position.category.toUpperCase()),
                  h('span', { class: 'mono-meta' }, String(position.rank)),
                  held.length
                    ? h('div', {}, held.map((holder) =>
                        h('p', {},
                          holder.member?.full_name ?? '—', ' ',
                          h('span', { class: 'mono-meta dim-text' },
                            term(holder.started_on, holder.ended_on)))))
                    : h('span', { class: 'mono-meta dim-text' }, 'VACANT'),
                  statusPill(position.is_active ? 'active' : 'inactive'),
                  h('div', { class: 'button-row' },
                    h('button', { type: 'button', class: 'link-button',
                      onclick: () => editor(position) }, 'EDIT'),
                    action(position.is_active ? 'ARCHIVE' : 'RESTORE', async () => {
                      const { error } = await requireClient().from('positions').update({
                        is_active: !position.is_active,
                        archived_at: position.is_active ? new Date().toISOString() : null,
                      }).eq('id', position.id);
                      if (error) throw new Error(error.message);
                      toast('Updated.');
                      await draw();
                    })),
                ];
              }))
          : emptyState('No positions defined.')),
    );
  }

  await draw();
}

void start();
