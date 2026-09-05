/**
 * The registration section of the event editor.
 *
 * Both the admin project editor and the advisor event editor grow the same
 * block, so it lives here rather than being written twice and diverging. What
 * it collects is deliberately small: whether registration is open, which
 * template, and what the worksheet is called. Column headings are never
 * touched here — the browser sends a template key and the Edge Function looks
 * the columns up. A text box full of worksheet headings would be a contract
 * between three systems sitting in a form field.
 */
import { h } from './dom.js';
import { field, notice } from './ui.js';
import { requireClient, callFunction, readableError } from './supabase.js';

export interface RegistrationTemplate {
  template_key: string;
  label: string;
  description: string;
  headers: string[];
  is_selectable: boolean;
}

export interface RegistrationForm {
  event_key: string;
  project_id: string | null;
  sheet_name: string;
  template_key: string;
  label: string;
  is_active: boolean;
  headers: string[];
}

export interface ProvisionResult {
  registration_enabled: boolean;
  sheet_name: string | null;
  template_key: string | null;
  sheet_created: boolean;
  sheet_status?: 'created' | 'seeded' | 'verified';
  sheet_ready?: boolean;
  warning?: string;
  warnings?: string[];
  message?: string;
}

/**
 * Worksheet name rules, repeated from the Edge Function so the form can object
 * before a round trip. The server checks the same thing and is the authority;
 * this is a courtesy, never a gate.
 */
export const SHEET_NAME_PATTERN = /^[a-z][a-z0-9_-]{2,40}$/;

const CANONICAL_WORKSHEETS = [
  'people', 'membership applications', 'members', 'club positions',
  'opportunity positions', 'position applications', 'event participation',
  'contributions', 'inquiries', 'university export log',
];

export function sheetNameProblem(name: string): string | null {
  const value = String(name ?? '');
  if (!value) return 'Enter a worksheet name.';
  if (!SHEET_NAME_PATTERN.test(value)) {
    return 'Use 3–41 characters: lowercase letters, digits, underscore or hyphen, ' +
      'starting with a letter. For example: hackathon261.';
  }
  if (CANONICAL_WORKSHEETS.includes(value.toLowerCase())) {
    return `"${value}" is one of the records mirror worksheets. Choose another name.`;
  }
  return null;
}

