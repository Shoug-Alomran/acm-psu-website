/**
 * Google Sheets export.
 *
 * ONE workbook, many worksheets. GOOGLE_SHEETS_SPREADSHEET_ID identifies the
 * single private "ACM PSU — Club Records" file; each dataset becomes a tab
 * inside it, created on first use. There is no expectation of a separate
 * spreadsheet per dataset.
 *
 * Supabase stays the operational system. This writes snapshots out and never
 * reads back one of the worksheets it writes, so the workbook cannot become a
 * second, diverging source of truth. (readGoogleSheet below reads the event
 * registration tabs, which this module never writes — see its comment.)
 *
 * WHAT IS ALLOWED TO FAIL. The data write is not: a snapshot that did not
 * land must be reported as a failure. Everything after it — header styling,
 * frozen row, column widths, row tints — is presentation and is best-effort,
 * because a canonical worksheet may have been turned into a Google Sheets
 * Table whose typed columns reject formatting. No filter is created, cleared
 * or modified at all; a basic filter cannot share a range with a Table.
 *
 * Authentication is a service account: a JWT signed with the account's private
 * key is exchanged for an access token. The key lives in an Edge Function
 * secret. Nothing here is reachable from a browser.
 *
 * Required secrets (see docs/SETUP.md step 5):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY               (the PEM; literal \n sequences are fine)
 *   GOOGLE_SHEETS_SPREADSHEET_ID
 */

