/**
 * Publishes opted-in member profiles onto the public team page.
 *
 * This is the "public" half of the profile privacy control. It reads
 * public_member_directory, a view whose WHERE clause is the public contract:
 * only members who chose to be listed, whose membership is active or alumni,
 * and whose account is live. Email and student ID are not columns on that view
 * at all, so no mistake here can leak them.
 *
 * The page keeps working exactly as before when the platform is unconfigured
 * or nobody has opted in — the hand-written roster stays, and the placeholder
 * stays with it. Nothing is removed from the page by this script.
 */
import { isConfigured, supabase } from '../lib/supabase.js';
import { h } from '../lib/dom.js';
import { initials, shortId } from '../lib/format.js';
import type { PublicMember } from '../lib/types.js';

function card(member: PublicMember, avatarUrl: string | null): HTMLElement {
  const photo = avatarUrl
    ? h('img', { src: avatarUrl, alt: `Portrait of ${member.name}`, loading: 'lazy' })
    : h('div', {
        style: {
          width: '100%', height: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'var(--bg-base)',
          fontFamily: 'var(--font-display)', fontSize: '2rem', color: 'var(--text-dark)',
        },
        'aria-hidden': 'true',
      }, initials(member.name));

  // The existing person dialog reads these data attributes, so a database
  // member opens the same profile panel as a hand-written one.
  const links = [member.github_url, member.linkedin_url, member.website_url];

  return h('div', {
    class: 'member-card person-card',
    role: 'button',
    tabindex: '0',
    'aria-haspopup': 'dialog',
    'aria-label': `View profile for ${member.name}`,
    dataset: {
      personName: member.name,
      personRole: member.current_position ?? 'Member',
      personMajor: member.major ?? '',
      personId: member.member_no ?? shortId(member.user_id),
      personYear: member.chapter_year ?? '',
      personBio: member.bio ?? '',
      personGithub: member.github_url ?? '',
      personLinkedin: member.linkedin_url ?? '',
      personWebsite: member.website_url ?? '',
    },
  },
    h('div', { class: 'member-img-box' }, photo),
    h('div', { class: 'member-info' },
      h('h4', { class: 'member-name' }, member.name),
      h('div', { class: 'mono-meta' }, member.current_position ?? 'Member'),
      h('div', { class: 'mono-meta', style: { color: 'var(--text-dark)', marginTop: '0.5rem' } },
        `ID: ${member.member_no ?? shortId(member.user_id)}`),
      links.some(Boolean)
        ? h('div', { class: 'mono-meta', style: { marginTop: '0.5rem' } },
            links.filter(Boolean).length + ' LINK' + (links.filter(Boolean).length === 1 ? '' : 'S'))
        : null));
}

async function start(): Promise<void> {
  if (!isConfigured || !supabase) return;

  const roster = document.getElementById('roster');
  if (!roster) return;

  const { data, error } = await supabase
    .from('public_member_directory')
    .select('*')
    .order('position_rank', { ascending: true, nullsFirst: false })
    .order('name');

  if (error || !data?.length) return;

  const members = data as PublicMember[];

  // Do not duplicate anyone already written into the page by hand.
  const existing = new Set(
    [...roster.querySelectorAll<HTMLElement>('[data-person-name]')]
      .map((el) => (el.dataset.personName ?? '').trim().toLowerCase()));

  const fresh = members.filter((m) => !existing.has(m.name.trim().toLowerCase()));
  if (!fresh.length) return;

  const storage = supabase.storage.from('avatars');
  const grid = h('div', { class: 'members-grid' },
    fresh.map((member) => card(
      member,
      member.avatar_path ? storage.getPublicUrl(member.avatar_path).data.publicUrl : null,
    )));

  // Replace the "roster pending" placeholder if it is still showing; otherwise
  // append to whatever roster markup is already there.
  const placeholder = roster.querySelector('.roster-empty');
  if (placeholder) {
    placeholder.replaceWith(grid);
    const label = roster.querySelector('.section-label .mono-meta');
    if (label) label.textContent = `LEVEL_02 // ${fresh.length} RECORDS`;
  } else {
    roster.appendChild(grid);
  }
}

void start().catch(() => {
  /* The public page must never break because the platform is unreachable. */
});
