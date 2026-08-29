/**
 * Display formatting.
 *
 * The archive aesthetic is uppercase monospace metadata, so dates render as
 * "29 AUG 2026" rather than a locale default. Anything shown to a person goes
 * through here so the portal stays visually consistent with the public site.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

export function archiveDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function archiveDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${archiveDate(date)} ${hh}:${mm}`;
}

/** "SEP 2025–PRESENT" — the term format already used on the team page. */
export function term(startedOn: string | null, endedOn: string | null): string {
  if (!startedOn) return '—';
  const start = new Date(startedOn);
  const head = `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  if (!endedOn) return `${head}–PRESENT`;
  const end = new Date(endedOn);
  return `${head}–${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return archiveDate(value);
}

/**
 * Whole days since a timestamp, or null if there isn't one.
 *
 * Used to age a queue: something submitted this morning and something that has
 * been sitting for three weeks are not equally urgent, and an admin should be
 * able to see which is which without reading dates.
 */
export function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Human label for an enum value: 'changes_requested' -> 'CHANGES REQUESTED'. */
export function enumLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replaceAll('_', ' ').replaceAll('-', ' ').toUpperCase();
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((w) => w.charAt(0)).join('').toUpperCase() || '?';
}

/** A short archive-style identifier, e.g. 0x1F, derived from a uuid. */
export function shortId(uuid: string): string {
  return '0x' + uuid.replace(/-/g, '').slice(0, 4).toUpperCase();
}
