/** Club organization position catalogue and assignment controls. */
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
import { enumLabel, term } from '../lib/format.js';
import type { Position } from '../lib/types.js';

interface Holder {
  user_id: string;
  title_snapshot: string;
  started_on: string;
  ended_on: string | null;
  position_id: string | null;
  member: { full_name: string } | null;
}

const CATEGORIES = [
  { value: 'executive', label: 'Executive committee' },
  { value: 'lead', label: 'Club leadership' },
  { value: 'committee', label: 'Committee role' },
  { value: 'general', label: 'General club role' },
];

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

function membershipLabel(member: MemberRow): string {
  return enumLabel(member.membership?.status ?? 'applicant');
}

function mayHoldClubPosition(member: MemberRow): boolean {
  return member.account_state === 'active' && member.membership?.status === 'active';
}

async function start(): Promise<void> {
  const viewer = await requireAdmin('club_admin');
  const content = shell(viewer, 'admin', 'Club Organization');

  function editor(existing: Position | null): void {
    const form = h('form', { class: 'portal-form', novalidate: true },
      h('div', { class: 'field-pair' },
        field({ label: 'Title', name: 'title', required: true, maxlength: 80, value: existing?.title }),
        field({ label: 'Title (Arabic)', name: 'title_ar', maxlength: 80, value: existing?.title_ar }),
      ),
      h('div', { class: 'field-pair' },
        field({
          label: 'Organization level', name: 'category', type: 'select',
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
      existing ? `Edit — ${existing.title}` : 'New club role',
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
            toast(existing ? 'Club role updated.' : 'Club role created.');
            await draw();
          } catch (error) {
            console.error('Could not save club role:', error);
            toast(`Could not save club role: ${errorMessage(error)}`, 'err');
          }
        }, 'primary'),
      ),
    );
  }

  function assignmentDialog(position: Position, allUsers: MemberRow[]): void {
    if (!allUsers.length) {
      toast('There are no accounts to display.', 'err');
      return;
    }

    const eligible = allUsers.filter(mayHoldClubPosition);
    let selectedId = eligible[0]?.id ?? '';
    const today = new Date().toISOString().slice(0, 10);

    const searchInput = h('input', {
      type: 'search',
      placeholder: 'Search by name, email, student ID or current role…',
      'aria-label': 'Search accounts',
      style: {
        width: '100%',
        padding: '0.85rem 1rem',
        background: '#0d0d12',
        border: '1px solid var(--border-color)',
        color: 'var(--text-main)',
        font: 'inherit',
      },
    }) as HTMLInputElement;

    const selectedSummary = h('div', {
      class: 'mono-meta',
      style: {
        minHeight: '2.5rem',
        padding: '0.75rem 1rem',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-surface-hover)',
      },
    });

    const list = h('div', {
      role: 'listbox',
      'aria-label': 'Club accounts',
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
        gap: '0.65rem',
        maxHeight: '24rem',
        overflowY: 'auto',
        padding: '0.25rem',
      },
    });

    function renderPeople(query = ''): void {
      const normalized = query.trim().toLowerCase();
      const visible = allUsers.filter((member) => {
        const haystack = [
          member.full_name,
          member.email,
          member.student_id ?? '',
          member.current_position ?? '',
          membershipLabel(member),
        ].join(' ').toLowerCase();
        return !normalized || haystack.includes(normalized);
      });

      list.replaceChildren(...visible.map((member) => {
        const allowed = mayHoldClubPosition(member);
        const selected = member.id === selectedId;
        const status = membershipLabel(member);
        const detail = [
          member.email,
          member.student_id ? `ID ${member.student_id}` : null,
          member.current_position ? `Current: ${member.current_position}` : null,
        ].filter(Boolean).join(' · ');

        return h('button', {
          type: 'button',
          role: 'option',
          'aria-selected': String(selected),
          disabled: !allowed,
          onclick: () => {
            if (!allowed) return;
            selectedId = member.id;
            renderPeople(searchInput.value);
            selectedSummary.replaceChildren(
              h('strong', member.full_name),
              h('span', { style: { marginLeft: '0.65rem', color: 'var(--text-muted)' } },
                `selected for ${position.title}`),
            );
          },
          style: {
            textAlign: 'left',
            padding: '0.9rem 1rem',
            minHeight: '6.25rem',
            border: selected ? '1px solid var(--accent-blue)' : '1px solid var(--border-color)',
            background: selected ? 'var(--accent-blue-dim)' : 'var(--bg-surface)',
            color: allowed ? 'var(--text-main)' : 'var(--text-dark)',
            cursor: allowed ? 'pointer' : 'not-allowed',
            opacity: allowed ? '1' : '0.55',
          },
        },
          h('strong', { style: { display: 'block', marginBottom: '0.35rem' } }, member.full_name),
          h('span', { class: 'mono-meta', style: { display: 'block', marginBottom: '0.45rem' } }, detail || 'No account details'),
          h('span', { class: 'mono-meta' },
            allowed
              ? `MEMBERSHIP: ${status.toUpperCase()}`
              : `MEMBERSHIP: ${status.toUpperCase()} — activate in Members before assigning a club role`),
        );
      }));

      if (!visible.length) {
        list.replaceChildren(h('p', { class: 'mono-meta dim-text' }, 'No accounts match this search.'));
      }
    }

    searchInput.addEventListener('input', () => renderPeople(searchInput.value));
    renderPeople();

    if (selectedId) {
      const selected = allUsers.find((member) => member.id === selectedId);
      if (selected) selectedSummary.replaceChildren(
        h('strong', selected.full_name),
        h('span', { style: { marginLeft: '0.65rem', color: 'var(--text-muted)' } },
          `selected for ${position.title}`),
      );
    } else {
      selectedSummary.replaceChildren('No active member is currently eligible. Activate an applicant from Members first.');
    }

    const dateField = field({
      label: 'Effective date', name: 'effective_on', type: 'date', required: true, value: today,
    });
    const reason = field({
      label: 'Reason / note', name: 'reason', type: 'textarea', rows: 3,
      hint: 'Optional. Stored with the official club position change.',
    });

    const body = h('div', { class: 'portal-form' },
      notice('info',
        `This assigns an official ACM club organization role: ${position.title}. Event and competition work is separate and belongs under Projects & Events → event positions.`),
      h('div', {},
        h('div', { class: 'mono-meta', style: { marginBottom: '0.5rem' } },
          `ALL ACCOUNTS (${allUsers.length}) · ELIGIBLE ACTIVE MEMBERS (${eligible.length})`),
        searchInput,
      ),
      list,
      selectedSummary,
      h('div', { class: 'field-pair' }, dateField, reason),
    );

    const modal = dialog(
      `Assign club role — ${position.title}`,
      body,
      h('div', { class: 'button-row' },
        action('Assign member', async () => {
          if (!selectedId) {
            toast('Choose an active member first.', 'err');
            return;
          }
          const dateInput = dateField.querySelector('input') as HTMLInputElement | null;
          const reasonInput = reason.querySelector('textarea') as HTMLTextAreaElement | null;
          const effectiveOn = dateInput?.value || today;
          try {
            await grantPosition(selectedId, position.id, effectiveOn, reasonInput?.value.trim() || null);
            modal.close();
            toast(`${position.title} assigned.`);
            await draw();
          } catch (error) {
            console.error('Could not assign club role:', error);
            toast(`Could not assign club role: ${errorMessage(error)}`, 'err');
          }
        }, 'primary'),
      ),
    );

    modal.style.width = 'min(72rem, calc(100vw - 3rem))';
    modal.style.maxWidth = '72rem';
    modal.style.margin = 'auto';
  }

  async function draw(): Promise<void> {
    render(content, loading());
    try {
      const [all, current, allUsers] = await Promise.all([
        positions(true),
        holders(),
        members('', ''),
      ]);

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
        pageHeader('ADMIN / CLUB ORGANIZATION', 'Club organization roles',
          h('button', {
            type: 'button', class: 'btn-submit', style: { marginTop: '0' },
            onclick: () => editor(null),
          }, 'New club role'),
        ),
        notice('info',
          'This page is only for standing ACM organization roles such as President, Vice President, committee leads and club officers. Event jobs such as CTF organizer, Programming Jam volunteer, registration, judging or workshop support belong under Projects & Events as event positions that members can sign up for.'),
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
        panel('Club organization catalogue',
          all.length ? dataTable(
            ['Club role', 'Organization level', 'Rank', 'Currently held by', 'State', ''],
            all.map((position) => {
              const held = byPosition.get(position.id) ?? [];
              const categoryLabel = CATEGORIES.find((category) => category.value === position.category)?.label
                ?? enumLabel(position.category);
              return [
                h('div', {},
                  h('strong', position.title),
                  position.description ? h('p', { class: 'mono-meta dim-text' }, position.description) : null,
                ),
                h('span', { class: 'mono-meta' }, categoryLabel.toUpperCase()),
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
                    ? action('ASSIGN', async () => assignmentDialog(position, allUsers), 'primary')
                    : null,
                  h('button', { type: 'button', class: 'link-button', onclick: () => editor(position) }, 'EDIT'),
                  action(position.is_active ? 'ARCHIVE' : 'RESTORE', async () => {
                    try {
                      const { error } = await requireClient().from('positions').update({
                        is_active: !position.is_active,
                        archived_at: position.is_active ? new Date().toISOString() : null,
                      }).eq('id', position.id);
                      if (error) throw new Error(error.message);
                      toast(position.is_active ? 'Club role archived.' : 'Club role restored.');
                      await draw();
                    } catch (error) {
                      console.error('Could not change club role state:', error);
                      toast(`Could not update club role: ${errorMessage(error)}`, 'err');
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
          ) : emptyState('No club organization roles defined.'),
        ),
      );
    } catch (error) {
      console.error('Club organization page failed to load:', error);
      render(content,
        pageHeader('ADMIN / CLUB ORGANIZATION', 'Club organization unavailable'),
        notice('err', `The club role catalogue could not load: ${errorMessage(error)}`),
        h('div', { class: 'button-row' },
          h('button', { type: 'button', class: 'btn-ghost', onclick: () => void draw() }, 'TRY AGAIN'),
        ),
      );
    }
  }

  await draw();
}

void start();