/** The single workbook every worksheet lives in. */
export const WORKBOOK_NAME = 'ACM PSU — Club Records';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** Turns a PEM private key into a Web Crypto signing key. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, '\n')                       // survive single-line .env storage
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function accessToken(): Promise<string> {
  const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const key = Deno.env.get('GOOGLE_PRIVATE_KEY');

  if (!email || !key) {
    throw new Error(
      'Google Sheets export is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and ' +
      'GOOGLE_PRIVATE_KEY as Edge Function secrets — see docs/SETUP.md step 5. ' +
      'CSV and XLSX export work without this.',
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const claim = encodeJson({ alg: 'RS256', typ: 'JWT' }) + '.' + encodeJson({
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await importPrivateKey(key),
    new TextEncoder().encode(claim),
  );

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${claim}.${base64url(new Uint8Array(signature))}`,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Google rejected the service account: ${payload.error_description ?? payload.error}`,
    );
  }
  return payload.access_token as string;
}

async function sheetsRequest(
  token: string,
  spreadsheetId: string,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Sheets API error ${response.status}`);
  }
  return payload;
}

/**
 * Replaces one worksheet's contents with the given matrix and returns a link
 * to that tab within the workbook. The tab is created on first use, so adding
 * a dataset needs no manual setup in Google.
 *
 * The whole sheet is cleared before writing rather than updated in place: a
 * snapshot that still contained last month's departed members would be worse
 * than no snapshot at all.
 */
/**
 * Row highlights.
 *
 * The workbook is read by people scanning for what needs doing, so a couple of
 * states earn a background colour: an applicant nobody has contacted yet, and
 * one who has been marked for interview. These are deliberately pale — the
 * Status column still says the same thing in words, so the colour is a second
 * signal and never the only one.
 */
export type RowTint = 'new' | 'interview';

const TINTS: Record<RowTint, { red: number; green: number; blue: number }> = {
  new: { red: 0.85, green: 0.92, blue: 1 },
  interview: { red: 1, green: 0.95, blue: 0.83 },
};

/**
 * The only worksheets this module may write.
 *
 * The list is a copy of NAMES in club-records-sheet-sync, stated here so the
 * WRITER enforces it rather than trusting every caller to. The tabs that must
 * never appear in it are the public event registration tabs — jam26 and ctf30
 * — which live in this same workbook, are owned by Apps Script, and hold rows
 * that exist nowhere else. Clearing one would destroy registrations outright,
 * so a mistake upstream should fail here rather than run.
 */
const CANONICAL_TABS = new Set([
  'People', 'Membership Applications', 'Members', 'Club Positions',
  'Opportunity Positions', 'Position Applications', 'Event Participation',
  'Contributions', 'Inquiries', 'University Export Log',
]);

/**
 * Applies presentation, and never fails the sync doing it.
 *
 * A canonical worksheet may have been converted into a Google Sheets Table,
 * whose columns carry a declared type and reject formatting outright:
 *
 *   "You can't set the number format of cells in a typed column."
 *
 * The data is already written by the time this runs. A snapshot that is
 * correct but plain is a working sync; an exception here would mark a
 * successful export as failed and, in a multi-worksheet refresh, stop the
 * worksheets after it. So the batch is attempted once, and if the API refuses
 * it the requests are retried individually — one rejected step then costs only
 * itself, and the header styling, freeze and column widths still land.
 *
 * FILTERS ARE NOT TOUCHED AT ALL. A basic filter cannot share a range with a
 * Table, so clearBasicFilter/setBasicFilter are the two calls most likely to
 * fail here, and sorting is something a person does in the workbook rather
 * than something a sync has to install.
 */
async function applyPresentation(
  token: string, spreadsheetId: string, tabName: string,
  requests: Array<Record<string, unknown>>,
): Promise<void> {
  if (!requests.length) return;

  const send = (batch: Array<Record<string, unknown>>) =>
    sheetsRequest(token, spreadsheetId, ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: batch }),
    });

  try {
    await send(requests);
    return;
  } catch (error) {
    console.warn(`${tabName}: formatting was rejected as one batch ` +
      `(${error instanceof Error ? error.message : String(error)}). ` +
      'Retrying step by step; the exported data is already written and is unaffected.');
  }

  for (const request of requests) {
    try {
      await send([request]);
    } catch (error) {
      console.warn(`${tabName}: skipped one formatting step — ` +
        `${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function pushToGoogleSheet(
  tabName: string,
  matrix: Array<Array<unknown>>,
  /** One entry per data row of `matrix` (so index 0 is matrix[1]). */
  tints: Array<RowTint | null> = [],
): Promise<string> {
  // This function clears the worksheet before writing it. Refuse outright for
  // any tab that is not a Supabase-owned mirror, so no upstream mistake can
  // point a snapshot at jam26, ctf30, or anything else a human maintains.
  if (!CANONICAL_TABS.has(tabName)) {
    throw new Error(
      `Refusing to write "${tabName}": only Supabase mirror worksheets may be replaced. ` +
      'Public event registration tabs are owned by Apps Script and are never snapshot targets.',
    );
  }

  const spreadsheetId = Deno.env.get('GOOGLE_SHEETS_SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID is not set — see docs/SETUP.md step 5.');
  }

  const token = await accessToken();

  const meta = await sheetsRequest(token, spreadsheetId, '') as {
    properties?: { title?: string };
    sheets?: Array<{ properties: { title: string; sheetId: number } }>;
  };
  let existing = meta.sheets?.find((s) => s.properties.title === tabName);

  if (!existing) {
    const created = await sheetsRequest(token, spreadsheetId, ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
    }) as { replies?: Array<{ addSheet?: { properties: { title: string; sheetId: number } } }> };
    const props = created.replies?.[0]?.addSheet?.properties;
    if (props) existing = { properties: props };
  } else {
    await sheetsRequest(token, spreadsheetId, `/values/${encodeURIComponent(tabName)}:clear`, {
      method: 'POST',
    });
  }

  await sheetsRequest(
    token,
    spreadsheetId,
    `/values/${encodeURIComponent(tabName)}!A1?valueInputOption=RAW`,
    {
      method: 'PUT',
      // RAW means Sheets stores every cell verbatim, so a value beginning with
      // "=" stays text rather than becoming a formula.
      body: JSON.stringify({ values: matrix.map((row) => row.map((c) => c ?? '')) }),
    },
  );

  // Canonical mirror tabs remain ordinary, readable worksheet tables. This
  // changes only structure/formatting; Apps Script never supplies the data.
  if (existing && matrix.length && matrix[0].length) {
    const requests: Array<Record<string, unknown>> = [
      { repeatCell: {
        range: { sheetId: existing.properties.sheetId, startRowIndex: 0, endRowIndex: 1,
          startColumnIndex: 0, endColumnIndex: matrix[0].length },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.08, green: 0.13, blue: 0.20 },
          textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      } },
      { updateSheetProperties: { properties: { sheetId: existing.properties.sheetId,
        gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      { autoResizeDimensions: { dimensions: { sheetId: existing.properties.sheetId,
        dimension: 'COLUMNS', startIndex: 0, endIndex: matrix[0].length } } },
    ];

    // Clear any previous highlighting first: the rows are rewritten every
    // sync, so a colour left over from the last snapshot would point at
    // whoever now happens to occupy that row.
    requests.push({ repeatCell: {
      range: { sheetId: existing.properties.sheetId, startRowIndex: 1,
        startColumnIndex: 0, endColumnIndex: matrix[0].length },
      cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
      fields: 'userEnteredFormat.backgroundColor',
    } });

    // Contiguous runs of the same tint go out as one request rather than one
    // per row, which keeps a few hundred applicants to a handful of requests.
    for (let i = 0; i < tints.length;) {
      const tint = tints[i];
      if (!tint) { i += 1; continue; }
      let end = i;
      while (end + 1 < tints.length && tints[end + 1] === tint) end += 1;
      requests.push({ repeatCell: {
        range: { sheetId: existing.properties.sheetId,
          startRowIndex: i + 1, endRowIndex: end + 2,
          startColumnIndex: 0, endColumnIndex: matrix[0].length },
        cell: { userEnteredFormat: { backgroundColor: TINTS[tint] } },
        fields: 'userEnteredFormat.backgroundColor',
      } });
      i = end + 1;
    }

    // No filter is created here, and none is cleared. See applyPresentation:
    // a basic filter and a Table cannot occupy the same range, and a worksheet
    // that sorts a little less conveniently is a far smaller problem than a
    // records export that reports failure.
    await applyPresentation(token, spreadsheetId, tabName, requests);
  }

  const gid = existing?.properties.sheetId;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` +
    (gid !== undefined ? `#gid=${gid}` : '');
}

/**
 * Reads one worksheet's display values, header row first.
 *
 * This is the single read path in this module, and what keeps it from creating
 * a second source of truth is the TAB it is pointed at, not the file. The
 * public event registration tabs — jam26, ctf30 — live in the same "ACM PSU —
 * Club Records" workbook as everything else, but Apps Script owns them and
 * Supabase has never written a cell of them: they are excluded from the
 * snapshot sync by name, on purpose. There, Google holds the original and
 * reading it recovers a record. Reading back one of the tabs this file writes
 * would be re-importing our own export, and nothing here does that.
 *
 * A missing tab is an empty result, not an error — an event whose worksheet
 * has not been created yet simply has no registrations.
 */
export async function readGoogleSheet(
  spreadsheetId: string, tabName: string,
): Promise<string[][]> {
  const token = await accessToken();
  const range = `${encodeURIComponent(tabName)}!A1:ZZ`;
  const payload = await sheetsRequest(
    token, spreadsheetId,
    `/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/Unable to parse range|not found/i.test(message)) return { values: [] };
    throw error;
  }) as { values?: unknown[][] };

  return (payload.values ?? []).map((row) => row.map((cell) => String(cell ?? '')));
}
