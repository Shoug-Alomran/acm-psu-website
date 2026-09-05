/**
 * Shared portal interface pieces.
 *
 * The member and admin areas are denser than the public site, but they are the
 * same product: same near-black ground, ACM blue accent, Space Grotesk
 * headings, JetBrains Mono metadata, thin borders, 2px radii. Anything that
 * would read as a generic SaaS dashboard belongs somewhere else.
 *
 * Styles live in assets/css/portal.css, which only adds to the tokens already
 * defined in assets/css/main.css.
 */
import { h, render, type Child } from './dom.js';
import { daysSince, enumLabel, initials } from './format.js';
import { signOut, isClubAdmin, isReviewer, isSuperAdmin, isStaff, isMember,
         isAdvisoryInstructor, isInstructor, displayName, type Viewer } from './session.js';

/* ------------------------------------------------------------------- chrome */

interface NavLink { href: string; label: string; badge?: number }

function instructorLinks(viewer: Viewer): NavLink[] {
  const links: NavLink[] = [
    { href: '/portal/index.html', label: 'Dashboard' },
    { href: '/portal/profile.html', label: 'My Profile' },
    { href: '/portal/record.html', label: 'My Record' },
  ];
  if (isAdvisoryInstructor(viewer)) {
    links.push(
      { href: '/admin/advisor.html', label: 'Assigned Activities' },
      { href: '/admin/records-backup.html', label: 'Club Records' },
    );
  }
  return links;
}

function memberLinks(viewer: Viewer): NavLink[] {
  const links: NavLink[] = [{ href: '/portal/index.html', label: 'Dashboard' }];
  if (isMember(viewer) || isStaff(viewer)) {
    links.push(
      { href: '/portal/profile.html', label: 'My Profile' },
      { href: '/portal/record.html', label: 'My Record' },
      { href: '/portal/opportunities.html?view=responsibilities', label: 'My responsibilities' },
      { href: '/portal/opportunities.html', label: 'Opportunities' },
      { href: '/portal/contributions.html', label: 'Contributions' },
      { href: '/portal/submissions.html', label: 'Archive Submissions' },
      { href: '/portal/requests.html', label: 'Requests' },
    );
    if (isAdvisoryInstructor(viewer)) {
      links.push(
        { href: '/admin/advisor.html', label: 'Instructor Workspace' },
        { href: '/admin/records-backup.html', label: 'Club Records' },
      );
    }
  } else {
    links.push({ href: '/portal/status.html', label: 'Application' });
  }
  return links;
}

function adminLinks(viewer: Viewer): NavLink[] {
  if (isAdvisoryInstructor(viewer) && !isReviewer(viewer)) {
    return [
      { href: '/admin/advisor.html', label: 'Assigned Activities' },
      { href: '/admin/records-backup.html', label: 'Records Backup' },
    ];
  }
  const links: NavLink[] = [{ href: '/admin/index.html', label: 'Overview' }];
  if (isClubAdmin(viewer)) {
    links.push(
      { href: '/admin/applications.html', label: 'Applications' },
      { href: '/admin/members.html', label: 'Members' },
      { href: '/admin/positions.html', label: 'Positions' },
      { href: '/admin/projects.html', label: 'Projects & Events' },
    );
  }
  links.push(
    { href: '/admin/contributions.html', label: 'Contributions' },
    { href: '/admin/submissions.html', label: 'Archive Review' },
    // Reviewers answer inquiries too — it is queue work, not member management.
    { href: '/admin/inquiries.html', label: 'Inquiries' },
  );
  if (isClubAdmin(viewer)) {
    links.push(
      { href: '/admin/requests.html', label: 'Requests' },
      { href: '/admin/university-records.html', label: 'Club Records' },
      { href: '/admin/records-backup.html', label: 'Records Backup' },
    );
  }
  // Reviewers get the audit page too: it is where they can account for their
  // own decisions, and it shows them only their own entries.
  links.push({ href: '/admin/audit.html', label: 'Audit History' });
  if (isSuperAdmin(viewer) || isClubAdmin(viewer)) {
    links.push({ href: '/admin/administration.html', label: 'Administration' });
  }
  return links;
}

/** Remembers a collapsed sidebar for this browser. */
const NAV_COLLAPSED_KEY = 'acm-portal-nav-collapsed';

/**
 * Draws the portal shell into the page's <body> and returns the element that
 * page content should be rendered into.
 */
