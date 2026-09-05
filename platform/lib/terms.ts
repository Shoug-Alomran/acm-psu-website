/**
 * PSU term codes.
 *
 * The university numbers each term <YY><T>: the last two digits of the
 * Gregorian year the academic year *starts* in, followed by the term within
 * that year. So 261 is the Fall that begins in 2026, 262 the Spring that
 * follows it in 2027, and 263 that same academic year's summer.
 *
 * The boundaries below come from PSU's maintained academic calendar. They are
 * intentionally explicit: for example Term 262 begins on 13 December 2026,
 * so broad month-based guesses would incorrectly call it Term 261.
 *
 * There is no semester column anywhere in the database; the club is organised
 * by chapter year. Terms are therefore derived from each record's own date,
 * which is why this lives in one place rather than being re-guessed per page.
 */

export interface Term {
  /** The university's code, e.g. '261'. */
  code: string;
  /** Human label, e.g. 'Fall 2026'. */
  label: string;
  /** First day of the term, inclusive, as YYYY-MM-DD. */
  start: string;
  /** Last day of the term, inclusive, as YYYY-MM-DD. */
  end: string;
}

/**
 * Normalise any stored date to YYYY-MM-DD.
 *
 * Values reach us as plain dates ('2026-09-05') and as full timestamps
 * ('2026-09-05T12:00:00Z'); both start with the calendar date, which is all a
 * term needs. Anything else is not a date we can place.
 */
export function isoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? match[0] : null;
}

export const PSU_TERMS: Term[] = [
  { code: '251', label: 'First Semester 2025–2026', start: '2025-08-17', end: '2025-12-20' },
  { code: '252', label: 'Second Semester 2025–2026', start: '2025-12-21', end: '2026-06-06' },
  { code: '253', label: 'Summer Semester 2025–2026', start: '2026-06-07', end: '2026-08-08' },
  { code: '261', label: 'First Semester 2026–2027', start: '2026-08-09', end: '2026-12-12' },
  { code: '262', label: 'Second Semester 2026–2027', start: '2026-12-13', end: '2027-05-29' },
  { code: '263', label: 'Summer Semester 2026–2027', start: '2027-05-30', end: '2027-08-21' },
  { code: '271', label: 'First Semester 2027–2028', start: '2027-08-22', end: '2027-12-25' },
  { code: '272', label: 'Second Semester 2027–2028', start: '2027-12-26', end: '2028-06-17' },
  { code: '273', label: 'Summer Semester 2027–2028', start: '2028-06-18', end: '2028-08-19' },
  { code: '281', label: 'First Semester 2028–2029', start: '2028-08-20', end: '2028-12-23' },
  { code: '282', label: 'Second Semester 2028–2029', start: '2028-12-24', end: '2029-06-16' },
  { code: '283', label: 'Summer Semester 2028–2029', start: '2029-06-17', end: '2029-08-16' },
];

/** The term a single calendar date belongs to, or null if it is not a date. */
export function termForDate(value: unknown): Term | null {
  const date = isoDate(value);
  if (!date) return null;
  return PSU_TERMS.find((term) => term.start <= date && date <= term.end) ?? null;
}

/** The term containing today. */
export function currentTerm(today = new Date()): Term {
  return termForDate(today.toISOString().slice(0, 10)) ?? PSU_TERMS[PSU_TERMS.length - 1]!;
}

function step(term: Term): Term {
  const index = PSU_TERMS.findIndex((candidate) => candidate.code === term.code);
  return PSU_TERMS[Math.min(index + 1, PSU_TERMS.length - 1)]!;
}

/**
 * Every term a span touches, oldest first.
 *
 * A membership or an assignment is not a moment but a stretch of time, so it
 * belongs to each term it overlaps. An open end is treated as "still running"
 * and stops at the current term rather than running away.
 */
export function termsInSpan(start: unknown, end: unknown, today = new Date()): Term[] {
  const from = isoDate(start);
  const to = isoDate(end);
  // A span with no dates at all cannot be placed in any term.
  if (!from && !to) return [];

  const first = termForDate(from ?? to);
  if (!first) return [];
  // An open end means "still running", so it stops at the current term.
  const stop = to ? termForDate(to) : currentTerm(today);
  if (!stop) return [];
  // Covers a span that ends before it starts, and one that has not begun yet.
  if (stop.start < first.start) return [first];

  const out: Term[] = [];
  let cursor = first;
  // Bounded so a malformed date can never spin here.
  for (let i = 0; i < 400 && cursor.start <= stop.start; i += 1) {
    out.push(cursor);
    const next = step(cursor);
    if (next.code === cursor.code) break;
    cursor = next;
  }
  return out;
}

/** Sorts terms newest first, which is the order these lists are read in. */
export function newestFirst(terms: Term[]): Term[] {
  return [...terms].sort((a, b) => b.start.localeCompare(a.start));
}
