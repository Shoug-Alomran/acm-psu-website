/**
 * Publishes opted-in member profiles onto the public team page.
 *
 * This is the "public" half of the profile privacy control. It reads
 * public_member_directory, a view whose WHERE clause is the public contract:
 * only members who chose to be listed, whose membership is active or alumni,
 * and whose account is live. Email and student ID are not columns on that view
 * at all, so no mistake here can leak them.
 *
 * There are two jobs here.
 *
 * APPEND — a member with no hand-written card gets one, as before.
 *
 * ADOPT  — a member who IS hand-written in team.html has their card taken over
 *          by their account, so the person can maintain it from the portal
 *          instead of asking someone to edit HTML.
 *
 * Adoption is deliberately conservative, because team.html is the source of
 * truth until an account proves it has something better:
 *
 *   - Only non-empty database values are applied. An empty bio in the database
 *     never blanks a hand-written one.
 *   - Fields the schema does not model at all — the college line, for one —
 *     are carried across from the existing card untouched.
 *   - The replacement is built in the same shape as the card it replaces, so a
 *     lead card stays a lead card.
 *   - If the platform is unreachable, nothing runs and the hand-written page
 *     is exactly what it always was.
 *
 * The net effect is that the page looks identical the moment this ships, and
 * starts reflecting portal edits as soon as someone makes one.
 */
import { isConfigured, supabase } from '../lib/supabase.js';
import { h } from '../lib/dom.js';
import { initials, shortId } from '../lib/format.js';
import type { PublicMember } from '../lib/types.js';

/** One entry of a person's role progression, as the profile dialog reads it. */
interface PublicTerm {
  user_id: string;
  title: string;
  started_on: string;
  ended_on: string | null;
  chapter_year: string | null;
}

interface PublicRecord {
  user_id: string;
  [key: string]: unknown;
}

