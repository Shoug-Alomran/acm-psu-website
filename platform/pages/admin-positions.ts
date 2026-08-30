/** Position catalogue and assignment controls. */
import { h, render, formValues, textOf } from '../lib/dom.js';
import {
  shell, pageHeader, panel, dataTable, loading, dialog, field, notice, toast,
  action, emptyState, stateTag, attentionPill, attentionRow, attentionLegend,
  type Attention,
} from '../lib/ui.js';
import { requireAdmin } from '../lib/session.js';
import { positions } from '../lib/api.js';
import { members, grantPosition, type MemberRow } from '../lib/admin.js';
import { requireClient } from '../lib/supabase.js';
import { term } from '../lib/format.js';
import type { Position } from '../lib/types.js';

interface Holder {
  user_id: string;
  title_snapshot: string;
  started_on: string;
  ended_on: string | null;
  position_id: string | null;
  member: { full_name: string } | null;
}

const CATEGORIES = ['executive', 'lead', 'committee', 'general'].map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error &&
      typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return 'An unknown error occurred.';
}

async function holders(): Promise<Holder[]> {
  const { data, error } = await requireClient()
    .from('position_history')
    .select(`
      user_id,
      title_snapshot,
      started_on,
      ended_on,
      position_id,
      member:app_users!position_history_user_id_fkey(full_name)
    `)
    .is('ended_on', null);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Holder[];
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function vacancy(position: Position): Attention {
  if (!position.is_active) return 'idle';
  return position.category === 'executive' || position.category === 'lead' ? 'now' : 'review';
}

async function start(): Promise<void> {
  const viewer = await requireAdmin('club_admin');
  const content = shell(viewer, 'admin', 'Positions');

  function editor(existing: Position | null): void {
    const form = h('form', { class: 'portal-form', novalidate: true },
      h('div', { class: 'field-pair' },
        field({ label: 'Title', name: 'title', required: true, maxlength: 80, value: existing?.title }),
        field({ label: 'Title (Arabic)', name: 'title_ar', maxlength: 80, value: existing?.title_ar }),
      ),
      h('div', { class: 'field-pair' },
        field({
          label: 'Category', name: 'category', type: 'select',
          value: existing?.category ?? 'general', options: CATEGORIES,
        }),
        field({
          label: 'Display rank', name: 'rank', type: 'number',
          value: String(existing?.rank ?? 100),
          hint: 'Lower sorts first. Executive roles use small numbers.',
        }),
      ),
      field({
        label: 'Description', name: 'description', type: 'textarea', rows: 3,
        value: existing?.description,
      }),
    ) as HTMLFormElement;

    const modal = dialog(
      existing ? `Edit — ${existing.title}` : 'New position',
      form,
      h('div', { class: 'button-row' },
        action(existing ? 'Save' : 'Create', async () => {
          if (!form.reportValidity()) return;
          const values = formValues(form);
          const title = textOf(values, 'title').trim();
          if (!title) { toast('Enter a position title.', 'err'); return; }
          const rawRank = Number(textOf(values, 'rank'));
          const patch = {
            title,
            title_ar: textOf(values, 'title_ar') || null,
            category: textOf(values, 'category'),
            rank: Number.isFinite(rawRank) ? rawRank : 100,
            description: textOf(values, 'description') || null,
          };
          try {
            const client = requireClient();
            if (existing) {
              const { error } = await client.from('positions').update(patch).eq('id', existing.id);
              if (error) throw new Error(error.message);
            } else {
              const slug = slugify(title);
              if (!slug) { toast('The title must contain at least one letter or number.', 'err'); return; }
              const { error } = await client.from('positions').insert({ ...patch, slug }).select('id').single();
              if (error) throw new Error(error.message);
            }
            modal.close();
            toast(existing ? 'Position updated.' : 'Position created.');
            await draw();
          } catch (error) {
            console.error('Could not save position:', error);
            toast(`Could not save position: ${errorMessage(error)}`, 'err');
          }
        }, 'primary'),
      ),
    );
  }

  function assignmentDialog(position: Position, candidates: MemberRow[]): void {
    if (!candidates.length) {
      toast('There are no active members available to assign.', 'err');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const form = h('form', { class: 'portal-form' },
      notice('info', `Choose an active member to assign as ${position.title}. The change is added to their official position history.`),
      field({
        label: 'Member',
        name: 'member_id',
        type: 'select',
        required: true,
        value: candidates[0]?.id ?? '',
        options: candidates.map((member) => ({
          value: member.id,
          label: `${member.full_name} — ${member.email}${member.current_position ? ` · currently ${member.current_position}` : ''}`,
        })),
      }),
      field({ label: 'Effective date', name: 'effective_on', type: 'date', required: true, value: today }),
      field({
        label: 'Reason / note', name: 'reason', type: 'textarea', rows: 3,
        hint: 'Optional. Stored with the official position change.',
      }),
    ) as HTMLFormElement;

    const modal = dialog(
      `Assign — ${position.title}`,
      form,
      h('div', { class: 'button-row' },
        action('Assign member', async () => {
          if (!form.reportValidity()) return;
          const values = formValues(form);
          const memberId = textOf(values, 'member_id');
          const effectiveOn = textOf(values, 'effective_on');
          if (!memberId || !effectiveOn) return;
          try {
            await grantPosition(memberId, position.id, effectiveOn, textOf(values, 'reason').trim() || null);
            modal.close();
            toast(`${position.title} assigned.`);
            await draw();
          } catch (error) {
            console.error('Could not assign position:', error);
            toast(`Could not assign position: ${errorMessage(error)}`, 'err');
          }
        }, 'primary'),
      ),
    );
  }

  async function draw(): Promise<void> {
    render(content, loading());
    try {
      const [all, current, activeMembers] = await Promise.all([
        positions(true),
        holders(),
        members('', 'active'),
      ]);

      const candidates = activeMembers.filter((member) => member.account_state === 'active');
      const byPosition = new Map<string, Holder[]>();
      for (const holder of current) {
        if (!holder.position_id) continue;
        const list = byPosition.get(holder.position_id) ?? [];
        list.push(holder);
        byPosition.set(holder.position_id, list);
      }

      const vacantLeadership = all.filter((position) =>
        position.is_active && vacancy(position) === 'now' && !(byPosition.get(position.id) ?? []).length,
      );

      render(content,
        pageHeader('ADMIN / POSITIONS', 'ACM positions',
          h('button', {
            type: 'button', class: 'btn-submit', style: { marginTop: '0' },
            onclick: () => editor(null),
          }, 'New position'),
        ),
        h('div', { class: 'position-summary' },
          h('p', { class: 'queue-summary' },
            vacantLeadership.length
              ? `${vacantLeadership.length} leadership ${vacantLeadership.length === 1 ? 'seat is' : 'seats are'} empty — ${vacantLeadership.map((p) => p.title).join(', ')}. Use ASSIGN beside any vacant role.`
              : 'Every active leadership seat is filled.',
          ),
          attentionLegend(
            ['now', 'Empty leadership seat'], ['review', 'Empty committee seat'],
            ['ok', 'Filled'], ['idle', 'Archived'],
          ),
        ),
        notice('info',
          'Vacant roles can be assigned directly from this page. Archiving hides a position from new grants but keeps every historical record.'),
        panel('Catalogue',
          all.length ? dataTable(
            ['Position', 'Category', 'Rank', 'Currently held by', 'State', ''],
            all.map((position) => {
              const held = byPosition.get(position.id) ?? [];
              return [
                h('div', {},
                  h('strong', position.title),
                  position.description ? h('p', { class: 'mono-meta dim-text' }, position.description) : null,
                ),
                h('span', { class: 'mono-meta' }, position.category.toUpperCase()),
                h('span', { class: 'mono-meta' }, String(position.rank)),
                held.length
                  ? h('div', { class: 'holder-list' }, held.map((holder) =>
                      h('p', {},
                        h('strong', holder.member?.full_name ?? '—'), ' ',
                        h('span', { class: 'mono-meta dim-text' }, term(holder.started_on, holder.ended_on)),
                      ),
                    ))
                  : attentionPill(vacancy(position), 'Vacant'),
                stateTag(position.is_active ? 'Active' : 'Archived', !position.is_active),
                h('div', { class: 'button-row' },
                  position.is_active && !held.length
                    ? action('ASSIGN', async () => assignmentDialog(position, candidates), 'primary')
                    : null,
                  h('button', { type: 'button', class: 'link-button', onclick: () => editor(position) }, 'EDIT'),
                  action(position.is_active ? 'ARCHIVE' : 'RESTORE', async () => {
                    try {
                      const { error } = await requireClient().from('positions').update({
                        is_active: !position.is_active,
                        archived_at: position.is_active ? new Date().toISOString() : null,
                      }).eq('id', position.id);
                      if (error) throw new Error(error.message);
                      toast(position.is_active ? 'Position archived.' : 'Position restored.');
                      await draw();
                    } catch (error) {
                      console.error('Could not change position state:', error);
                      toast(`Could not update position: ${errorMessage(error)}`, 'err');
                    }
                  }),
                ),
              ];
            }),
            {
              rowClass: (index) => {
                const position = all[index];
                if (!position) return '';
                const held = byPosition.get(position.id) ?? [];
                return attentionRow(held.length ? 'ok' : vacancy(position));
              },
            },
          ) : emptyState('No positions defined.'),
        ),
      );
    } catch (error) {
      console.error('Positions page failed to load:', error);
      render(content,
        pageHeader('ADMIN / POSITIONS', 'Positions unavailable'),
        notice('err', `The position catalogue could not load: ${errorMessage(error)}`),
        h('div', { class: 'button-row' },
          h('button', { type: 'button', class: 'btn-ghost', onclick: () => void draw() }, 'TRY AGAIN'),
        ),
      );
    }
  }

  await draw();
}

void start();
