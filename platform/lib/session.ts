/**
 * Who is looking at this page, and what are they allowed to see.
 *
 * The checks here decide what the interface OFFERS. They are not the security
 * boundary — that is supabase/migrations/*_row_level_security.sql, which the
 * database enforces on every request regardless of what this file believes.
 * Both exist because a member should not be shown a button that will fail, and
 * an attacker should not get anywhere by removing one.
 */
import { supabase, isConfigured, requireClient } from './supabase.js';
import type { AdminRole, AppUser, Membership, MemberProfile } from './types.js';

export interface Viewer {
  userId: string;
  email: string;
  user: AppUser;
  profile: MemberProfile | null;
  membership: Membership | null;
  roles: AdminRole[];
  currentPosition: string | null;
}

let cached: Viewer | null = null;
let inflight: Promise<Viewer | null> | null = null;

/** Loads the signed-in person, or null if nobody is signed in. */
export async function loadViewer(force = false): Promise<Viewer | null> {
  if (!isConfigured) return null;
  if (cached && !force) return cached;
  if (inflight && !force) return inflight;

  inflight = (async (): Promise<Viewer | null> => {
    const client = requireClient();
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) { cached = null; return null; }

    const [userRow, profileRow, membershipRow, roleRows, positionRow] = await Promise.all([
      client.from('app_users').select('*').eq('id', auth.user.id).maybeSingle(),
      client.from('member_profiles').select('*').eq('user_id', auth.user.id).maybeSingle(),
      client.from('memberships').select('*').eq('user_id', auth.user.id).maybeSingle(),
      client.from('admin_assignments').select('role')
        .eq('user_id', auth.user.id).is('revoked_at', null),
      client.from('current_positions').select('title')
        .eq('user_id', auth.user.id).maybeSingle(),
    ]);

    // The row is created by a trigger on sign-up; if it is somehow missing the
    // person still has a session, so fall back rather than crashing the page.
    const user = (userRow.data as AppUser | null) ?? {
      id: auth.user.id,
      email: auth.user.email ?? '',
      full_name: (auth.user.user_metadata?.full_name as string) ?? '',
      student_id: null,
      major: null,
      university_role: 'student',
      account_state: 'active',
      created_at: new Date().toISOString(),
      deleted_at: null,
    };

    cached = {
      userId: auth.user.id,
      email: user.email,
      user,
      profile: profileRow.data as MemberProfile | null,
      membership: membershipRow.data as Membership | null,
      roles: (roleRows.data ?? []).map((r) => r.role as AdminRole),
      currentPosition: (positionRow.data as { title: string } | null)?.title ?? null,
    };
    return cached;
  })();

  try { return await inflight; } finally { inflight = null; }
}

export function clearViewer(): void { cached = null; }

/* -------------------------------------------------------------- capability */

export function isSuperAdmin(v: Viewer | null): boolean {
  return !!v?.roles.includes('super_admin');
}

export function isClubAdmin(v: Viewer | null): boolean {
  return isSuperAdmin(v) || !!v?.roles.includes('club_admin');
}

/** Reviewers can work the review queues. Club and super admins can too. */
export function isReviewer(v: Viewer | null): boolean {
  return isClubAdmin(v) || !!v?.roles.includes('reviewer');
}

export function isStaff(v: Viewer | null): boolean {
  return isReviewer(v) || isAdvisoryInstructor(v);
}

export function isAdvisoryInstructor(v: Viewer | null): boolean {
  return !!v?.roles.includes('advisory_instructor');
}

/** Active members and alumni can use the member portal. */
export function isMember(v: Viewer | null): boolean {
  return v?.membership?.status === 'active' || v?.membership?.status === 'alumni';
}

/** Only current members can submit new things. Alumni keep read access. */
export function canSubmit(v: Viewer | null): boolean {
  return v?.membership?.status === 'active';
}

export function displayName(v: Viewer | null): string {
  if (!v) return 'GUEST_USER';
  return v.profile?.display_name || v.user.full_name || v.email;
}

/* ------------------------------------------------------------------ guards */

function redirect(to: string): void {
  const back = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`${to}${to.includes('?') ? '&' : '?'}next=${back}`);
}

/**
 * Blocks the page until a signed-in person is present, sending anyone else to
 * the sign-in page. Resolves with the viewer so callers can use it directly.
 */
export async function requireSignedIn(): Promise<Viewer> {
  const viewer = await loadViewer();
  if (!viewer) { redirect('/portal/login.html'); return new Promise<Viewer>(() => {}); }
  if (viewer.user.account_state === 'disabled') {
    window.location.replace('/portal/disabled.html');
    return new Promise<Viewer>(() => {});
  }
  return viewer;
}

/** Member portal pages. An applicant is sent to their application status. */
export async function requireMember(): Promise<Viewer> {
  const viewer = await requireSignedIn();
  if (!isMember(viewer) && !isStaff(viewer)) {
    window.location.replace('/portal/status.html');
    return new Promise<Viewer>(() => {});
  }
  return viewer;
}

/** Admin pages. `level` is the least privilege the page needs. */
export async function requireAdmin(
  level: 'reviewer' | 'club_admin' | 'super_admin' = 'reviewer',
): Promise<Viewer> {
  const viewer = await requireSignedIn();
  const ok = level === 'super_admin' ? isSuperAdmin(viewer)
    : level === 'club_admin' ? isClubAdmin(viewer)
    : isReviewer(viewer);

  if (!ok) {
    window.location.replace('/portal/index.html?denied=1');
    return new Promise<Viewer>(() => {});
  }
  return viewer;
}

export async function requireAdvisor(): Promise<Viewer> {
  const viewer = await requireSignedIn();
  if (!isAdvisoryInstructor(viewer) && !isClubAdmin(viewer)) {
    window.location.replace('/portal/index.html?denied=1');
    return new Promise<Viewer>(() => {});
  }
  return viewer;
}

export async function signOut(): Promise<void> {
  clearViewer();
  if (supabase) await supabase.auth.signOut();
  window.location.href = '/portal/login.html';
}
