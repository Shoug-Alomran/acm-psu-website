/**
 * Dynamic event registration provisioning.
 *
 * Three layers, tested against the real source rather than a description of
 * it: the worksheet-name rules, the Google worksheet helper, and the Edge
 * Function that ties an event to a form and a worksheet.
 *
 * The Deno modules are bundled with esbuild; `jsr:@supabase/supabase-js@2` is
 * redirected to an in-memory stub that keeps real tables, so a test can assert
 * on the rows that would exist afterwards.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const SPREADSHEET = 'test-workbook-id';
const STUB = resolve('tests/support/supabase-stub.mjs');

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const outDir = mkdtempSync(join(tmpdir(), 'acm-provision-'));

/** Redirects the jsr: import to the stub; everything else bundles normally. */
const jsrToStub = {
  name: 'jsr-to-stub',
  setup(builder) {
    builder.onResolve({ filter: /^jsr:/ }, () => ({ path: STUB }));
  },
};

async function bundle(entry, name) {
  const outfile = join(outDir, `${name}.mjs`);
  await build({
    entryPoints: [entry], outfile, bundle: true, format: 'esm',
    platform: 'neutral', logLevel: 'silent', plugins: [jsrToStub],
  });
  return pathToFileURL(outfile).href;
}

globalThis.Deno = {
  env: {
    get: (key) => ({
      GOOGLE_SHEETS_SPREADSHEET_ID: SPREADSHEET,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'acm-sheets-writer@example.iam.gserviceaccount.com',
      GOOGLE_PRIVATE_KEY: privateKey,
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    })[key],
  },
  // The function calls Deno.serve at import time; capture the handler instead.
  serve: (handler) => { globalThis.__handler = handler; },
};

const names = await import(await bundle('supabase/functions/_shared/registration_names.ts', 'names'));
const sheets = await import(await bundle('supabase/functions/_shared/google_sheets.ts', 'sheets'));
await import(await bundle('supabase/functions/event-registration-provision/index.ts', 'provision'));
const handler = globalThis.__handler;
assert.ok(typeof handler === 'function', 'the provisioning function registered a handler');

/* ------------------------------------------------------------ Google stub */

const TEAM_STRUCTURED_3 = [
  'Timestamp', 'Team Name',
  'Captain Name', 'Captain University ID', 'Captain University Email',
  'Captain Phone Number', 'Captain Major',
  'Member 2 Name', 'Member 2 University ID', 'Member 2 University Email', 'Member 2 Major',
  'Member 3 Name', 'Member 3 University ID', 'Member 3 University Email', 'Member 3 Major',
  'Experience Level',
];
const TEAM_BASIC = [
  'Timestamp', 'Team Name', 'Captain Name', 'Captain University ID',
  'Captain University Email', 'Captain Phone Number', 'Captain Major', 'Team Members',
];

/**
 * A workbook whose tabs hold real rows, so "nothing was cleared" is something
 * a test can check rather than assume.
 */