export function shell(viewer: Viewer, area: 'member' | 'admin', title: string): HTMLElement {
  const instructorOnly = isInstructor(viewer) && !isReviewer(viewer);
  const links = instructorOnly ? instructorLinks(viewer)
    : area === 'admin' ? adminLinks(viewer) : memberLinks(viewer);
  const here = window.location.pathname + (new URLSearchParams(window.location.search).get('view') === 'responsibilities' ? '?view=responsibilities' : '');
  const content = h('div', { class: 'portal-content', id: 'portal-content' });

  const sidebar = h('aside', { class: 'portal-sidebar', id: 'portal-navigation' },
    h('a', { class: 'nav-logo portal-brand', href: '/index.html' },
      h('img', { src: '/assets/img/acm.png', alt: '' }),
      h('span', 'ACM'), h('span', { class: 'divider' }, '/'), h('span', 'PSU'),
    ),
    h('div', { class: 'portal-area mono-meta' },
      instructorOnly ? 'INSTRUCTOR WORKSPACE'
        : area === 'admin' ? 'ADMIN CONSOLE' : 'MEMBER PORTAL'),
    h('nav', { class: 'portal-nav' },
      links.map((link) => h('a', {
        href: link.href,
        class: here === link.href ? 'active' : '',
        'aria-current': here === link.href ? 'page' : null,
      }, link.label)),
    ),
    // Staff move between the two areas constantly; keep the hop one click away.
    instructorOnly
      ? h('nav', { class: 'portal-nav portal-nav--secondary' },
          h('a', { href: '/index.html' }, 'Public website'))
      : (isStaff(viewer) || isAdvisoryInstructor(viewer))
      ? h('nav', { class: 'portal-nav portal-nav--secondary' },
          h('a', { href: area === 'admin' ? '/portal/index.html'
            : isAdvisoryInstructor(viewer) && !isReviewer(viewer)
              ? '/admin/advisor.html' : '/admin/index.html' },
            area === 'admin' ? '← Personal portal'
              : isAdvisoryInstructor(viewer) && !isReviewer(viewer)
                ? 'Instructor workspace →' : 'Admin console →'),
          h('a', { href: '/index.html' }, 'Public website'))
      : h('nav', { class: 'portal-nav portal-nav--secondary' },
          h('a', { href: '/index.html' }, 'Public website')),
    h('div', { class: 'portal-account' },
      h('div', { class: 'portal-avatar' }, initials(displayName(viewer))),
      h('div', { class: 'portal-account-text' },
        h('strong', displayName(viewer)),
        h('span', { class: 'mono-meta' },
          viewer.roles.length ? viewer.roles.map(enumLabel).join(' / ')
            : enumLabel(viewer.membership?.status ?? 'applicant')),
      ),
      h('button', { type: 'button', class: 'link-button mono-meta',
        onclick: () => void signOut() }, 'SIGN OUT'),
    ),
  );

  const toggle = h('button', {
    type: 'button', class: 'portal-menu-toggle', 'aria-label': 'Toggle navigation',
    onclick: () => document.body.classList.toggle('portal-nav-open'),
  }, '☰');

  // Collapsing the sidebar is available to every account, not just admins:
  // the widest pages here are tables, and on a laptop the navigation is the
  // easiest 260px to give back. The choice is remembered per browser, and a
  // browser that refuses storage simply starts expanded every time.
  const collapse = h('button', {
    type: 'button', class: 'portal-collapse', 'aria-controls': 'portal-navigation',
  }) as HTMLButtonElement;

  function paintCollapse(collapsed: boolean): void {
    document.body.classList.toggle('portal-collapsed', collapsed);
    collapse.textContent = collapsed ? '»' : '«';
    collapse.title = collapsed ? 'Expand navigation' : 'Collapse navigation';
    collapse.setAttribute('aria-label', collapse.title);
    collapse.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  let collapsed = false;
  try { collapsed = localStorage.getItem(NAV_COLLAPSED_KEY) === '1'; } catch { /* storage unavailable */ }
  paintCollapse(collapsed);
  collapse.addEventListener('click', () => {
    collapsed = !collapsed;
    paintCollapse(collapsed);
    try { localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  });
  sidebar.prepend(collapse);

  render(document.body,
    h('div', { class: 'ambient-glow ambient-glow--corner' }),
    h('div', { class: 'portal-layout' }, toggle, sidebar,
      h('main', { class: 'portal-main', id: 'main' }, content)),
  );

  document.title = `${title} — ACM PSU`;
  return content;
}

/* -------------------------------------------------------------- primitives */

export function pageHeader(kicker: string, title: string, ...actions: Child[]): HTMLElement {
  return h('header', { class: 'portal-header' },
    h('div', {},
      h('div', { class: 'breadcrumb mono-meta' }, kicker),
      h('h1', { class: 'portal-title' }, title)),
    actions.length ? h('div', { class: 'portal-header-actions' }, actions) : null,
  );
}

/** Status pill. The tone is derived from the value so colours stay consistent. */
export function statusPill(value: string | null | undefined): HTMLElement {
  const key = String(value ?? '').toLowerCase();
  const tone =
    ['active', 'approved', 'published', 'confirmed', 'completed'].includes(key) ? 'ok'
    : ['pending', 'submitted', 'interview', 'planning', 'registered'].includes(key) ? 'wait'
    : ['changes_requested', 'draft', 'inactive'].includes(key) ? 'warn'
    : ['rejected', 'withdrawn', 'no_show', 'cancelled', 'disabled'].includes(key) ? 'bad'
    : 'neutral';
  return h('span', { class: `pill pill--${tone}` }, enumLabel(value));
}

export function statTile(value: number | string, label: string): HTMLElement {
  return h('div', { class: 'stat-tile' },
    h('strong', { class: 'stat-value' }, String(value)),
    h('span', { class: 'mono-meta' }, label.toUpperCase()));
}

export function statRow(tiles: Array<[number | string, string]>): HTMLElement {
  return h('div', { class: 'stat-row' }, tiles.map(([v, l]) => statTile(v, l)));
}

export function panel(title: string, ...body: Child[]): HTMLElement {
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', title)),
    h('div', { class: 'panel-body' }, body));
}

export function emptyState(message: string, hint?: string): HTMLElement {
  return h('div', { class: 'empty-state' },
    h('span', { class: 'mono-meta' }, 'NO RECORDS'),
    h('p', message),
    hint ? h('p', { class: 'mono-meta dim-text' }, hint) : null);
}

export function loading(label = 'LOADING'): HTMLElement {
  return h('div', { class: 'loading-state mono-meta' }, `${label}…`);
}

/** Definition list used for record metadata throughout the portal. */
export function metaList(rows: Array<[string, Child]>): HTMLElement {
  return h('dl', { class: 'meta-list' },
    rows.map(([label, value]) => [
      h('dt', { class: 'mono-meta' }, label.toUpperCase()),
      h('dd', value),
    ]));
}

export function dataTable(
  headers: string[],
  rows: Child[][],
  options: {
    empty?: string;
    /** Extra class on the <table>, for table-specific column rules. */
    tableClass?: string;
    /** Per-row class, so a queue can mark the rows that still need work. */
    rowClass?: (index: number) => string | null;
    /** Per-column class, applied to every <td> in that column. */
    cellClass?: (column: number) => string | null;
  } = {},
): HTMLElement {
  if (!rows.length) return emptyState(options.empty ?? 'Nothing here yet.');
  return h('div', { class: 'table-scroll' },
    h('table', { class: `data-table${options.tableClass ? ` ${options.tableClass}` : ''}` },
      h('thead', h('tr', headers.map((label, column) =>
        h('th', { class: `mono-meta${classOf(options.cellClass?.(column))}` },
          label.toUpperCase())))),
      h('tbody', rows.map((cells, index) =>
        h('tr', { class: options.rowClass?.(index) ?? '' },
          cells.map((cell, column) =>
            h('td', { class: options.cellClass?.(column) ?? '' }, cell)))))));
}

/** Filters a complete, unpaginated list without refetching or losing focus. */
export function listFilters(items: Array<{ element: HTMLElement; text: string; facets: Record<string, string> }>, labels: string[]): HTMLElement {
  const search = h('input', { type: 'search', placeholder: 'Search…', 'aria-label': 'Search list' });
  const count = h('p', { class: 'list-filter-count', role: 'status', 'aria-live': 'polite' });
  const selects = labels.filter(label => new Set(items.map(item => item.facets[label]).filter(Boolean)).size > 1).map(label => {
    const values = [...new Set(items.map(item => item.facets[label]).filter((v): v is string => Boolean(v)))].sort();
    return { label, input: h('select', { 'aria-label': label },
      h('option', { value: '' }, `Any ${label.toLowerCase()}`), values.map(value => h('option', { value }, value))) };
  });
  const empty = h('p', { class: 'list-filter-empty', hidden: true }, 'No results match these filters. Clear filters to see everything.');
  const update = () => {
    const needle = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const item of items) {
      const matches = item.text.toLocaleLowerCase().includes(needle) && selects.every(({label, input}) => !input.value || item.facets[label] === input.value);
      item.element.hidden = !matches;
      if (matches) visible++;
    }
    count.textContent = `${visible} of ${items.length} shown`;
    empty.hidden = visible !== 0;
  };
  search.addEventListener('input', update);
  selects.forEach(({input}) => input.addEventListener('change', update));
  const clear = h('button', { type: 'button', class: 'btn-ghost', onclick: () => {
    search.value = ''; selects.forEach(({input}) => { input.value = ''; }); update(); search.focus();
  } }, 'Clear filters');
  update();
  return h('div', { class: 'list-filters' },
    h('div', { class: 'list-filters__controls' }, h('label', {}, 'Search', search),
      selects.map(({label, input}) => h('label', {}, label, input)), clear), count, empty);
}

