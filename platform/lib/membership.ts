/**
 * The vocabulary of membership.
 *
 * Interests and academic years are asked for in two places — when an account
 * is created, and again on the membership application — so they live here
 * rather than in either page. Two copies of this list would drift, and a
 * member would then see their own answer disappear from the second form
 * because the values no longer matched.
 */

export interface Choice {
  value: string;
  label: string;
}

export const INTERESTS: Choice[] = [
  { value: 'programming', label: 'Programming' },
  { value: 'cybersecurity', label: 'Cybersecurity' },
  { value: 'ai', label: 'AI & Machine Learning' },
  { value: 'web-development', label: 'Web Development' },
  { value: 'design-media', label: 'Design & Media' },
  { value: 'event-organising', label: 'Event Organising' },
  { value: 'workshops', label: 'Teaching & Workshops' },
  { value: 'competitions', label: 'Competitions & CTFs' },
  { value: 'documentation', label: 'Writing & Documentation' },
  { value: 'community', label: 'Community & Outreach' },
];

export const ACADEMIC_YEARS: Choice[] = [
  'Foundation',
  'Year 1',
  'Year 2',
  'Year 3',
  'Year 4',
  'Year 5+',
  'Graduate',
].map((year) => ({ value: year, label: year }));

/** Keeps only values that are actually in the catalogue. */
export function knownInterests(values: string[]): string[] {
  const allowed = new Set(INTERESTS.map((choice) => choice.value));
  return values.filter((value) => allowed.has(value));
}