function workbook(tabs = {}) {
  const state = { tabs: structuredClone(tabs), calls: { batches: [], writes: [], clears: [] } };
  let nextId = 100;

  globalThis.fetch = async (url, init = {}) => {
    const address = String(url);
    const ok = (payload) => new Response(JSON.stringify(payload), { status: 200 });
    if (address === 'https://oauth2.googleapis.com/token') return ok({ access_token: 'test-token' });

    const base = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}`;
    assert.ok(address.startsWith(base), `unexpected request ${address}`);
    const path = address.slice(base.length);
    const body = init.body ? JSON.parse(init.body) : null;

    if (path === '') {
      return ok({ sheets: Object.keys(state.tabs).map((title, index) => ({
        properties: { title, sheetId: index + 1 } })) });
    }

    if (path === ':batchUpdate') {
      state.calls.batches.push(body.requests);
      const add = body.requests.find((request) => request.addSheet);
      if (add) {
        const title = add.addSheet.properties.title;
        state.tabs[title] = [];
        nextId += 1;
        return ok({ replies: [{ addSheet: { properties: { title, sheetId: nextId } } }] });
      }
      return ok({ replies: [] });
    }

    if (path.endsWith(':clear')) { state.calls.clears.push(path); return ok({}); }

    if (init.method === 'PUT') {
      const tab = decodeURIComponent(path.slice('/values/'.length).split('!')[0]);
      state.calls.writes.push({ tab, values: body.values });
      const rows = state.tabs[tab] ??= [];
      body.values.forEach((line, index) => { rows[index] = line; });
      return ok({});
    }

    if (path.startsWith('/values/')) {
      const tab = decodeURIComponent(path.slice('/values/'.length).split('!')[0]);
      const rows = state.tabs[tab] ?? [];
      return ok({ values: rows.length ? [rows[0]] : [] });
    }

    throw new Error(`unhandled ${address}`);
  };

  return state;
}

/* ------------------------------------------------------- Supabase fixture */

const TEMPLATES = [
  { template_key: 'INDIVIDUAL', label: 'Individual', headers: ['Timestamp', 'Full Name', 'University ID', 'University Email', 'Phone Number', 'Major'], is_selectable: true },
  { template_key: 'TEAM_BASIC', label: 'Basic team', headers: TEAM_BASIC, is_selectable: true },
  { template_key: 'TEAM_STRUCTURED_3', label: 'Structured 3-person team', headers: TEAM_STRUCTURED_3, is_selectable: true },
  { template_key: 'LEGACY_JAM26', label: 'Programming Jam 2026 (legacy)', headers: ['Timestamp', 'Full Name', 'University ID', 'University Email', 'Phone Number', 'Major', 'Team Name', 'Team Members'], is_selectable: false },
];

const HACKATHON = { id: 'proj-hack', title: 'ACM Club Hackathon — Term 261', kind: 'event', deleted_at: null };

function fixture({ permitted = true, user = { id: 'user-1' }, forms = [], registrations = [], projects = [HACKATHON] } = {}) {
  const state = {
    tables: {
      projects: structuredClone(projects),
      registration_templates: structuredClone(TEMPLATES),
      event_registration_forms: structuredClone(forms),
      event_registrations: structuredClone(registrations),
    },
    user,
    writes: [],
    rpcCalls: [],
    rpc: {
      may_provision_registration: () => ({ data: permitted, error: null }),
      registration_form_locked: ({ form_key }) => ({
        data: state.tables.event_registrations.some((row) => row.event_key === form_key),
        error: null,
      }),
    },
  };
  globalThis.__supabaseFixture = state;
  return state;
}

const call = async (body, headers = { Authorization: 'Bearer token' }) => {
  const response = await handler(new Request('https://fn.test/provision', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: response.status, payload: await response.json() };
};

let count = 0;
async function test(name, fn) { await fn(); count += 1; console.log('PASS ' + name); }

/* ------------------------------------------------------------ name rules */

await test('worksheet names are validated, not trusted', async () => {
  assert.equal(names.sheetNameProblem('hackathon261'), null);
  assert.equal(names.sheetNameProblem('workshop_261'), null);
  assert.equal(names.sheetNameProblem('security-day-261'), null);
  for (const bad of ['', 'ab', 'Hackathon261', '261hack', 'hack athon', 'hack!', 'a'.repeat(42), ' hack261']) {
    assert.ok(names.sheetNameProblem(bad), `"${bad}" must be rejected`);
  }
});

await test('a canonical worksheet name is refused outright', async () => {
  for (const canonical of ['People', 'people', 'Members', 'contributions', 'University Export Log']) {
    const problem = names.sheetNameProblem(canonical.toLowerCase().replace(/ /g, ''));
    // Spaced names fail the pattern; the exact lowercase ones fail the list.
    assert.ok(problem || names.sheetNameProblem(canonical), `${canonical} must never be usable`);
  }
  assert.match(names.sheetNameProblem('people'), /mirror worksheets/);
  assert.match(names.sheetNameProblem('contributions'), /mirror worksheets/);
});

await test('suggested names are usable and event-shaped', async () => {
  assert.equal(names.suggestSheetName('ACM Club Hackathon — Term 261', '261'), 'hackathon261');
  assert.equal(names.suggestSheetName('Security Day', '261'), 'securityday261');
  assert.equal(names.suggestSheetName('ACM PSU Club', null), 'event');
  for (const title of ['', '2026', '!!!', 'ACM']) {
    assert.equal(names.sheetNameProblem(names.suggestSheetName(title, '261')), null,
      `a suggestion for "${title}" must itself be valid`);
  }
});

/* ------------------------------------------------- the worksheet helper */

await test('a missing worksheet is created with the template headers', async () => {
  const book = workbook({ Members: [['Name']] });
  const result = await sheets.ensureEventWorksheet(SPREADSHEET, 'hackathon261', TEAM_BASIC);
  assert.equal(result.status, 'created');
  assert.deepEqual(book.tabs.hackathon261, [TEAM_BASIC]);
  assert.deepEqual(book.calls.clears, [], 'nothing is ever cleared');
});

await test('an existing matching worksheet is left untouched', async () => {
  const rows = [TEAM_STRUCTURED_3, ['2026-09-05', 'Team A', 'Sara', '1', 's@psu.edu.sa', '05', 'CS', '', '', '', '', '', '', '', '', 'Beginner']];
  const book = workbook({ ctf30: rows });
  const result = await sheets.ensureEventWorksheet(SPREADSHEET, 'ctf30', TEAM_STRUCTURED_3);
  assert.equal(result.status, 'verified');
  assert.deepEqual(book.calls.writes, [], 'no write of any kind');
  assert.deepEqual(book.calls.batches, [], 'not even formatting');
  assert.deepEqual(book.tabs.ctf30, rows, 'registration rows are identical');
});

await test('a mismatching worksheet blocks and preserves every row', async () => {
  const rows = [['Timestamp', 'Something Else'], ['2026-09-05', 'a registration']];
  const book = workbook({ hackathon261: rows });
  await assert.rejects(
    () => sheets.ensureEventWorksheet(SPREADSHEET, 'hackathon261', TEAM_BASIC),
    /already exists with different columns/);
  assert.deepEqual(book.tabs.hackathon261, rows);
  assert.deepEqual(book.calls.writes, []);
  assert.deepEqual(book.calls.clears, []);
});

await test('an existing empty worksheet is seeded, never a populated one', async () => {
  const book = workbook({ hackathon261: [] });
  const result = await sheets.ensureEventWorksheet(SPREADSHEET, 'hackathon261', TEAM_BASIC);
  assert.equal(result.status, 'seeded');
  assert.deepEqual(book.tabs.hackathon261, [TEAM_BASIC]);
});

await test('provisioning the same worksheet twice changes nothing the second time', async () => {
  const book = workbook({});
  const first = await sheets.ensureEventWorksheet(SPREADSHEET, 'hackathon261', TEAM_BASIC);
  const writesAfterFirst = book.calls.writes.length;
  const second = await sheets.ensureEventWorksheet(SPREADSHEET, 'hackathon261', TEAM_BASIC);
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'verified');
  assert.equal(book.calls.writes.length, writesAfterFirst, 'the second run writes nothing');
});

await test('a canonical mirror tab can never be provisioned as a registration sheet', async () => {
  const book = workbook({ Members: [['Name'], ['Sara']] });
  await assert.rejects(
    () => sheets.ensureEventWorksheet(SPREADSHEET, 'Members', TEAM_BASIC),
    /Supabase mirror worksheet/);
  assert.deepEqual(book.calls.writes, []);
});

await test('styling failures are warnings, and the worksheet still exists', async () => {
  const book = workbook({});
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    // The token exchange is form-encoded; only Sheets calls carry JSON.
    const body = String(url).endsWith(':batchUpdate') && init?.body ? JSON.parse(init.body) : null;
    if (body?.requests?.some((r) => r.repeatCell || r.updateSheetProperties)) {
      return new Response(JSON.stringify({ error: { message: "You can't set the number format of cells in a typed column." } }), { status: 400 });
    }
    return realFetch(url, init);
  };
  const result = await sheets.ensureEventWorksheet(SPREADSHEET, 'hackathon261', TEAM_BASIC);
  globalThis.fetch = realFetch;
  assert.equal(result.status, 'created');
  assert.equal(result.warnings.length, 2, 'both styling steps warned');
  assert.deepEqual(book.tabs.hackathon261, [TEAM_BASIC]);
});

/* ---------------------------------------------------- the Edge Function */

await test('a club admin provisions a new event end to end', async () => {
  const db = fixture();
  const book = workbook({ jam26: [['Timestamp']], ctf30: [TEAM_STRUCTURED_3] });
  const { status, payload } = await call({
    project_id: 'proj-hack', enabled: true,
    template_key: 'TEAM_BASIC', sheet_name: 'hackathon261',
  });
  assert.equal(status, 200);
  assert.deepEqual(
    { registration_enabled: payload.registration_enabled, sheet_name: payload.sheet_name,
      template_key: payload.template_key, sheet_created: payload.sheet_created },
    { registration_enabled: true, sheet_name: 'hackathon261', template_key: 'TEAM_BASIC', sheet_created: true });

  const form = db.tables.event_registration_forms[0];
  assert.equal(form.project_id, 'proj-hack');
  assert.equal(form.sheet_name, 'hackathon261');
  assert.equal(form.template_key, 'TEAM_BASIC');
  assert.equal(form.is_active, true);
  assert.equal(form.label, 'ACM Club Hackathon — Term 261', 'the form is labelled with the event');
  assert.deepEqual(form.headers, TEAM_BASIC, 'headings come from the template, not the request');
  assert.deepEqual(book.tabs.hackathon261, [TEAM_BASIC]);
  assert.deepEqual(book.tabs.ctf30, [TEAM_STRUCTURED_3], 'existing tabs are untouched');
});

await test('headings sent by a browser are ignored entirely', async () => {
  const db = fixture();
  workbook({});
  await call({
    project_id: 'proj-hack', enabled: true, template_key: 'INDIVIDUAL',
    sheet_name: 'hackathon261', headers: ['Anything', 'I', 'Like'],
  });
  assert.deepEqual(db.tables.event_registration_forms[0].headers,
    TEMPLATES.find((t) => t.template_key === 'INDIVIDUAL').headers);
});

await test('provisioning is idempotent', async () => {
  const db = fixture();
  const book = workbook({});
  const body = { project_id: 'proj-hack', enabled: true, template_key: 'TEAM_BASIC', sheet_name: 'hackathon261' };
  const first = await call(body);
  const second = await call(body);
  assert.equal(first.payload.sheet_created, true);
  assert.equal(second.payload.sheet_created, false);
  assert.equal(second.payload.sheet_status, 'verified');
  assert.equal(db.tables.event_registration_forms.length, 1, 'one form, not two');
  assert.deepEqual(book.tabs.hackathon261, [TEAM_BASIC]);
});

await test('an unauthorized caller is refused before anything is written', async () => {
  const db = fixture({ permitted: false });
  const book = workbook({});
  const { status, payload } = await call({
    project_id: 'proj-hack', enabled: true, template_key: 'TEAM_BASIC', sheet_name: 'hackathon261' });
  assert.equal(status, 403);
  assert.match(payload.error, /administer or organise/);
  assert.deepEqual(db.tables.event_registration_forms, []);
  assert.deepEqual(Object.keys(book.tabs), []);
});

await test('an advisory instructor assigned to the event is allowed', async () => {
  const db = fixture({ permitted: true, user: { id: 'advisor-1' } });
  workbook({});
  const { status } = await call({
    project_id: 'proj-hack', enabled: true, template_key: 'TEAM_BASIC', sheet_name: 'hackathon261' });
  assert.equal(status, 200);
  // Authorization was asked of the database with the caller's own token.
  const asked = db.rpcCalls.find((c) => c.name === 'may_provision_registration');
  assert.ok(asked && asked.asService === false, 'permission is checked as the caller, never as the service role');
  assert.deepEqual(asked.args, { target_project: 'proj-hack' });
});

await test('a signed-out caller is refused', async () => {
  fixture({ user: null });
  workbook({});
  const missing = await call({ project_id: 'proj-hack', enabled: true }, {});
  assert.equal(missing.status, 401);
  const anonymous = await call({ project_id: 'proj-hack', enabled: true });
  assert.equal(anonymous.status, 401);
});

await test('an unknown or unselectable template is refused', async () => {
  fixture(); workbook({});
  const unknown = await call({ project_id: 'proj-hack', enabled: true, template_key: 'MADE_UP', sheet_name: 'hackathon261' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.payload.error, /Unknown registration template/);

  const legacy = await call({ project_id: 'proj-hack', enabled: true, template_key: 'LEGACY_JAM26', sheet_name: 'hackathon261' });
  assert.equal(legacy.status, 400);
  assert.match(legacy.payload.error, /cannot be chosen/);
});

await test('a worksheet name already used by another event is refused', async () => {
  const db = fixture({ forms: [{ event_key: 'ctf30', project_id: 'proj-ctf', sheet_name: 'ctf30', template_key: 'TEAM_STRUCTURED_3', headers: TEAM_STRUCTURED_3, label: 'CTF 3.0', is_active: true }] });
  const book = workbook({ ctf30: [TEAM_STRUCTURED_3, ['a', 'registration']] });
  const { status, payload } = await call({
    project_id: 'proj-hack', enabled: true, template_key: 'TEAM_STRUCTURED_3', sheet_name: 'ctf30' });
  assert.equal(status, 409);
  assert.match(payload.error, /already used by another event/);
  assert.equal(db.tables.event_registration_forms.length, 1);
  assert.equal(book.tabs.ctf30.length, 2, 'the other event keeps its rows');
});

await test('an invalid worksheet name never reaches Google', async () => {
  const db = fixture();
  const book = workbook({});
  for (const bad of ['People', 'Hack261', 'hack 261', 'x']) {
    const { status } = await call({ project_id: 'proj-hack', enabled: true, template_key: 'TEAM_BASIC', sheet_name: bad });
    assert.equal(status, 400, `${bad} must be refused`);
  }
  assert.deepEqual(db.tables.event_registration_forms, []);
  assert.deepEqual(Object.keys(book.tabs), []);
});

await test('template and worksheet name lock once a registration exists', async () => {
  const forms = [{ event_key: 'hackathon261', project_id: 'proj-hack', sheet_name: 'hackathon261', template_key: 'TEAM_BASIC', headers: TEAM_BASIC, label: 'Hackathon', is_active: true }];
  const registrations = [{ event_key: 'hackathon261', fields: {} }];

  const db = fixture({ forms, registrations });
  workbook({ hackathon261: [TEAM_BASIC, ['a', 'registration']] });

  const template = await call({ project_id: 'proj-hack', enabled: true, template_key: 'INDIVIDUAL', sheet_name: 'hackathon261' });
  assert.equal(template.status, 409);
  assert.match(template.payload.error, /template cannot change/);

  const rename = await call({ project_id: 'proj-hack', enabled: true, template_key: 'TEAM_BASIC', sheet_name: 'hackathon262' });
  assert.equal(rename.status, 409);
  assert.match(rename.payload.error, /worksheet\s+name cannot change/);

  assert.equal(db.tables.event_registration_forms[0].template_key, 'TEAM_BASIC');
  assert.equal(db.tables.event_registration_forms[0].sheet_name, 'hackathon261');

  // The unchanged combination still succeeds, so a locked form can be edited.
  const same = await call({ project_id: 'proj-hack', enabled: true, template_key: 'TEAM_BASIC', sheet_name: 'hackathon261' });
  assert.equal(same.status, 200);
});

await test('both may change while no registration exists', async () => {
  const db = fixture({ forms: [{ event_key: 'hackathon261', project_id: 'proj-hack', sheet_name: 'hackathon261', template_key: 'TEAM_BASIC', headers: TEAM_BASIC, label: 'Hackathon', is_active: true }] });
  workbook({ hackathon261: [TEAM_BASIC] });
  const { status } = await call({ project_id: 'proj-hack', enabled: true, template_key: 'INDIVIDUAL', sheet_name: 'hackathon261' });
  assert.equal(status, 200);
  assert.equal(db.tables.event_registration_forms[0].template_key, 'INDIVIDUAL');
});

await test('closing registration keeps the worksheet and every recorded row', async () => {
  const db = fixture({
    forms: [{ event_key: 'hackathon261', project_id: 'proj-hack', sheet_name: 'hackathon261', template_key: 'TEAM_BASIC', headers: TEAM_BASIC, label: 'Hackathon', is_active: true }],
    registrations: [{ event_key: 'hackathon261', fields: { 'Team Name': 'A' } }],
  });
  const book = workbook({ hackathon261: [TEAM_BASIC, ['2026', 'A']] });
  const { status, payload } = await call({ project_id: 'proj-hack', enabled: false });
  assert.equal(status, 200);
  assert.equal(payload.registration_enabled, false);
  assert.equal(db.tables.event_registration_forms[0].is_active, false, 'the form is closed');
  assert.equal(db.tables.event_registration_forms.length, 1, 'the form is not deleted');
  assert.equal(db.tables.event_registrations.length, 1, 'registrations survive');
  assert.deepEqual(book.tabs.hackathon261, [TEAM_BASIC, ['2026', 'A']], 'the worksheet survives');
  assert.deepEqual(book.calls.clears, []);
});

await test('a Google failure leaves the form recorded and retryable', async () => {
  const db = fixture();
  workbook({});
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).endsWith(`/spreadsheets/${SPREADSHEET}`)
    ? new Response(JSON.stringify({ error: { message: 'The caller does not have permission' } }), { status: 403 })
    : realFetch(url, init));
  const { status, payload } = await call({
    project_id: 'proj-hack', enabled: true, template_key: 'TEAM_BASIC', sheet_name: 'hackathon261' });
  globalThis.fetch = realFetch;

  assert.equal(status, 200, 'the event and its form are not rolled back');
  assert.equal(payload.sheet_ready, false);
  assert.match(payload.warning, /could not be prepared/);
  assert.equal(db.tables.event_registration_forms.length, 1, 'the form is recorded, so pressing again retries');
});

await test('a deleted or unknown event is refused', async () => {
  fixture({ projects: [{ ...HACKATHON, deleted_at: '2026-09-01' }] });
  workbook({});
  const deleted = await call({ project_id: 'proj-hack', enabled: true, template_key: 'TEAM_BASIC', sheet_name: 'hackathon261' });
  assert.equal(deleted.status, 404);

  fixture({ projects: [] }); workbook({});
  const missing = await call({ project_id: 'proj-nope', enabled: true, template_key: 'TEAM_BASIC', sheet_name: 'hackathon261' });
  assert.equal(missing.status, 404);
});

/* ------------------------------------------------ the acceptance scenario */

await test('ACCEPTANCE: the Hackathon gets registration with no new code', async () => {
  // Exactly the documented walkthrough: an existing event, the team template,
  // and the worksheet name an organizer would type.
  const db = fixture({ projects: [HACKATHON] });
  const book = workbook({
    People: [['Name', 'PSU Email']],
    jam26: [['Timestamp', 'Full Name']],
    ctf30: [TEAM_STRUCTURED_3, ['2026-09-05', 'Existing team']],
  });

  const suggested = names.suggestSheetName(HACKATHON.title, '261');
  assert.equal(suggested, 'hackathon261', 'the UI suggests the documented name');

  const { status, payload } = await call({
    project_id: HACKATHON.id, enabled: true,
    template_key: 'TEAM_BASIC', sheet_name: suggested,
  });

  assert.equal(status, 200);
  // 1 — event_registration_forms gains a linked row.
  const form = db.tables.event_registration_forms.find((row) => row.project_id === HACKATHON.id);
  assert.ok(form, 'a form row is linked to the event');
  // 2 — the worksheet is created automatically.
  assert.equal(payload.sheet_created, true);
  assert.ok(book.tabs.hackathon261, 'the worksheet exists');
  // 3 — headers match the selected template.
  assert.deepEqual(book.tabs.hackathon261[0], TEAM_BASIC);
  assert.deepEqual(form.headers, TEAM_BASIC);
  // 4 — no existing tab is changed.
  assert.deepEqual(book.tabs.ctf30, [TEAM_STRUCTURED_3, ['2026-09-05', 'Existing team']]);
  assert.deepEqual(book.tabs.jam26, [['Timestamp', 'Full Name']]);
  assert.deepEqual(book.tabs.People, [['Name', 'PSU Email']]);
  assert.deepEqual(book.calls.clears, []);
  // 5 — the records backup names the folder after the event, because the
  //     collector renders one worksheet per ACTIVE form using its label.
  assert.equal(form.is_active, true);
  assert.equal(form.label, 'ACM Club Hackathon — Term 261');
  // 6 — the import loop finds it: it reads active forms, and this is one.
  const activeForms = db.tables.event_registration_forms.filter((row) => row.is_active);
  assert.ok(activeForms.some((row) => row.sheet_name === 'hackathon261'));
  // With no rows yet, an import of it would add nothing and find nothing.
  assert.equal(db.tables.event_registrations.filter((r) => r.event_key === form.event_key).length, 0);
});

/* --------------------------------------- the import loop stays generic */

await test('nothing hard-codes an event key', async () => {
  const { readFileSync } = await import('node:fs');
  const generic = [
    'supabase/functions/event-registration-intake/index.ts',
    'supabase/functions/club-records-sheet-sync/index.ts',
    'supabase/functions/event-registration-provision/index.ts',
    'platform/pages/admin-records-backup.ts',
    'platform/lib/registration-setup.ts',
  ];
  for (const file of generic) {
    const source = readFileSync(file, 'utf8');
    for (const key of ['jam26', 'ctf30', 'hackathon261']) {
      // A mention in a comment is fine; a string literal is a hard-coded event.
      const code = source.split('\n')
        .filter((line) => !/^\s*(\*|\/\/|--)/.test(line)).join('\n');
      assert.ok(!code.includes(`'${key}'`) && !code.includes(`"${key}"`),
        `${file} must not name ${key} in code`);
    }
  }
});

rmSync(outDir, { recursive: true, force: true });
console.log(`${count} registration provisioning tests passed`);
