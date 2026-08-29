/**
 * Carrying the sign-up answers into the account.
 *
 * When someone creates an account with email confirmation on, there is no
 * session yet, so the browser cannot write to app_users or member_profiles —
 * row level security has nobody to authorise. The only channel that survives
 * the gap is the auth user's own metadata, which the sign-up call can set.
 *
 * So the extra questions on the sign-up form are stashed in user_metadata and
 * applied here, once, the first time the person actually has a session.
 *
 * Three properties matter:
 *
 *   - It only ever FILLS BLANKS. If the field already has a value — because
 *     the person has since edited their profile, or an admin set it — the
 *     metadata is ignored. Sign-up answers are the oldest information there
 *     is and must never overwrite something newer.
 *
 *   - It touches only member-owned columns. Student ID, email and account
 *     state are administrative facts guarded by a database trigger, and the
 *     membership application is where a student ID is collected and checked.
 *
 *   - It never throws. A profile that could not be pre-filled is a small
 *     inconvenience; a sign-in that fails because of one is not.
 */

import { requireClient } from './supabase.js';
import { knownInterests } from './membership.js';

/** The metadata keys the sign-up form writes. */
interface SignupMetadata {
  full_name?: unknown;
  major?: unknown;
  academic_year?: unknown;
  interests?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function applySignupMetadata(): Promise<void> {
  try {
    const client = requireClient();
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) return;

    const meta = (auth.user.user_metadata ?? {}) as SignupMetadata;

    const major = text(meta.major);
    const academicYear = text(meta.academic_year);
    const interests = knownInterests(
      Array.isArray(meta.interests) ? meta.interests.map(text).filter(Boolean) : [],
    );

    const [userRow, profileRow] = await Promise.all([
      client.from('app_users').select('major').eq('id', auth.user.id).maybeSingle(),
      client.from('member_profiles').select('academic_year, interests')
        .eq('user_id', auth.user.id).maybeSingle(),
    ]);

    if (major && userRow.data && !text(userRow.data.major)) {
      await client.from('app_users').update({ major }).eq('id', auth.user.id);
    }

    const profile = profileRow.data as
      { academic_year: string | null; interests: string[] | null } | null;

    if (!profile) return;

    const patch: { academic_year?: string; interests?: string[] } = {};
    if (academicYear && !text(profile.academic_year)) patch.academic_year = academicYear;
    if (interests.length && !(profile.interests ?? []).length) patch.interests = interests;

    if (Object.keys(patch).length) {
      await client.from('member_profiles').update(patch).eq('user_id', auth.user.id);
    }

    // The private university workbook is a snapshot of Supabase. Refresh its
    // Members tab after the signup answers have reached their source rows.
    // This is best-effort: a Google outage must never block account access.
    void client.functions.invoke('member-sheet-sync', { body: {} }).then(({ error }) => {
      if (error) console.error('Could not refresh the Members worksheet:', error);
    });
  } catch (error) {
    // Pre-filling is a convenience. Never let it break a sign-in.
    console.error('Could not apply sign-up answers to the profile:', error);
  }
}