function personSlug(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function progressionValue(terms: PublicTerm[]): string {
  return [...terms].sort((a, b) => a.started_on.localeCompare(b.started_on))
    .map((entry) => `${termLabel(entry.started_on, entry.ended_on)} — ${entry.title}`).join('|');
}

function publicLinks(member: PublicMember): Array<{ label: string; url: string }> {
  const links = [...(member.extra_links ?? [])];
  if (member.faculty_page_url && !links.some((link) => link.url === member.faculty_page_url)) {
    links.push({ label: 'PSU faculty page', url: member.faculty_page_url });
  }
  return links;
}

function card(
  member: PublicMember,
  avatarUrl: string | null,
  terms: PublicTerm[],
  contributions: PublicRecord[],
  participation: PublicRecord[],
): HTMLElement {
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
      personSlug: member.person_slug ?? personSlug(member.name),
      personRole: member.current_position ?? 'Member',
      personMajor: member.major ?? '',
      personCollege: member.department ?? '',
      personAcademicTitle: member.academic_title ?? '',
      personDepartment: member.department ?? '',
      personCourses: JSON.stringify(member.courses_taught ?? []),
      personExpertise: JSON.stringify(member.expertise ?? []),
      personResearch: JSON.stringify(member.research_interests ?? []),
      personOffice: member.office_location ?? '',
      personOfficeHours: member.office_hours ?? '',
      personId: member.member_no ?? shortId(member.user_id),
      personYear: member.chapter_year ?? '',
      personAcademicYear: member.academic_year ?? '',
      personBio: member.bio ?? '',
      personTerm: terms.find((entry) => !entry.ended_on)
        ? termLabel(terms.find((entry) => !entry.ended_on)!.started_on, null)
        : '',
      personProgression: progressionValue(terms),
      personGithub: member.github_url ?? '',
      personLinkedin: member.linkedin_url ?? '',
      personWebsite: member.website_url ?? '',
      personExtraLinks: JSON.stringify(publicLinks(member)),
      personContributions: JSON.stringify(contributions),
      personParticipation: JSON.stringify(participation),
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

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/** "NOV 2025–PRESENT", the term format team.js already renders. */
function termLabel(startedOn: string, endedOn: string | null): string {
  const start = new Date(startedOn);
  if (Number.isNaN(start.getTime())) return '';
  const head = `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  if (!endedOn) return `${head}–PRESENT`;
  const end = new Date(endedOn);
  if (Number.isNaN(end.getTime())) return `${head}–PRESENT`;
  return `${head}–${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
}

/**
 * Writes a value onto a card only if there is actually a value.
 *
 * This is the whole safety property of adoption: an account with a blank bio
 * must never wipe a hand-written one. The hand-written page is the floor.
 */
function overlay(target: HTMLElement, key: string, value: string | null | undefined): void {
  const text = (value ?? '').trim();
  if (text) target.dataset[key] = text;
}

/**
 * Takes over a hand-written card with its owner's account data.
 *
 * The card keeps its class list, its position in the page and every attribute
 * the database has no opinion about; only the fields a member can actually
 * edit in the portal are overlaid. The visible text is then re-rendered from
 * the merged dataset, so what the card shows and what the profile dialog opens
 * cannot drift apart.
 */
function adopt(
  existingCard: HTMLElement,
  member: PublicMember,
  avatarUrl: string | null,
  terms: PublicTerm[],
  contributions: PublicRecord[],
  participation: PublicRecord[],
): void {
  overlay(existingCard, 'personRole', member.current_position);
  overlay(existingCard, 'personName', member.name);
  overlay(existingCard, 'personMajor', member.major);
  overlay(existingCard, 'personCollege', member.department);
  overlay(existingCard, 'personAcademicTitle', member.academic_title);
  overlay(existingCard, 'personDepartment', member.department);
  if (member.courses_taught?.length) existingCard.dataset.personCourses = JSON.stringify(member.courses_taught);
  if (member.expertise?.length) existingCard.dataset.personExpertise = JSON.stringify(member.expertise);
  if (member.research_interests?.length) existingCard.dataset.personResearch = JSON.stringify(member.research_interests);
  overlay(existingCard, 'personOffice', member.office_location);
  overlay(existingCard, 'personOfficeHours', member.office_hours);
  overlay(existingCard, 'personId', member.member_no);
  overlay(existingCard, 'personYear', member.chapter_year);
  overlay(existingCard, 'personAcademicYear', member.academic_year);
  overlay(existingCard, 'personBio', member.bio);
  overlay(existingCard, 'personGithub', member.github_url);
  overlay(existingCard, 'personLinkedin', member.linkedin_url);
  overlay(existingCard, 'personWebsite', member.website_url);
  const links = publicLinks(member);
  if (links.length) existingCard.dataset.personExtraLinks = JSON.stringify(links);
  existingCard.dataset.personContributions = JSON.stringify(contributions);
  existingCard.dataset.personParticipation = JSON.stringify(participation);

  const current = terms.find((entry) => !entry.ended_on);
  if (current) overlay(existingCard, 'personTerm', termLabel(current.started_on, current.ended_on));

  if (terms.length) {
    const progression = progressionValue(terms);
    overlay(existingCard, 'personProgression', progression);
  }

  const name = existingCard.dataset.personName ?? member.name;
  existingCard.setAttribute('aria-label', `View profile for ${name}`);

  // Re-render the visible face of the card from the merged dataset. Lead cards
  // and member cards have different internals, so each is rebuilt in its own
  // shape rather than being forced into a common one.
  const role = existingCard.dataset.personRole ?? '';
  const subtitle = existingCard.dataset.personCollege
    ?? existingCard.dataset.personMajor
    ?? '';
  const id = existingCard.dataset.personId ?? '';

  if (existingCard.classList.contains('lead-card')) {
    const image = existingCard.querySelector('.lead-img');
    if (image && avatarUrl) {
      image.replaceChildren(h('img', {
        src: avatarUrl,
        alt: `Portrait of ${name}`,
        loading: 'lazy',
        style: { width: '100%', height: '100%', objectFit: 'cover' },
      }));
      image.removeAttribute('style');
    }

    const content = existingCard.querySelector('.lead-content');
    if (content) {
      content.replaceChildren(...[
        h('div', {},
          role ? h('span', { class: 'tag tag-active' }, role.toUpperCase()) : null,
          h('h3', { class: 'lead-name' }, name),
          subtitle ? h('p', { class: 'mono-meta' }, subtitle) : null),
        id ? h('div', { class: 'mono-meta dim-text' }, `ID: ${id}`) : null,
      ].filter((node): node is HTMLDivElement => node !== null));
    }

    return;
  }

  const info = existingCard.querySelector('.member-info');
  if (info) {
    info.replaceChildren(...[
      h('h4', { class: 'member-name' }, name),
      h('div', { class: 'mono-meta' }, role || 'Member'),
      id
        ? h('div', { class: 'mono-meta', style: { color: 'var(--text-dark)', marginTop: '0.5rem' } },
            `ID: ${id}`)
        : null,
    ].filter((node): node is HTMLDivElement => node !== null));
  }
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
  const storage = supabase.storage.from('avatars');
  const avatar = (member: PublicMember) => member.avatar_path
    ? storage.getPublicUrl(member.avatar_path).data.publicUrl
    : null;

  // Hand-designed cards opt into adoption with an explicit stable slug. Name
  // text is presentation only and is never used as the identity join.
  const written = new Map<string, HTMLElement>();
  for (const el of roster.querySelectorAll<HTMLElement>('[data-person-slug]')) {
    const slug = (el.dataset.personSlug ?? '').trim();
    if (slug) written.set(slug, el);
  }

  const slugOf = (member: PublicMember) => member.person_slug ?? personSlug(member.name);
  const adopted = members.filter((member) => written.has(slugOf(member)));
  const fresh = members.filter((member) => !written.has(slugOf(member)));

  /*
   * Role progressions, fetched once for everyone being adopted. A failure here
   * costs the progression line and nothing else, so it is not allowed to stop
   * the rest of the adoption.
   */
  let termsByUser = new Map<string, PublicTerm[]>();
  let contributionsByUser = new Map<string, PublicRecord[]>();
  let participationByUser = new Map<string, PublicRecord[]>();
  if (members.length) {
    const userIds = members.map((member) => member.user_id);
    const [history, contributions, participation] = await Promise.all([
      supabase.from('public_position_history').select('*').in('user_id', userIds),
      supabase.from('public_verified_contributions').select('*').in('user_id', userIds)
        .order('verified_at', { ascending: false }),
      supabase.from('public_event_participation').select('*').in('user_id', userIds)
        .order('started_on', { ascending: false }),
    ]);

    if (!history.error && history.data) {
      termsByUser = (history.data as PublicTerm[]).reduce((map, entry) => {
        map.set(entry.user_id, [...(map.get(entry.user_id) ?? []), entry]);
        return map;
      }, new Map<string, PublicTerm[]>());
    }
    const group = (rows: PublicRecord[]) => rows.reduce((map, entry) => {
      map.set(entry.user_id, [...(map.get(entry.user_id) ?? []), entry]);
      return map;
    }, new Map<string, PublicRecord[]>());
    if (!contributions.error && contributions.data) {
      contributionsByUser = group(contributions.data as PublicRecord[]);
    }
    if (!participation.error && participation.data) {
      participationByUser = group(participation.data as PublicRecord[]);
    }
  }

  for (const member of adopted) {
    const existingCard = written.get(slugOf(member));
    if (!existingCard) continue;

    try {
      adopt(
        existingCard, member, avatar(member), termsByUser.get(member.user_id) ?? [],
        contributionsByUser.get(member.user_id) ?? [],
        participationByUser.get(member.user_id) ?? [],
      );
    } catch (error) {
      // A card that cannot be adopted keeps its hand-written content, which is
      // a correct page. Never let one profile take the roster down.
      console.error(`Could not adopt the roster card for ${member.name}:`, error);
    }
  }

  document.dispatchEvent(new CustomEvent('acm:rosterupdated'));

  if (!fresh.length) return;

  const grid = h('div', { class: 'members-grid' },
    fresh.map((member) => card(
      member, avatar(member), termsByUser.get(member.user_id) ?? [],
      contributionsByUser.get(member.user_id) ?? [],
      participationByUser.get(member.user_id) ?? [],
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
  document.dispatchEvent(new CustomEvent('acm:rosterupdated'));
}

void start().catch(() => {
  /* The public page must never break because the platform is unreachable. */
});