export function filterableTable(headers: string[], rows: Child[][], options: Parameters<typeof dataTable>[2] = {}): HTMLElement {
  const table = dataTable(headers, rows, options);
  if (!rows.length) return table;
  const labels = headers.filter(label => ['Kind', 'Status', 'Chapter', 'Visibility', 'Project', 'Category', 'Type'].includes(label));
  const items = Array.from(table.querySelectorAll('tbody tr')).map(element => ({
    element: element as HTMLElement,
    text: element.textContent ?? '',
    facets: Object.fromEntries(labels.map(label => [label, element.children[headers.indexOf(label)]?.textContent?.trim() ?? ''])),
  }));
  return h('div', {}, listFilters(items, labels), table);
}

function classOf(value: string | null | undefined): string {
  return value ? ` ${value}` : '';
}

/* --------------------------------------------------------------- fragments */

/**
 * A row of tags. Exists because tags rendered as bare inline spans run into
 * each other; this is the one place that spacing is decided.
 */
export function tagList(values: string[], extraClass = 'tag--sm'): HTMLElement | null {
  const items = values.map((value) => value.trim()).filter(Boolean);
  if (!items.length) return null;
  return h('div', { class: 'tag-row' },
    items.map((value) => h('span', { class: `tag ${extraClass}` }, value)));
}

