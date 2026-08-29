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
import { enumLabel, initials } from './format.js';
import { signOut, isClubAdmin, isReviewer, isSuperAdmin, isStaff, isMember,
         displayName, type Viewer } from './session.js';

/* ------------------------------------------------------------------- chrome */

interface NavLink { href: string; label: string; badge?: number }

function memberLinks(viewer: Viewer): NavLink[] {
  const links: NavLink[] = [{ href: '/portal/index.html', label: 'Dashboard' }];
  if (isMember(viewer)) {
    links.push(
      { href: '/portal/profile.html', label: 'Profile' },
      { href: '/portal/record.html', label: 'My Record' },
      { href: '/portal/opportunities.html', label: 'Opportunities' },
      { href: '/portal/contributions.html', label: 'Contributions' },
      { href: '/portal/submissions.html', label: 'Archive Submissions' },
      { href: '/portal/requests.html', label: 'Requests' },
    );
  } else {
    links.push({ href: '/portal/status.html', label: 'Application' });
  }
  return links;
}

function adminLinks(viewer: Viewer): NavLink[] {
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
  );
  if (isClubAdmin(viewer)) {
    links.push(
      { href: '/admin/requests.html', label: 'Requests' },
      { href: '/admin/university-records.html', label: 'University Records' },
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

/**
 * Draws the portal shell into the page's <body> and returns the element that
 * page content should be rendered into.
 */
export function shell(viewer: Viewer, area: 'member' | 'admin', title: string): HTMLElement {
  const links = area === 'admin' ? adminLinks(viewer) : memberLinks(viewer);
  const here = window.location.pathname;
  const content = h('div', { class: 'portal-content', id: 'portal-content' });

  const sidebar = h('aside', { class: 'portal-sidebar' },
    h('a', { class: 'nav-logo portal-brand', href: '/index.html' },
      h('img', { src: '/assets/img/acm.png', alt: '' }),
      h('span', 'ACM'), h('span', { class: 'divider' }, '/'), h('span', 'PSU'),
    ),
    h('div', { class: 'portal-area mono-meta' },
      area === 'admin' ? 'ADMIN CONSOLE' : 'MEMBER PORTAL'),
    h('nav', { class: 'portal-nav' },
      links.map((link) => h('a', {
        href: link.href,
        class: here === link.href ? 'active' : '',
        'aria-current': here === link.href ? 'page' : null,
      }, link.label)),
    ),
    // Staff move between the two areas constantly; keep the hop one click away.
    isStaff(viewer)
      ? h('nav', { class: 'portal-nav portal-nav--secondary' },
          h('a', { href: area === 'admin' ? '/portal/index.html' : '/admin/index.html' },
            area === 'admin' ? '← Member portal' : 'Admin console →'),
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
  options: { empty?: string } = {},
): HTMLElement {
  if (!rows.length) return emptyState(options.empty ?? 'Nothing here yet.');
  return h('div', { class: 'table-scroll' },
    h('table', { class: 'data-table' },
      h('thead', h('tr', headers.map((label) =>
        h('th', { class: 'mono-meta' }, label.toUpperCase())))),
      h('tbody', rows.map((cells) => h('tr', cells.map((cell) => h('td', cell)))))));
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
export function dialog(title: string, body: Child, footer?: Child): HTMLDialogElement {
  const el = h('dialog', { class: 'portal-dialog' },
    h('form', { method: 'dialog', class: 'portal-dialog-inner' },
      h('div', { class: 'portal-dialog-head' },
        h('h2', title),
        h('button', { type: 'submit', value: 'close', class: 'link-button',
          'aria-label': 'Close' }, '✕')),
      h('div', { class: 'portal-dialog-body' }, body),
      footer ? h('div', { class: 'portal-dialog-foot' }, footer) : null),
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

/** Multi-select rendered as checkbox chips, matching the join-page picker. */
export function chipPicker(
  name: string, choices: Array<{ value: string; label: string }>, selected: string[] = [],
): HTMLElement {
  return h('div', { class: 'interest-picker', role: 'group' },
    choices.map((choice) => {
      const id = `c-${name}-${choice.value}`;
      return h('div', { class: 'interest-chip' },
        h('input', { type: 'checkbox', id, name, value: choice.value,
          checked: selected.includes(choice.value) }),
        h('label', { for: id }, choice.label));
    }));
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
