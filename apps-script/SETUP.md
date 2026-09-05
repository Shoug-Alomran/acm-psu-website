# ACM PSU workbook and public event registration

Supabase is canonical for platform records. `club-records-sheet-sync` refreshes
only its closed canonical allowlist. `jam26` and `ctf30` are separate append-only
public event records, never snapshot targets.

## Canonical Apps Script source

Install **both** `Code.gs` (workbook preparation and exact schemas) and
`EventRegistration.gs` (the only `doPost` and `doGet`) in the workbook's bound
Apps Script project. Remove older registration handler drafts from that project;
there must be one definition of each entrypoint. `PositionsSeed.gs` is retained reference
data, not part of the event integration. Do not paste the retired Jam
repository's `apps-script.gs` as a backend.

Web app writes use `SpreadsheetApp.openById` with workbook ID
`1WtNGmVYO8hk_w3I37n1T6wS9_z_dTyTPW4fTHZ4lW3s`. Setup uses the bound workbook.

## Google deployment steps

1. Open **ACM PSU — Club Records → Extensions → Apps Script**.
2. Replace `Code.gs` and `EventRegistration.gs` with these two repository files.
   Remove conflicting old `doGet`/`doPost` definitions; save.
3. Run `setupClubRecordsWorkbook()` and authorize it as the workbook owner.
4. Confirm:
   - `Event jam26 — header row matches, left untouched.`
   - `Event ctf30 — header row matches, left untouched.`
   Newly empty tabs are seeded. If either reports **HEADER MISMATCH**, stop:
   review the existing schema and preserve all registrations before correcting
   headers. Neither setup nor registration overwrites mismatching event data.
5. **Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone
   → Deploy**. Saving editor code alone does not update an existing deployment.
6. Copy the resulting `/exec` URL. If it differs, update only:
   - `Shoug-Alomran/acm-programming-jam-2026/config.js`: `window.JAM_ENDPOINT`
   - `Shoug-Alomran/ACM-CTF-3.0./config.js`: `window.ACM_EVENT_REGISTRATION_ENDPOINT`
7. Open the URL signed out. Expect `status: "ok"`, the live endpoint message,
   and `version: "2026-09-05.1"`. `retired` means the wrong version is deployed.
8. Merge/deploy the event repository changes via their GitHub Pages workflows.
   Both frontends now require the new server's echoed request ID.
9. Submit the test cases in `REGISTRATION-CONTRACT.md` through each public form.
   Confirm `OK` **and exactly one corresponding workbook row** for each event.
   Then verify duplicate rejection and partial-member rejection with no new rows.

Keep the URL shared by both sites. Do not archive the active event deployment
because an older migration document said all Apps Script callers were retired.
Older membership/position-signup endpoints can be retired after confirming they
are not the event endpoint.

## Security and operational limits

The handler allows only `jam26` and `ctf30`; validates fields and exact headers;
checks duplicates under a script lock; escapes formula-like cells; and appends
before acknowledging `OK`. It never returns workbook rows or accepts a sheet
name, credential, or shared frontend secret. The response permits iframe framing
and relays to both parent and top for Google's nested sandbox.

CacheService throttling is best effort: Apps Script supplies no trustworthy
client IP and cache entries may expire early. There is an event burst limit and
hashed submitter throttle, not a claim of comprehensive bot prevention.
An acknowledgement can be lost after a successful append: timeout deliberately
says the result is unconfirmed. Check the workbook before retrying.

## Local checks

`npm run test:registration` runs the mocked Apps Script safety tests.
`node scripts/check-event-contract.mjs /path/to/jam /path/to/ctf` verifies the
cross-repository contract and parses all event-site scripts. These checks do not
prove deployment permissions, iframe execution, or a live workbook write.