/** A compact label/value block — the portal's answer to a metadata card. */
export function spec(label: string, value: Child, muted = false): HTMLElement {
  return h('div', { class: 'spec' },
    h('span', { class: 'spec__label' }, label.toUpperCase()),
    h('span', { class: `spec__value${muted ? ' spec__value--muted' : ''}` }, value));
}

export function specGrid(...items: Child[]): HTMLElement {
  return h('div', { class: 'spec-grid' }, items);
}

/** Placeholder rows, so a reloading list keeps its height instead of jumping. */
export function skeletonList(rows = 5, columns = 4): HTMLElement {
  return h('div', { class: 'skeleton-list', 'aria-hidden': 'true' },
    Array.from({ length: rows }, () =>
      h('div', { class: 'skeleton-row' },
        Array.from({ length: columns }, (_unused, column) =>
          h('div', {
            class: 'skeleton-bar',
            style: { width: `${[70, 90, 55, 40][column % 4]}%` },
          })))));
}

/* ---------------------------------------------------------------- attention */

/**
 * How much of the administrator's attention a row deserves, right now.
 *
 * The portal shows a lot of state, and most of it is not a request for action.
 * Colouring every state equally is the same as colouring none of them: the
 * positions catalogue showing a green ACTIVE on all thirty rows told a
 * committee member nothing about what to do next.
 *
 * So there are exactly four levels, and only two of them are loud:
 *
 *   now     something is blocked, overdue, or a seat that matters is empty
 *   review  waiting on a human decision — the ordinary queue state
 *   ok      settled; no action
 *   idle    a state, not a request — catalogue entries, inactive records
 *
 * Every level is stated in words as well as colour. Nothing in the admin
 * console may depend on colour alone to be understood.
 */
export type Attention = 'now' | 'review' | 'ok' | 'idle';

