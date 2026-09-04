/**
 * Shared rendering for audit history.
 *
 * Used by the global audit page, by the History panel on individual admin
 * records, and by the member-facing decision list. Keeping them in one file
 * means an entry reads identically wherever it appears.
 */
import { h, render, type Child } from './dom.js';
import { archiveDateTime, archiveDate, enumLabel } from './format.js';
import { panel, emptyState, loading, statusPill } from './ui.js';
import {
  actorLine, fieldChanges, recordHistory, CATEGORY_LABELS, DECISION_LABELS,
} from './audit.js';
import type { AuditEntry, MemberDecision } from './types.js';

/** "Position   Member → Events Coordinator" */
export function changeList(entry: AuditEntry): HTMLElement | null {
  const changes = fieldChanges(entry);
  if (!changes.length) return null;

  return h('div', { class: 'change-list' },
    changes.map((change) => h('div', { class: 'change-row' },
      h('span', { class: 'mono-meta' }, change.field.toUpperCase()),
      h('span', { class: 'change-before' }, change.before),
      h('span', { class: 'change-arrow', 'aria-hidden': 'true' }, '→'),
      h('span', { class: 'change-after' }, change.after))));
}

export function decisionPill(entry: { decision: string | null }): HTMLElement | null {
  if (!entry.decision) return null;
  return statusPill(entry.decision);
}

/**
 * One entry in a vertical activity trail. Deliberately shows the actor's
 * position as it was, not as it is now.
 */
export function historyEntry(entry: AuditEntry, options: { compact?: boolean } = {}): HTMLElement {
  const isAi = entry.actor_kind === 'ai_assistant';

  return h('div', { class: `history-entry${isAi ? ' history-entry--ai' : ''}` },
    h('div', { class: 'history-entry-head' },
      h('span', { class: 'mono-meta' }, archiveDateTime(entry.created_at)),
      decisionPill(entry)),

    h('div', {},
      h('strong', entry.summary || enumLabel(entry.action)),
      h('p', { class: 'mono-meta dim-text' }, actorLine(entry)),

      entry.reason
        ? h('p', { class: 'history-reason' },
            h('span', { class: 'mono-meta dim-text' }, 'REASON  '), entry.reason)
        : null,

      !options.compact && entry.internal_note
        ? h('p', { class: 'history-internal' },
            h('span', { class: 'mono-meta' }, 'INTERNAL  '), entry.internal_note)
        : null,

      options.compact ? null : changeList(entry)));
}

/**
 * The History section for an individual record page.
 *
 * Loads asynchronously and renders into its own panel, so an admin never has
 * to leave the record to find out what happened to it.
 */
export function historyPanel(
  entityType: string, entityId: string, memberId?: string | null,
): HTMLElement {
  const body = h('div', {}, loading('LOADING ACTIVITY'));
  const host = panel('Activity', body);

  void (async () => {
    try {
      const entries = await recordHistory(entityType, entityId, memberId ?? null);
      render(body,
        entries.length
          ? h('div', { class: 'history-trail' }, entries.map((e) => historyEntry(e)))
          : emptyState('No recorded activity for this record yet.'));
    } catch (error) {
      render(body, h('p', { class: 'mono-meta dim-text' },
        error instanceof Error ? error.message.toUpperCase() : 'COULD NOT LOAD ACTIVITY'));
    }
  })();

  return host;
}

/**
 * The member-facing list.
 *
 * Reads from my_decision_history, which selects an allow-list of columns —
 * internal notes, before/after state and metadata are not in the view at all,
 * so there is nothing here to accidentally render.
 */
export function memberDecisionList(decisions: MemberDecision[]): Child {
  if (!decisions.length) {
    return emptyState('No decisions recorded yet.',
      'Approvals, verifications and requests about you will appear here.');
  }

  return h('div', { class: 'dashboard-cards' },
    decisions.map(decision => h('article', { class: 'dashboard-card dashboard-card--decision' },
      h('div', { class: 'dashboard-card__heading' },
        h('h3', decision.summary), decision.decision ? statusPill(decision.decision) : null),
      h('dl', { class: 'meta-list' },
        h('dt', 'Decision date'), h('dd', archiveDateTime(decision.created_at)),
        h('dt', 'Category'), h('dd', CATEGORY_LABELS[decision.category] ?? enumLabel(decision.category)),
        h('dt', 'Recorded by'), h('dd', decision.actor_name ? actorLine(decision) : 'Not recorded'),
        decision.entity_label ? [h('dt', 'Related record'), h('dd', decision.entity_label)] : null),
      h('div', { class: 'dashboard-card__note' },
        h('strong', 'Reason / feedback'),
        h('p', decision.reason || 'No additional reason was recorded for this decision.')))));

}

export { CATEGORY_LABELS, DECISION_LABELS };
