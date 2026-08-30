/**
 * The public open-assignments registry.
 *
 * This page used to be the club's second registration system: it read roles
 * from a Google Sheet through Apps Script and wrote signups straight back into
 * a "Position Signups" tab that Supabase never saw. Two independent records of
 * who holds which role cannot be kept honest, so the write path is gone.
 *
 * What remains is a read. The data comes from public_event_openings, a view
 * whose WHERE clause is the public contract: public live projects only, open
 * roles only, and aggregate capacity counts only. No applicant identity or
 * application content is a column on that view at all, so no mistake made here
 * can leak one.
 *
 * Registering is a members-only action and happens in the portal, against the
 * same event_positions rows shown here.
 */
import { isConfigured, supabase } from '../lib/supabase.js';

/** One row of public_event_openings. */
interface PublicOpening {
  event_position_id: string;
  title: string;
  description: string | null;
  openings: number;
  closes_on: string | null;
  filled: number;
  remaining: number;
  project_id: string;
  project_slug: string;
  project_title: string;
  project_summary: string | null;
  project_starts_on: string | null;
  project_site_path: string | null;
}

const PORTAL_OPPORTUNITIES = '/portal/opportunities.html';
const PORTAL_SIGN_IN = '/portal/login.html';

const list = document.getElementById('position-list');
const loadState = document.getElementById('positions-load-state');
const refresh = document.getElementById(
  'positions-refresh',
) as HTMLButtonElement | null;

function escapeHtml(value: string | null | undefined): string {
  const node = document.createElement('div');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function escapeAttr(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Matches the date style the rest of the public site uses. */
function displayDate(value: string | null): string {
  if (!value) return 'Open until filled';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Open until filled';
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function setState(message: string, isError = false): void {
  if (!loadState) return;
  loadState.hidden = false;
  loadState.textContent = message;
  loadState.classList.toggle('is-error', isError);
}

function card(opening: PublicOpening, signedIn: boolean): string {
  const full = opening.remaining <= 0;

  const availability = full
    ? 'POSITION FILLED'
    : `${opening.remaining} OF ${opening.openings} PLACES REMAINING`;

  /*
   * The call to action is a link, never a form. Registration requires an
   * authenticated member and a transactional RPC; a public page has no
   * business holding either.
   */
  const href = signedIn ? PORTAL_OPPORTUNITIES : PORTAL_SIGN_IN;
  const label = full
    ? 'View in member portal'
    : signedIn
      ? 'Register in the member portal'
      : 'Sign in to register';

  return (
    `<article class="position-card" data-position-id="${escapeAttr(opening.event_position_id)}">` +
    `<div class="position-card-index mono-meta">${escapeHtml(opening.project_slug)}</div>` +
    '<div class="position-card-main">' +
    '<div class="position-card-top"><div>' +
    `<p class="mono-meta accent-text">${escapeHtml(opening.project_title)}</p>` +
    `<h3>${escapeHtml(opening.title)}</h3></div>` +
    `<span class="position-status ${full ? 'is-full' : ''}">${availability}</span></div>` +
    `<p class="position-summary">${escapeHtml(
      opening.description ?? opening.project_summary ?? '',
    )}</p>` +
    '<dl class="position-meta">' +
    `<div><dt>Event</dt><dd>${escapeHtml(opening.project_title)}</dd></div>` +
    `<div><dt>Closes</dt><dd>${escapeHtml(displayDate(opening.closes_on))}</dd></div>` +
    `<div><dt>Places</dt><dd>${opening.filled} of ${opening.openings} filled</dd></div>` +
    '</dl>' +
    `<a class="btn-submit position-apply" href="${href}">${label}</a>` +
    '</div></article>'
  );
}

function render(openings: PublicOpening[], signedIn: boolean): void {
  if (!list) return;

  if (!openings.length) {
    list.innerHTML =
      '<div class="positions-empty">' +
      '<strong>NO OPEN ASSIGNMENTS</strong>' +
      '<span>Check back when the next project sprint begins. ' +
      'Members are notified in the portal as soon as a role opens.</span>' +
      '</div>';
    return;
  }

  list.innerHTML = openings.map((opening) => card(opening, signedIn)).join('');
}

async function load(): Promise<void> {
  if (!list) return;

  if (!isConfigured || !supabase) {
    setState(
      'REGISTRY NOT CONFIGURED — see docs/SETUP.md step 1.',
      true,
    );
    list.innerHTML = '';
    return;
  }

  if (refresh) refresh.disabled = true;
  setState('SYNCING AVAILABILITY...');

  try {
    /*
     * Two independent reads. Whether someone is signed in only changes where
     * the button points, so a session failure must not hide the registry.
     */
    const [openings, session] = await Promise.all([
      supabase
        .from('public_event_openings')
        .select('*')
        .order('project_title')
        .order('title'),
      supabase.auth.getSession().catch(() => null),
    ]);

    if (openings.error) throw new Error(openings.error.message);

    render(
      (openings.data ?? []) as PublicOpening[],
      Boolean(session?.data.session),
    );

    if (loadState) loadState.hidden = true;
  } catch (error) {
    console.error('Could not load the public position registry:', error);
    setState(
      'REGISTRY UNAVAILABLE — refresh the page or contact the chapter board.',
      true,
    );
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

if (list) {
  refresh?.addEventListener('click', () => void load());
  void load();
}