const ATTENTION_MARK: Record<Attention, string> = {
  now: '!',
  review: '•',
  ok: '✓',
  idle: '–',
};

/**
 * The attention pill. The marker glyph and the label both carry the meaning,
 * so the pill still reads correctly in monochrome or to a screen reader.
 */
export function attentionPill(level: Attention, label: string): HTMLElement {
  return h('span', { class: `pill pill--attn pill--attn-${level}` },
    h('span', { class: 'pill__mark', 'aria-hidden': 'true' }, ATTENTION_MARK[level]),
    h('span', label.toUpperCase()));
}

/** The class that puts an attention edge on a table row. */
export function attentionRow(level: Attention): string {
  return level === 'idle' ? 'attn-row' : `attn-row attn-row--${level}`;
}

/**
 * A quiet chip for a state that is merely true, not actionable — "active" on a
 * catalogue entry, "archived" on an old one. Deliberately not a status pill:
 * these must not compete with the rows that need something done.
 */
export function stateTag(label: string, muted = false): HTMLElement {
  return h('span', { class: `state-tag${muted ? ' state-tag--muted' : ''}` },
    label.toUpperCase());
}

/**
 * Ages a queue item. Something that has been waiting a fortnight is a
 * different problem from something that arrived this morning, and the
 * difference should be visible without reading the date column.
 */
export function ageAttention(
  isoDate: string | null | undefined,
  /** Days after which an item is overdue. */
  overdueAfter = 14,
): { level: Attention; label: string; days: number | null } {
  const days = daysSince(isoDate);
  if (days === null) return { level: 'review', label: 'WAITING', days: null };

  return {
    level: days >= overdueAfter ? 'now' : 'review',
    label: days === 0 ? 'TODAY' : days === 1 ? '1 DAY' : `${days} DAYS`,
    days,
  };
}

export interface TriageItem {
  label: string;
  count: number;
  href: string;
  /** What this queue is, in a few words. */
  hint?: string;
  /** The level to use when the count is above zero. Defaults to 'review'. */
  level?: Attention;
}

/**
 * The triage strip: what needs this administrator, ordered by urgency, with a
 * plain-language headline. It is the first thing on the overview page because
 * it is the only thing most visits are actually about.
 */
export function triageStrip(items: TriageItem[]): HTMLElement {
  const live = items.filter((item) => item.count > 0);
  const urgent = live.filter((item) => (item.level ?? 'review') === 'now');
  const total = live.reduce((sum, item) => sum + item.count, 0);

  const headline = total === 0
    ? 'Nothing is waiting on you.'
    : urgent.length
      ? `${total} item${total === 1 ? '' : 's'} waiting — ${urgent.reduce((s, i) => s + i.count, 0)} need attention now.`
      : `${total} item${total === 1 ? '' : 's'} waiting for a decision.`;

  return h('section', { class: 'triage' },
    h('div', { class: 'triage__head' },
      h('span', { class: 'mono-meta' }, 'WHAT NEEDS YOU'),
      h('p', { class: 'triage__headline' }, headline)),

    h('div', { class: 'triage__grid' },
      items.map((item) => {
        const level: Attention = item.count === 0 ? 'ok' : item.level ?? 'review';
        return h('a', {
          class: `triage__tile triage__tile--${level}`,
          href: item.href,
        },
          h('span', { class: 'triage__count' }, String(item.count)),
          h('span', { class: 'triage__label' }, item.label),
          h('span', { class: 'triage__state' },
            item.count === 0 ? 'CLEAR' : level === 'now' ? 'NEEDS ACTION' : 'TO REVIEW'),
          item.hint ? h('span', { class: 'triage__hint' }, item.hint) : null);
      })));
}

/**
 * The key to the colours, shown once per page that uses them. A colour system
 * nobody can read is decoration; this is the one line that makes it a system.
 */
export function attentionLegend(...entries: Array<[Attention, string]>): HTMLElement {
  return h('div', { class: 'attn-legend' },
    entries.map(([level, label]) =>
      h('span', { class: `attn-legend__item attn-legend__item--${level}` },
        h('span', { class: 'attn-legend__dot', 'aria-hidden': 'true' }),
        label)));
}

/* ------------------------------------------------------------------ notices */

