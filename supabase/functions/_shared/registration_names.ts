/**
 * Worksheet names for public event registration.
 *
 * A registration worksheet name is chosen by a human in the event form and
 * then handed to Google, so it is validated here rather than trusted. The same
 * rules are stated in three places on purpose — this module, a CHECK
 * constraint on event_registration_forms, and the browser form that suggests a
 * default — because each of the three is reached by a different route and the
 * database is the one that must not be got past.
 */

/** Mirror worksheets, which the snapshot sync clears on every refresh. */
const CANONICAL_WORKSHEETS = [
  'People', 'Membership Applications', 'Members', 'Club Positions',
  'Opportunity Positions', 'Position Applications', 'Event Participation',
  'Contributions', 'Inquiries', 'University Export Log',
];

/**
 * Lowercase, starts with a letter, then letters/digits/underscore/hyphen.
 * 3–41 characters. Matches event_registration_forms_sheet_shape.
 */
export const SHEET_NAME_PATTERN = /^[a-z][a-z0-9_-]{2,40}$/;

/**
 * Why this name cannot be used, or null when it can.
 *
 * Returns a sentence an admin can act on rather than a boolean, because every
 * rejection here is something they typed and can fix.
 */
export function sheetNameProblem(name: string): string | null {
  const value = String(name ?? '');
  if (!value) return 'Enter a worksheet name.';
  if (value !== value.trim()) return 'A worksheet name cannot start or end with a space.';
  if (!SHEET_NAME_PATTERN.test(value)) {
    return 'Use 3–41 characters: lowercase letters, digits, underscore or hyphen, ' +
      'starting with a letter. For example: hackathon261.';
  }
  if (CANONICAL_WORKSHEETS.some((tab) => tab.toLowerCase() === value.toLowerCase())) {
    return `"${value}" is one of the Supabase mirror worksheets, which are rebuilt on every ` +
      'records sync. Choose another name.';
  }
  return null;
}

/**
 * The worksheet name suggested for an event.
 *
 * Aims at the shape the club already uses — a short word plus the PSU term
 * code, like hackathon261 — by taking the leading words of the title and
 * appending the term. It is only a suggestion: the form lets it be edited
 * before anything is created, because only a human knows what the event will
 * be called in conversation.
 */
export function suggestSheetName(title: string, term?: string | null): string {
  const words = String(title ?? '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word && !['acm', 'psu', 'club', 'the', 'and', 'of', 'term'].includes(word));

  // Digits already in the title are usually the year or edition, and the term
  // code carries that better, so they are dropped from the word part.
  const stem = words.filter((word) => !/^\d+$/.test(word)).join('').slice(0, 28) || 'event';
  const suffix = String(term ?? '').replace(/[^0-9]/g, '').slice(0, 4);
  const name = `${stem}${suffix}`;
  return SHEET_NAME_PATTERN.test(name) ? name : `${stem}form`.slice(0, 41);
}