/** The worksheet name suggested for an event — a starting point, not a rule. */
export function suggestSheetName(title: string, term?: string | null): string {
  const words = String(title ?? '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((word) => word && !['acm', 'psu', 'club', 'the', 'and', 'of', 'term'].includes(word));
  const stem = words.filter((word) => !/^\d+$/.test(word)).join('').slice(0, 28) || 'event';
  const suffix = String(term ?? '').replace(/[^0-9]/g, '').slice(0, 4);
  const name = `${stem}${suffix}`;
  return SHEET_NAME_PATTERN.test(name) ? name : `${stem}form`.slice(0, 41);
}

export async function registrationTemplates(): Promise<RegistrationTemplate[]> {
  const { data, error } = await requireClient()
    .from('registration_templates')
    .select('template_key, label, description, headers, is_selectable')
    .order('rank');
  if (error) throw new Error(readableError(error));
  return (data ?? []) as RegistrationTemplate[];
}

/** The registration form already attached to this event, if any. */
export async function eventRegistrationForm(projectId: string): Promise<RegistrationForm | null> {
  const { data, error } = await requireClient()
    .from('event_registration_forms')
    .select('event_key, project_id, sheet_name, template_key, label, is_active, headers')
    .eq('project_id', projectId).maybeSingle();
  if (error) throw new Error(readableError(error));
  return (data as RegistrationForm | null) ?? null;
}

/** Whether this form's template and worksheet name are settled by real rows. */
export async function registrationFormLocked(eventKey: string): Promise<boolean> {
  const { data, error } = await requireClient()
    .rpc('registration_form_locked', { form_key: eventKey });
  if (error) throw new Error(readableError(error));
  return data === true;
}

export async function provisionRegistration(payload: {
  project_id: string; enabled: boolean;
  template_key?: string; sheet_name?: string; label?: string;
}): Promise<ProvisionResult> {
  const response = await callFunction('event-registration-provision', payload);
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(result.error ?? 'Registration setup failed.');
  return result as ProvisionResult;
}

/**
 * The Registration block for an event editor.
 *
 * Returns the element to drop into the form and a `read()` that reports what
 * the admin chose. The caller decides when to act on it, because creating an
 * event and provisioning its registration are two steps and the first must
 * survive the second failing.
 */
export function registrationSection(options: {
  templates: RegistrationTemplate[];
  existing: RegistrationForm | null;
  locked: boolean;
  title: string;
  term?: string | null;
  /** Absent while creating: registration is set up after the event exists. */
  projectId?: string | null;
}): { element: HTMLElement; read: () => { enabled: boolean; template_key: string; sheet_name: string } } {
  const { templates, existing, locked } = options;
  const selectable = templates.filter((t) => t.is_selectable || t.template_key === existing?.template_key);

  const enable = h('input', {
    type: 'checkbox', id: 'registration-enabled', name: 'registration_enabled',
    checked: existing?.is_active ?? false,
  }) as HTMLInputElement;

  const templateSelect = field({
    label: 'Registration template', name: 'registration_template', type: 'select',
    value: existing?.template_key ?? selectable[0]?.template_key ?? '',
    disabled: locked,
    options: selectable.map((t) => ({ value: t.template_key, label: t.label })),
    hint: locked ? 'Locked: registrations have already been recorded against these columns.' : undefined,
  });
  const templateControl = templateSelect.querySelector('select') as HTMLSelectElement;

  const sheetField = field({
    label: 'Registration worksheet', name: 'registration_sheet',
    value: existing?.sheet_name ?? suggestSheetName(options.title, options.term),
    disabled: locked, maxlength: 41,
    hint: locked
      ? 'Locked: registrations have already been recorded in this worksheet.'
      : 'A tab in the ACM PSU — Club Records workbook. Lowercase letters, digits, ' +
        'underscore or hyphen — for example hackathon261. Created automatically if it does not exist.',
  });
  const sheetControl = sheetField.querySelector('input') as HTMLInputElement;

  // What the chosen template will actually put in the worksheet. Shown before
  // anything is created, because the columns are the part that cannot be
  // changed later without exporting and starting again.
  const columns = h('div', { class: 'registration-columns' });
  function paintColumns(): void {
    const chosen = templates.find((t) => t.template_key === templateControl.value);
    const parts: Node[] = [
      h('p', { class: 'mono-meta dim-text' }, 'WORKSHEET COLUMNS'),
      h('div', { class: 'tag-list' },
        (chosen?.headers ?? []).map((header) => h('span', { class: 'tag tag--sm' }, header))),
    ];
    if (chosen?.description) parts.push(h('p', { class: 'field-hint mono-meta dim-text' }, chosen.description));
    columns.replaceChildren(...parts);
  }
  paintColumns();
  templateControl.addEventListener('change', paintColumns);

  const details = h('div', { class: 'registration-details' }, templateSelect, sheetField, columns);
  function paintEnabled(): void { details.hidden = !enable.checked; }
  paintEnabled();
  enable.addEventListener('change', paintEnabled);

  const element = h('fieldset', { class: 'registration-section' },
    h('legend', { class: 'mono-meta' }, 'PUBLIC REGISTRATION'),
    h('label', { class: 'checkbox-row', for: 'registration-enabled' },
      enable, h('span', 'Enable registration for this event')),
    existing && !existing.is_active
      ? notice('info', `Registration is currently closed. The worksheet "${existing.sheet_name}" and ` +
        'every registration already recorded are untouched; re-enabling reopens the same form.')
      : null,
    details,
    !options.projectId
      ? h('p', { class: 'field-hint mono-meta dim-text' },
        'THE WORKSHEET IS CREATED RIGHT AFTER THE EVENT IS SAVED.')
      : null,
  );

  return {
    element,
    read: () => ({
      enabled: enable.checked,
      template_key: templateControl.value,
      sheet_name: sheetControl.value.trim(),
    }),
  };
}

/** A sentence describing what provisioning did, for a toast or a notice. */
export function provisionSummary(result: ProvisionResult): string {
  if (!result.registration_enabled) return result.message ?? 'Registration closed.';
  if (result.sheet_ready === false) return result.warning ?? 'The worksheet could not be prepared.';
  const what = result.sheet_status === 'created' ? 'created'
    : result.sheet_status === 'seeded' ? 'given its header row'
      : 'already correct';
  return `Registration is open. Worksheet "${result.sheet_name}" ${what}.`;
}