export function notice(kind: 'ok' | 'err' | 'warn' | 'info', message: string): HTMLElement {
  return h('p', { class: `form-status form-status--${kind}`, role: kind === 'err' ? 'alert' : 'status' },
    message);
}

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: 'ok' | 'err' = 'ok'): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const item = h('div', { class: `toast toast--${kind}` }, message);
  toastHost.appendChild(item);
  window.setTimeout(() => item.classList.add('toast--out'), 3600);
  window.setTimeout(() => item.remove(), 4200);
}

/* ------------------------------------------------------------------- dialog */

/**
 * A modal built on <dialog>, so focus trapping and Escape come from the
 * platform rather than from hand-written key handling.
 */
export function dialog(
  title: Child,
  body: Child,
  footer?: Child,
  options: { class?: string; footClass?: string } = {},
): HTMLDialogElement {
  const el = h('dialog', { class: `portal-dialog${options.class ? ` ${options.class}` : ''}` },
    h('form', { method: 'dialog', class: 'portal-dialog-inner' },
      h('div', { class: 'portal-dialog-head' },
        typeof title === 'string' ? h('h2', title) : title,
        h('button', { type: 'submit', value: 'close', class: 'link-button',
          'aria-label': 'Close' }, '✕')),
      h('div', { class: 'portal-dialog-body' }, body),
      footer
        ? h('div', { class: `portal-dialog-foot${options.footClass ? ` ${options.footClass}` : ''}` },
            footer)
        : null),
  ) as HTMLDialogElement;

  document.body.appendChild(el);
  el.addEventListener('close', () => el.remove());
  el.showModal();
  return el;
}

export function confirmDialog(title: string, message: string, confirmLabel = 'Confirm'):
  Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const el = dialog(title, h('p', message),
      h('div', { class: 'button-row' },
        h('button', { type: 'button', class: 'btn-ghost',
          onclick: () => { answered = true; resolve(false); el.close(); } }, 'Cancel'),
        h('button', { type: 'button', class: 'btn-submit',
          onclick: () => { answered = true; resolve(true); el.close(); } }, confirmLabel)));
    el.addEventListener('close', () => { if (!answered) resolve(false); });
  });
}

/* -------------------------------------------------------------------- forms */

export interface FieldOptions {
  label: string;
  name: string;
  type?: string;
  value?: string | null;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  rows?: number;
  options?: Array<{ value: string; label: string }>;
  maxlength?: number;
  disabled?: boolean;
  min?: string;
  max?: string;
}

/** One labelled control. Used everywhere so field markup stays identical. */
export function field(options: FieldOptions): HTMLElement {
  const id = `f-${options.name}-${Math.random().toString(36).slice(2, 7)}`;
  const shared: Record<string, unknown> = {
    id, name: options.name,
    required: options.required ?? false,
    disabled: options.disabled ?? false,
    placeholder: options.placeholder ?? null,
    maxlength: options.maxlength ?? null,
  };

  let control: HTMLElement;
  if (options.type === 'textarea') {
    control = h('textarea', { ...shared, rows: options.rows ?? 4 }, options.value ?? '');
  } else if (options.type === 'select') {
    control = h('select', shared,
      (options.options ?? []).map((o) =>
        h('option', { value: o.value, selected: o.value === (options.value ?? '') }, o.label)));
  } else {
    control = h('input', {
      ...shared, type: options.type ?? 'text', value: options.value ?? '',
      min: options.min ?? null, max: options.max ?? null,
    });
  }

  return h('div', { class: 'form-field' },
    h('label', { for: id, class: 'mono-meta' },
      options.label.toUpperCase(), options.required ? h('span', { class: 'accent-text' }, ' *') : null),
    control,
    options.hint ? h('p', { class: 'field-hint mono-meta dim-text' }, options.hint) : null);
}

/**
 * Multi-select rendered as the join page's option grid.
 *
 * This deliberately emits the same .interest-picker / .interest-options markup
 * the public membership page uses, rather than a portal-only variant: the
 * question is the same question, so it should not be a different control on a
 * different page. The checked state, hover and 44px hit target all come from
 * the existing rules in main.css.
 */
export function chipPicker(
  name: string, choices: Array<{ value: string; label: string }>, selected: string[] = [],
): HTMLElement {
  return h('div', { class: 'interest-picker' },
    h('div', { class: 'interest-options', role: 'group' },
      choices.map((choice) => {
        const id = `c-${name}-${choice.value}`;
        return h('label', { for: id },
          h('input', { type: 'checkbox', id, name, value: choice.value,
            checked: selected.includes(choice.value) }),
          h('span', choice.label));
      })));
}

