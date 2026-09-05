/**
 * Placing club-record rows into PSU terms.
 *
 * Which column dates a row is a property of the workbook, not of the page that
 * happens to draw it, so it lives here next to the term maths rather than
 * inside the admin view. The headings below are the ones the
 * club-records-sheet-sync Edge Function emits.
 */
import { termForDate, termsInSpan, type Term } from './terms.js';

/**
 * Some rows are a moment ('point') and some are a stretch ('span'). A
 * membership or an assignment belongs to every term it overlaps, not only the
 * one it began in.
 *
 * 'People' is deliberately absent: it is a current roster of accounts with no
 * per-row date, so it cannot be split by term and is shown in full.
 */
export type DateRule =
  | { kind: 'point'; column: string }
  | { kind: 'span'; from: string; to: string };

export const DATE_RULES: Record<string, DateRule> = {
  People: { kind: 'point', column: 'Registration Date' },
  'Membership Applications': { kind: 'point', column: 'Registration Date' },
  Members: { kind: 'point', column: 'Registration Date' },
  'Club Positions': { kind: 'span', from: 'Assignment Start', to: 'Assignment End' },
  'Opportunity Positions': { kind: 'point', column: 'Created At' },
  'Position Applications': { kind: 'point', column: 'Applied At' },
  'Event Participation': { kind: 'span', from: 'Started', to: 'Ended' },
  Contributions: { kind: 'point', column: 'Occurred On' },
  Inquiries: { kind: 'point', column: 'Received' },
  'University Export Log': { kind: 'point', column: 'Generated At' },
};

/**
 * Builds the term lookup for one worksheet, or null when it cannot be placed
 * in time. Columns are matched by heading rather than by position, so adding a
 * column upstream cannot silently shift the filter onto the wrong date — if
 * the heading is gone the worksheet stops filtering instead of mis-filtering.
 */
export function termsResolver(
  columns: unknown[], sheetName: string,
): ((row: unknown[]) => Term[]) | null {
  const rule = DATE_RULES[sheetName];
  if (!rule) return null;
  const indexOf = (name: string) => columns.findIndex((c) => String(c) === name);

  if (rule.kind === 'point') {
    const at = indexOf(rule.column);
    if (at < 0) return null;
    return (row) => { const t = termForDate(row[at]); return t ? [t] : []; };
  }

  const from = indexOf(rule.from);
  const to = indexOf(rule.to);
  if (from < 0 || to < 0) return null;
  return (row) => termsInSpan(row[from], row[to]);
}

/** RFC 4180 quoting, plus the leading-character guard against formula
 *  injection — these exports carry text submitted by the public. Mirrors the
 *  same rule in the records-export Edge Function. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Rows that need someone to act.
 *
 * 'submitted' is an applicant nobody has contacted yet; 'interview' is one
 * part-way through the process. The Status column still spells both out in
 * words, so the colour is a second signal rather than the only one — and the
 * workbook sync tints the same two states in Google Sheets.
 */
export type RowTint = 'new' | 'interview';

interface TintRule { column: string; values: Record<string, RowTint> }

const TINT_RULES: Record<string, TintRule> = {
  'Membership Applications': {
    column: 'Status',
    values: { submitted: 'new', interview: 'interview' },
  },
};

/** Builds the row-tint lookup for one worksheet, or null when it has none. */
export function rowTintResolver(
  columns: unknown[], sheetName: string,
): ((row: unknown[]) => RowTint | null) | null {
  const rule = TINT_RULES[sheetName];
  if (!rule) return null;
  const at = columns.findIndex((c) => String(c) === rule.column);
  if (at < 0) return null;
  return (row) => rule.values[String(row[at])] ?? null;
}
