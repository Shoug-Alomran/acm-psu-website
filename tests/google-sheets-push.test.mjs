/**
 * Regression tests for the Supabase -> Google Sheets writer.
 *
 * The failure these exist for: a canonical worksheet is converted into a
 * Google Sheets Table, its columns become typed, and the Sheets API starts
 * refusing the formatting requests that pushToGoogleSheet sends after the
 * data. Before this, that refusal propagated and a completed, correct export
 * was reported as a failed one.
 *
 * The module is Deno source, so it is bundled with esbuild and given a `Deno`
 * shim and a fake Sheets API. The OAuth path is exercised for real against a
 * generated RSA key rather than stubbed, so a change to the JWT signing is
 * caught here too.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const SPREADSHEET = 'test-spreadsheet-id';
const TYPED_COLUMN_ERROR = "You can't set the number format of cells in a typed column.";
/** What the API says when a basic filter is asked to overlap a Table. */
const FILTER_TABLE_ERROR = 'You cannot create a filter that intersects a table.';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const outDir = mkdtempSync(join(tmpdir(), 'acm-sheets-'));
const bundle = join(outDir, 'google_sheets.mjs');
await build({
  entryPoints: ['supabase/functions/_shared/google_sheets.ts'],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
});

globalThis.Deno = {
  env: {
    get: (key) => ({
      GOOGLE_SHEETS_SPREADSHEET_ID: SPREADSHEET,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'acm-sheets-writer@example.iam.gserviceaccount.com',
      GOOGLE_PRIVATE_KEY: privateKey,
    })[key],
  },
};

const { pushToGoogleSheet, readGoogleSheet } = await import(pathToFileURL(bundle).href);

/**
 * A fake Sheets API.
 *
 * `rejects` decides which batchUpdate request kinds this workbook refuses, so
 * a test can make a worksheet behave like a Table without pretending to
 * implement one.
 */
function sheetsApi({ rejects = [], tabs = ['Members'], failValues = false } = {}) {
  const calls = { batches: [], values: [], clears: [], created: [] };
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));

  globalThis.fetch = async (url, init = {}) => {
    const address = String(url);
    const ok = (payload) => new Response(JSON.stringify(payload), { status: 200 });
    const bad = (message) => new Response(JSON.stringify({ error: { message } }), { status: 400 });

    // The token exchange is form-encoded, so parse a JSON body only after it.
    if (address === 'https://oauth2.googleapis.com/token') {
      return ok({ access_token: 'test-token' });
    }

    const body = init.body ? JSON.parse(init.body) : null;

    assert.ok(address.startsWith(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}`),
      `unexpected request to ${address}`);
    const path = address.slice(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}`.length);

    if (path === '') {
      return ok({ sheets: tabs.map((title, index) => ({ properties: { title, sheetId: index + 1 } })) });
    }

    if (path === ':batchUpdate') {
      calls.batches.push(body.requests);
      if (body.requests.some((request) => request.addSheet)) {
        calls.created.push(body.requests[0].addSheet.properties.title);
        return ok({ replies: [{ addSheet: { properties: { title: body.requests[0].addSheet.properties.title, sheetId: 99 } } }] });
      }
      // A Table refuses whole batches: one bad request loses all of them.
      const refused = body.requests.find((request) =>
        rejects.some((kind) => Object.prototype.hasOwnProperty.call(request, kind)));
      if (refused) {
        return bad(Object.prototype.hasOwnProperty.call(refused, 'setBasicFilter') ||
          Object.prototype.hasOwnProperty.call(refused, 'clearBasicFilter')
          ? FILTER_TABLE_ERROR : TYPED_COLUMN_ERROR);
      }
      return ok({ replies: [] });
    }

    if (path.endsWith(':clear')) { calls.clears.push(path); return ok({}); }

    if (init.method === 'PUT') {
      if (failValues) return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 });
      calls.values.push({ path, values: body.values });
      return ok({});
    }

    if (path.startsWith('/values/')) {
      return ok({ values: [['Timestamp', 'Team Name'], ['2026-09-05 10:00', 'ZZ_TEST']] });
    }

    throw new Error(`unhandled request ${address}`);
  };

  return { calls, warnings, restore: () => { console.warn = realWarn; } };
}

/** Every batchUpdate request kind the writer sent, flattened. */
const kindsSent = (calls) => calls.batches.flat().flatMap((request) => Object.keys(request));