export function submitButton(label: string): HTMLButtonElement {
  return h('button', { type: 'submit', class: 'btn-submit' }, label);
}

/**
 * Runs an async action from a button, disabling it and reporting failures in
 * one place. Nothing in the portal should call an RPC without this.
 */
export function action(
  label: string,
  handler: () => Promise<void>,
  variant: 'primary' | 'ghost' | 'danger' = 'ghost',
): HTMLButtonElement {
  const cls = variant === 'primary' ? 'btn-submit'
    : variant === 'danger' ? 'btn-ghost btn-danger' : 'btn-ghost';

  const button = h('button', { type: 'button', class: cls }, label) as HTMLButtonElement;
  button.addEventListener('click', async () => {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'WORKING…';
    try {
      await handler();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'err');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
  return button;
}

/** The banner shown when the platform has no database configured yet. */
export function setupNotice(): HTMLElement {
  return h('div', { class: 'panel setup-notice' },
    h('div', { class: 'panel-head' }, h('h2', 'Platform not connected')),
    h('div', { class: 'panel-body' },
      h('p', 'The member and admin portals need a Supabase project before they can be used. ' +
        'The public website is unaffected and continues to work normally.'),
      h('p', { class: 'mono-meta dim-text' },
        'Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY in .env.local, then run npm run build. ' +
        'Full instructions are in docs/SETUP.md.')));
}

/* ------------------------------------------------------------- auth surface */

/**
 * The centred card used by sign-in, sign-up, password reset and the membership
 * application. No sidebar: nobody is signed in yet, so there is nothing to
 * navigate to.
 */
export function authShell(title: string, subtitle: string, ...body: Child[]): HTMLElement {
  const card = h('div', { class: 'auth-card' },
    h('a', { class: 'auth-brand', href: '/index.html', 'aria-label': 'ACM PSU — home' },
      h('img', { src: '/assets/img/acm.png', alt: '' }),
      h('span', 'ACM'), h('span', { class: 'divider dim-text' }, '/'), h('span', 'PSU')),
    h('div', {},
      h('div', { class: 'breadcrumb mono-meta' }, 'ACCESS'),
      h('h1', title),
      subtitle ? h('p', subtitle) : null),
    body,
  );

  render(document.body,
    h('div', { class: 'ambient-glow' }),
    h('main', { class: 'auth-shell', id: 'main' }, card));

  document.title = `${title} — ACM PSU`;
  return card;
}

/** Wide variant, for the membership application form. */
export function wideAuthShell(title: string, subtitle: string, ...body: Child[]): HTMLElement {
  const card = authShell(title, subtitle, ...body);
  card.classList.add('auth-card--wide');
  return card;
}

/* ------------------------------------------------------------------ reasons */

/**
 * The decision-reason control.
 *
 * Rendered prominently because it is the field a future committee will most
 * want to have been filled in. For consequential actions the database refuses
 * the call without one, so `required` here is a courtesy that produces a
 * useful message before the round trip rather than the only defence.
 */
export function reasonField(options: {
  label?: string;
  name?: string;
  required?: boolean;
  hint?: string;
  value?: string | null;
} = {}): HTMLElement {
  const required = options.required ?? true;
  const wrapper = field({
    label: options.label ?? 'Reason for this decision',
    name: options.name ?? 'reason',
    type: 'textarea',
    rows: 3,
    value: options.value ?? null,
    maxlength: 2000,
    hint: options.hint ?? (required
      ? 'Required. One sentence is enough — it is recorded permanently and, ' +
        'for decisions about a member, shown to them.'
      : 'Optional. Recorded permanently and shown to the member.'),
  });
  wrapper.classList.add('reason-field');
  if (required) wrapper.classList.add('is-required');
  return wrapper;
}

/** The admin-only counterpart. Never shown to the member it concerns. */
export function internalNoteField(value?: string | null): HTMLElement {
  return field({
    label: 'Internal note',
    name: 'internal',
    type: 'textarea',
    rows: 2,
    value: value ?? null,
    hint: 'Staff only. Never shown to the member.',
  });
}

/**
 * Client-side mirror of the database's require_reason(). Returns the trimmed
 * reason, or null after showing the same message the server would.
 */
export function checkReason(value: string, what: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 8) {
    toast(`Please write a short reason to ${what} — it is kept on the record.`, 'err');
    return null;
  }
  return trimmed;
}
