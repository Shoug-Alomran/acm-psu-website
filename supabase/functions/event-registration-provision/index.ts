/**
 * event-registration-provision — give an event a public registration form.
 *
 * An admin or an assigned advisory instructor enables registration on an event,
 * picks a template and a worksheet name, and this does the three things that
 * used to require a migration, an Apps Script edit and a hand-made worksheet:
 *
 *   1. records the form in event_registration_forms, linked to the event;
 *   2. makes sure the worksheet exists in the club records workbook with
 *      exactly the template's columns;
 *   3. leaves everything else alone.
 *
 * Nothing here is event-specific. A new event is a row and a worksheet, and
 * the records backup and the registration import both already iterate every
 * active form, so neither of them learns a new name.
 *
 * WHAT IT REFUSES. Headings never come from the browser — only a template_key,
 * looked up here. A worksheet name is validated before it reaches Google. An
 * existing worksheet whose columns disagree is reported, never overwritten.
 * And once a form has recorded its first registration, its template and
 * worksheet name are settled: the columns describe rows that exist, and a
 * rename would leave them pointing at a worksheet nobody writes to.
 *
 * ORDER OF WRITES. The database row is written first and Google second, so a
 * Google failure leaves a form that is recorded but not yet provisioned — a
 * state the response names and the admin can retry. The reverse order would
 * leave an orphaned worksheet nothing knows about.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { clientForRequest, corsHeaders, fail, json } from '../_shared/http.ts';
import { ensureEventWorksheet } from '../_shared/google_sheets.ts';
import { sheetNameProblem } from '../_shared/registration_names.ts';

type Template = { template_key: string; label: string; headers: string[]; is_selectable: boolean };
type Form = {
  event_key: string; sheet_name: string; template_key: string;
  project_id: string | null; label: string; is_active: boolean;
};

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Edge Function configuration error: Supabase credentials are unavailable.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return fail('POST only', 405, origin);

  const caller = clientForRequest(req);
  if (!caller) return fail('Sign in required.', 401, origin);
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return fail('Sign in required.', 401, origin);

  let body: {
    project_id?: string; enabled?: boolean;
    template_key?: string; sheet_name?: string; label?: string;
  } = {};
  try { body = await req.json(); } catch { return fail('Expected a JSON body.', 400, origin); }

  const projectId = String(body.project_id ?? '');
  if (!projectId) return fail('An event is required.', 400, origin);

  // Authorization is a database question, asked with the caller's own token:
  // club admin for any event, advisory instructor only for one they organise.
  // Reviewers and members hold neither and land here.
  const { data: permitted, error: permissionError } = await caller
    .rpc('may_provision_registration', { target_project: projectId });
  if (permissionError) return fail(`Permission check failed: ${permissionError.message}`, 500, origin);
  if (permitted !== true) {
    return fail('You may only set up registration for an event you administer or organise.', 403, origin);
  }

  let service: SupabaseClient;
  try { service = serviceClient(); } catch (error) {
    return fail(error instanceof Error ? error.message : 'Configuration error.', 500, origin);
  }

  // The event itself, read with the service role now that the caller's right
  // to act on it has been established.
  const { data: project, error: projectError } = await service
    .from('projects').select('id, title, kind, deleted_at').eq('id', projectId).maybeSingle();
  if (projectError) return fail(`Event could not be read: ${projectError.message}`, 500, origin);
  if (!project || project.deleted_at) return fail('Event not found.', 404, origin);

  const { data: existingRow, error: existingError } = await service
    .from('event_registration_forms')
    .select('event_key, sheet_name, template_key, project_id, label, is_active')
    .eq('project_id', projectId).maybeSingle();
  if (existingError) return fail(`Registration form could not be read: ${existingError.message}`, 500, origin);
  const existing = existingRow as Form | null;

  // ---- closing registration -----------------------------------------------
  // Never deletes the worksheet and never deletes a recorded registration:
  // closing a form is a statement about the future, not about the past.
  if (body.enabled === false) {
    if (!existing) return json({ registration_enabled: false, sheet_name: null, template_key: null, sheet_created: false }, 200, origin);
    const { error } = await service.from('event_registration_forms')
      .update({ is_active: false }).eq('event_key', existing.event_key);
    if (error) return fail(`Registration could not be closed: ${error.message}`, 500, origin);
    return json({
      registration_enabled: false,
      sheet_name: existing.sheet_name,
      template_key: existing.template_key,
      sheet_created: false,
      message: 'Registration is closed. The worksheet and every recorded registration are unchanged.',
    }, 200, origin);
  }

  // ---- opening or updating registration ------------------------------------
  const templateKey = String(body.template_key ?? '');
  const { data: templateRow, error: templateError } = await service
    .from('registration_templates')
    .select('template_key, label, headers, is_selectable').eq('template_key', templateKey).maybeSingle();
  if (templateError) return fail(`Templates could not be read: ${templateError.message}`, 500, origin);
  const template = templateRow as Template | null;
  if (!template) return fail(`Unknown registration template "${templateKey}".`, 400, origin);
  // A legacy template describes a worksheet that already exists; it is not a
  // shape to build a new form from. Keeping it on the form it belongs to is
  // fine, which is why this only blocks a change.
  if (!template.is_selectable && template.template_key !== existing?.template_key) {
    return fail(`"${template.label}" describes an existing worksheet and cannot be chosen for an event.`, 400, origin);
  }

  const sheetName = String(body.sheet_name ?? '').trim();
  const problem = sheetNameProblem(sheetName);
  if (problem) return fail(problem, 400, origin);

  // Another event's worksheet. The unique constraint would catch this too;
  // catching it here names the event instead of raising a constraint error.
  const { data: clash, error: clashError } = await service
    .from('event_registration_forms')
    .select('event_key, project_id').eq('sheet_name', sheetName).maybeSingle();
  if (clashError) return fail(`Worksheet names could not be checked: ${clashError.message}`, 500, origin);
  if (clash && clash.project_id !== projectId) {
    return fail(`The worksheet "${sheetName}" is already used by another event's registration form.`, 409, origin);
  }

  // ---- what may still be changed -------------------------------------------
  if (existing) {
    const { data: locked, error: lockError } = await service
      .rpc('registration_form_locked', { form_key: existing.event_key });
    if (lockError) return fail(`Registration state could not be read: ${lockError.message}`, 500, origin);
    if (locked === true) {
      if (existing.template_key !== template.template_key) {
        return fail(
          `Registrations have already been recorded for this event, so the template cannot change. ` +
          `The columns describe rows that exist. Export those registrations and set up a new event ` +
          `form if a different shape is needed.`, 409, origin);
      }
      if (existing.sheet_name !== sheetName) {
        return fail(
          `Registrations have already been recorded in "${existing.sheet_name}", so the worksheet ` +
          `name cannot change. Renaming it would leave those registrations pointing at a worksheet ` +
          `nothing writes to.`, 409, origin);
      }
    }
  }

  const label = String(body.label ?? '').trim() || project.title;
  const eventKey = existing?.event_key ?? sheetName;

  // The row first: a form recorded without its worksheet is recoverable by
  // pressing the button again, an orphaned worksheet is not.
  const { error: upsertError } = await service.from('event_registration_forms')
    .upsert({
      event_key: eventKey,
      project_id: projectId,
      sheet_name: sheetName,
      template_key: template.template_key,
      headers: template.headers,
      label,
      is_active: true,
      ...(existing ? {} : { created_by: auth.user.id }),
    }, { onConflict: 'event_key' });
  if (upsertError) return fail(`Registration form could not be saved: ${upsertError.message}`, 500, origin);

  const spreadsheetId = Deno.env.get('EVENT_REGISTRATION_SPREADSHEET_ID')
    ?? Deno.env.get('GOOGLE_SHEETS_SPREADSHEET_ID');
  if (!spreadsheetId) {
    return json({
      registration_enabled: true, sheet_name: sheetName, template_key: template.template_key,
      sheet_created: false, sheet_ready: false,
      warning: 'The registration form is saved, but GOOGLE_SHEETS_SPREADSHEET_ID is not set so the ' +
        'worksheet could not be created. Set it and press SET UP REGISTRATION again.',
    }, 200, origin);
  }

  try {
    const sheet = await ensureEventWorksheet(spreadsheetId, sheetName, template.headers);
    return json({
      registration_enabled: true,
      sheet_name: sheetName,
      template_key: template.template_key,
      sheet_created: sheet.status === 'created',
      sheet_status: sheet.status,
      sheet_ready: true,
      ...(sheet.warnings.length ? { warnings: sheet.warnings } : {}),
    }, 200, origin);
  } catch (error) {
    // The event and its form both survive. Only the worksheet is missing, and
    // pressing the button again is the retry.
    return json({
      registration_enabled: true,
      sheet_name: sheetName,
      template_key: template.template_key,
      sheet_created: false,
      sheet_ready: false,
      warning: `The registration form is saved, but the worksheet could not be prepared: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    }, 200, origin);
  }
});