const MEMBERS = [['Name', 'PSU Email'], ['Sara', 'sara@psu.edu.sa'], ['Noura', 'noura@psu.edu.sa']];

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log('PASS ' + name);
}

/* ------------------------------------------------------------------ tests */

{
  // A worksheet that is a Table: every formatting request is refused.
  const api = sheetsApi({ rejects: ['repeatCell', 'autoResizeDimensions', 'updateSheetProperties'] });
  await test('a typed/Table worksheet still receives its data', async () => {
    const url = await pushToGoogleSheet('Members', MEMBERS);
    assert.match(url, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/test-spreadsheet-id\/edit#gid=1$/);
    assert.equal(api.calls.clears.length, 1, 'the worksheet is cleared before writing');
    assert.equal(api.calls.values.length, 1, 'the snapshot is written');
    assert.deepEqual(api.calls.values[0].values, MEMBERS, 'every row is written verbatim');
    assert.ok(api.warnings.some((w) => w.includes(TYPED_COLUMN_ERROR)),
      'the refusal is reported as a warning');
  });
  api.restore();
}

{
  const api = sheetsApi({ rejects: ['repeatCell'] });
  await test('one refused formatting step never costs the others', async () => {
    await pushToGoogleSheet('Members', MEMBERS);
    // Batch attempt, then one retry per request: the two that are accepted
    // still land even though the workbook rejected the batch they were in.
    const retried = api.calls.batches.slice(1);
    assert.ok(retried.every((batch) => batch.length === 1), 'the retry is request by request');
    const applied = retried.filter((batch) => !('repeatCell' in batch[0])).flatMap(Object.keys);
    assert.ok(retried.some((b) => 'updateSheetProperties' in b[0]), 'the frozen header row was still applied');
    assert.ok(retried.some((b) => 'autoResizeDimensions' in b[0]), 'column widths were still applied');
    assert.ok(applied.length > 0);
  });
  api.restore();
}

{
  const api = sheetsApi();
  await test('no filter is ever created, cleared or modified', async () => {
    await pushToGoogleSheet('Membership Applications',
      [['Name', 'Status'], ['Sara', 'submitted'], ['Noura', 'approved']], ['new', null]);
    const kinds = kindsSent(api.calls);
    assert.ok(!kinds.includes('setBasicFilter'), 'setBasicFilter is never sent');
    assert.ok(!kinds.includes('clearBasicFilter'), 'clearBasicFilter is never sent');
    for (const body of api.calls.batches) {
      assert.doesNotMatch(JSON.stringify(body), /Filter/i, 'no filter request reaches the API');
    }
  });
  api.restore();
}

{
  const api = sheetsApi({ rejects: ['setBasicFilter', 'clearBasicFilter'] });
  await test('a workbook that refuses filters syncs without a single warning', async () => {
    await pushToGoogleSheet('Members', MEMBERS);
    assert.deepEqual(api.warnings, [], 'nothing was retried, because no filter was attempted');
    assert.equal(api.calls.batches.length, 1, 'formatting went out as one accepted batch');
  });
  api.restore();
}

{
  const api = sheetsApi();
  await test('row tinting and header formatting are preserved', async () => {
    await pushToGoogleSheet('Membership Applications',
      [['Name', 'Status'], ['Sara', 'submitted'], ['Noura', 'submitted'], ['Lina', 'approved']],
      ['new', 'new', null]);
    const requests = api.calls.batches.flat();
    assert.ok(requests.some((r) => r.updateSheetProperties?.properties?.gridProperties?.frozenRowCount === 1));
    assert.ok(requests.some((r) => r.autoResizeDimensions));
    const tints = requests.filter((r) => r.repeatCell?.cell?.userEnteredFormat?.backgroundColor);
    // Header, the reset of previous highlighting, and one run covering the two
    // adjacent 'new' rows.
    const run = tints.find((r) => r.repeatCell.range.startRowIndex === 1 && r.repeatCell.range.endRowIndex === 3);
    assert.ok(run, 'contiguous tinted rows are still merged into one request');
    assert.deepEqual(run.repeatCell.cell.userEnteredFormat.backgroundColor,
      { red: 0.85, green: 0.92, blue: 1 });
  });
  api.restore();
}

{
  const api = sheetsApi({ failValues: true });
  await test('a failed DATA write still fails the sync', async () => {
    await assert.rejects(() => pushToGoogleSheet('Members', MEMBERS), /Quota exceeded/);
  });
  api.restore();
}

{
  const api = sheetsApi({ tabs: ['Members', 'jam26', 'ctf30'] });
  await test('the registration tabs can never be written or cleared', async () => {
    for (const tab of ['jam26', 'ctf30']) {
      await assert.rejects(() => pushToGoogleSheet(tab, [['Timestamp'], ['x']]),
        /Refusing to write/, `${tab} must be refused`);
    }
    // Refused before any request is made: nothing is cleared, written or created.
    assert.deepEqual(api.calls.clears, []);
    assert.deepEqual(api.calls.values, []);
    assert.deepEqual(api.calls.batches, []);
    // Reading them stays allowed — that is how the import recovers registrations.
    assert.deepEqual(await readGoogleSheet(SPREADSHEET, 'jam26'),
      [['Timestamp', 'Team Name'], ['2026-09-05 10:00', 'ZZ_TEST']]);
  });
  api.restore();
}

{
  const api = sheetsApi({ tabs: [] });
  await test('a worksheet missing from the workbook is created, not cleared', async () => {
    await pushToGoogleSheet('Inquiries', [['Reference'], ['ACM-1']]);
    assert.deepEqual(api.calls.created, ['Inquiries']);
    assert.deepEqual(api.calls.clears, [], 'a brand-new worksheet has nothing to clear');
    assert.equal(api.calls.values.length, 1);
  });
  api.restore();
}

{
  await test('the writer source names no filter API at all', async () => {
    const source = readFileSync('supabase/functions/_shared/google_sheets.ts', 'utf8');
    for (const banned of ['setBasicFilter', 'clearBasicFilter', 'createFilter']) {
      // The word appears once in prose, explaining why it is not called. A
      // call site would read `{ setBasicFilter: …` or `.setBasicFilter(`.
      assert.doesNotMatch(source, new RegExp(`[{.]\\s*${banned}\\s*[:(]`),
        `${banned} must not be called`);
    }
  });
}

/* ------------------------------------------------- the sync's own targets */

{
  const sync = readFileSync('supabase/functions/club-records-sheet-sync/index.ts', 'utf8');
  const writer = readFileSync('supabase/functions/_shared/google_sheets.ts', 'utf8');
  const between = (source, start, end) => {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, `expected to find ${start}`);
    return source.slice(from, source.indexOf(end, from));
  };
  const quoted = (text) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  await test('the records sync can never target a registration tab', async () => {
    const names = quoted(between(sync, 'const NAMES: Record<SheetKey, string> = {', '};'));
    const order = between(sync, 'const ORDER: SheetKey[] = [', '];');
    for (const tab of ['jam26', 'ctf30']) {
      assert.ok(!names.includes(tab), `${tab} must not be a sync target`);
      assert.ok(!order.includes(tab), `${tab} must not be in the sync order`);
      assert.ok(!quoted(between(sync, 'const FOLDERS', '};')).includes(tab));
    }

    // Every push goes through the NAMES map, so no literal tab name can be
    // written even by a future edit that forgets the allowlist.
    const pushes = [...sync.matchAll(/pushToGoogleSheet\(\s*([^,]+),/g)].map((m) => m[1].trim());
    assert.ok(pushes.length > 0, 'the sync still pushes worksheets');
    for (const target of pushes) {
      assert.match(target, /^NAMES(\[|\.)/, `push target ${target} must come from NAMES`);
    }

    // The registration collector reads and never writes.
    const collector = between(sync, 'async function registrationSheets(', '\n}\n');
    assert.doesNotMatch(collector, /pushToGoogleSheet/);
  });

  await test('the writer allowlist matches the sync worksheet list exactly', async () => {
    const names = quoted(between(sync, 'const NAMES: Record<SheetKey, string> = {', '};'));
    const allowed = quoted(between(writer, 'const CANONICAL_TABS = new Set([', ']);'));
    assert.deepEqual(allowed.slice().sort(), names.slice().sort(),
      'a worksheet added to the sync must also be allowed by the writer');
  });
}

rmSync(outDir, { recursive: true, force: true });
console.log(`${count} Google Sheets writer tests passed`);
