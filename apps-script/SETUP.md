# Connecting the membership form to the registration sheet

**You only need this if something is not working, or if you have never deployed
an Apps Script web app before.** The short version lives at the top of
`Code.gs`; this is the same thing with every click spelled out.

The form on `join.html` cannot post anywhere on its own — GitHub Pages serves
static files and has no server. So the form posts to a small Google Apps Script
web app, which appends one row per application to the registration spreadsheet.

```
join.html form  ──POST──▶  Apps Script web app  ──appendRow──▶  registration sheet
(assets/js/join.js)         (apps-script/Code.gs)
```

---

## 1. Prepare the spreadsheet

Open the registration spreadsheet in Google Sheets. Row 1 must be the header
row, and the script matches columns **by header text**, not by position — so
you can reorder or add columns freely.

These headers are recognised (the first one present wins):

| Form field   | Accepted headers                                                          |
|--------------|---------------------------------------------------------------------------|
| `name`       | `Full Name`, `Name`                                                       |
| `email`      | `Email`, `PSU Email`, `Email Address`                                     |
| `studentId`  | `Student ID`, `ID`                                                        |
| `major`      | `Major`                                                                   |
| `year`       | `Academic Year`, `Year`                                                   |
| `interests`  | `What are you interested in`, `What are you interested in?`, `Interests`  |
| `experience` | `What would you like to gain experience in?`, `Experience`                |
| `portfolio`  | `LinkedIn / GitHub / Portfolio`, `Portfolio`, `LinkedIn / GitHub`         |
| *(filled in by the script)* | `Timestamp`, `Submitted At`, `Date`                        |

A column whose header is not in this list is simply left blank — nothing breaks.
If you want a new column filled in, add its header to `FIELD_HEADERS` in
`Code.gs`. Headers are matched case-insensitively and trimmed, but otherwise
must match exactly, so `Student ID` works and `Student Id #` does not.

## 2. Create the script

From **that same spreadsheet**, choose **Extensions → Apps Script**. Starting
from the sheet matters: it makes the script *container-bound*, which is what
lets `SpreadsheetApp.getActive()` find the sheet without any ID.

In the editor, select everything in `Code.gs` and paste `apps-script/Code.gs`
over it. Save (⌘S / Ctrl+S).

> **If you made a standalone script instead** (script.google.com → New project),
> `getActive()` returns nothing. Open the spreadsheet, copy the long ID out of
> its URL — `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit` — and set
> `var SPREADSHEET_ID = 'THIS_PART';` near the top of the script.
>
> Applications land in the **first** sheet tab by default. To target a specific
> tab, set `SHEET_NAME` to its exact name.

## 3. Deploy it as a web app

1. **Deploy → New deployment.**
2. Click the gear next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** `Me` — the script writes to the sheet with *your* access,
     so applicants never need permission to the spreadsheet.
   - **Who has access:** `Anyone` — this means anyone can POST to the URL, which
     is required, since applicants are not signed in. It does **not** give
     anyone access to the spreadsheet.
4. **Deploy.** Google asks you to authorize the script the first time.
5. Google will warn "Google hasn't verified this app". That is expected for a
   private script you just wrote: **Advanced → Go to (project name) (unsafe)**,
   then **Allow**.
6. Copy the **Web app URL**. It ends in `/exec`.

## 4. Point the site at it

In [`assets/js/join.js`](../assets/js/join.js), paste the URL:

```js
var FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycb.../exec';
```

Commit and push. While `FORM_ENDPOINT` is empty the form still renders, but
tells applicants to email instead of silently dropping their answers.

## 5. Check it

Two quick tests, cheapest first:

- **The script alone:** in the Apps Script editor, pick `testAppend` from the
  function dropdown and press **Run**. A "Test Applicant" row should appear in
  the sheet. *Delete that row afterwards.*
- **The URL alone:** open the `/exec` URL in a browser. A `GET` returns
  `{"status":"ok","message":"ACM registration endpoint is live."}`. Anything
  else — a sign-in page, an error page — means the deployment settings in
  step 3 are wrong.
- **The whole path:** submit the real form on `join.html`. You should see
  `HANDSHAKE COMPLETE` and a new row.

## 6. Enable open project positions

The same web app also powers `positions.html`; no second deployment is needed.

1. In the Apps Script editor, select `setupPositionSheets` from the function
   dropdown and press **Run** once.
2. Two tabs appear: `Positions` and `Position Signups`. Four example assignments
   are included. Edit, replace, or delete them directly in the sheet.
3. Paste the same `/exec` URL into `FORM_ENDPOINT` near the top of
   `assets/js/positions.js`.
4. Redeploy the script as a **New version** because the positions feature adds
   new server functions. Keep the same deployment so its URL does not change.

The `Positions` columns work as follows:

| Column | Meaning |
|--------|---------|
| `Position ID` | A unique stable code, such as `CTF3-MEDIA` |
| `Project`, `Title`, `Summary` | Public assignment identity and overview |
| `Responsibilities`, `Requirements` | Separate items with `|` or line breaks |
| `Commitment` | Expected hours, meetings, and event attendance |
| `Capacity` | Maximum number of automatically assigned members |
| `Deadline` | Publicly displayed deadline |
| `Selection Method` | The fairness rule shown to applicants |
| `Status` | `Open`, `Closed`, or `Draft`; drafts are not published |
| `Waitlist Enabled` | `TRUE` continues waitlist signups when full; `FALSE` closes registration |

Do not rename the header cells. You may reorder columns, but the current server
setup writes new signup rows in the provided `Position Signups` column order.
To reopen a place after someone withdraws, change their signup `Status` from
`Assigned` to `Withdrawn` or `Rejected`; the live remaining count updates on the
next page refresh.

---

## After you edit `Code.gs`

**Editing and saving is not enough — the live URL keeps serving the old code.**
Go to **Deploy → Manage deployments**, click the pencil on the existing
deployment, set **Version** to **New version**, and **Deploy**. Doing it this
way keeps the same `/exec` URL, so nothing on the site needs changing. Creating
a *new deployment* instead gives you a different URL and you would have to
update `FORM_ENDPOINT` too.

## When it does not work

**The form says the submission failed, but nothing looks wrong.**
Open the browser console on `join.html` and submit again. A CORS error means the
deployment is not public — recheck **Who has access: Anyone** in step 3. Note
that `join.js` deliberately sends the body as `text/plain`: Apps Script does not
answer CORS preflight requests, so an `application/json` content type would be
blocked by the browser before it ever reached the script. `doPost` parses the
JSON regardless. Don't "fix" that content type.

**Rows arrive with blank columns.**
The header text in row 1 does not match anything in the table above — check for
trailing spaces, a different question mark, or a renamed column. Fix the header
or add the variant to `FIELD_HEADERS`.

**"Sheet has no header row" / "No spreadsheet".**
The script is standalone rather than bound to the sheet, or row 1 is empty. See
the note in step 2.

**"Missing required field: …"**
`name`, `studentId`, `major`, `interests`, and `year` are required server-side
as well as in the browser. If you make a field optional in `join.html`, remove
it from `REQUIRED_FIELDS` in `Code.gs` too.

**Submissions stop after a burst.**
Apps Script has daily quotas on script runtime and triggers. For a club intake
this is far out of reach, but a script that is being hammered will start
failing. Check **Executions** in the Apps Script editor for the real error.

**Bot rows.**
The form carries a hidden `website` field that real applicants never see. If it
is filled in, the script returns a normal success and writes nothing — so bots
get no signal to tune against, and you get no junk rows.
