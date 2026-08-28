/* ACM Member Registration — receives applications from join.html and appends
 * them to the registration sheet.
 *
 * Setup
 *   1. Extensions > Apps Script from the registration spreadsheet, so the
 *      script is container-bound and SpreadsheetApp.getActive() resolves.
 *      (If you created it standalone instead, set SPREADSHEET_ID below.)
 *   2. Paste this file over Code.gs and save.
 *   3. Deploy > New deployment > type "Web app",
 *        Execute as:   Me
 *        Who has access: Anyone
 *      Authorize when prompted, then copy the /exec URL.
 *   4. Put that URL in FORM_ENDPOINT in assets/js/join.js.
 *
 * Re-deploy ("Manage deployments" > edit > New version) after any edit here,
 * otherwise the live URL keeps serving the old code.
 *
 * Stuck, or new to Apps Script? SETUP.md next to this file walks through the
 * same steps click by click and lists what each failure mode looks like.
 *
 * Columns are matched by header text, so reordering columns or adding new ones
 * (e.g. an "Email" column) needs no change here — only FIELD_HEADERS if the
 * new column's header does not already appear below.
 */

var SPREADSHEET_ID = '';        // leave empty when the script is bound to the sheet
var SHEET_NAME = '';            // leave empty to use the first sheet

/* Form field name -> the sheet headers it may be stored under. First header
 * present in the sheet wins; fields with no matching header are ignored. */
var FIELD_HEADERS = {
    name:       ['Full Name', 'Name'],
    email:      ['Email', 'PSU Email', 'Email Address'],
    studentId:  ['Student ID', 'ID'],
    major:      ['Major'],
    interests:  ['What are you interested in', 'What are you interested in?', 'Interests'],
    year:       ['Academic Year', 'Year'],
    experience: ['What would you like to gain experience in?',
                 'What would you like to gain experience in', 'Experience'],
    portfolio:  ['LinkedIn / GitHub / Portfolio', 'Portfolio', 'LinkedIn / GitHub']
};

var REQUIRED_FIELDS = ['name', 'studentId', 'major', 'interests', 'year'];

/* Headers that are filled in by the script rather than the applicant. */
var TIMESTAMP_HEADERS = ['Timestamp', 'Submitted At', 'Date'];

function doPost(e) {
    try {
        var data = parseBody(e);

        /* Honeypot: only a bot fills a field that is hidden off-screen. Answer
         * with a normal success so it has nothing to tune against. */
        if (data.website) {
            return json({ status: 'ok' });
        }

        REQUIRED_FIELDS.forEach(function (field) {
            if (!String(data[field] || '').trim()) {
                throw new Error('Missing required field: ' + field);
            }
        });

        appendRow(data);
        return json({ status: 'ok' });
    } catch (err) {
        return json({ status: 'error', message: String(err && err.message || err) });
    }
}

function doGet() {
    return json({ status: 'ok', message: 'ACM registration endpoint is live.' });
}

function parseBody(e) {
    if (e && e.postData && e.postData.contents) {
        return JSON.parse(e.postData.contents);
    }
    if (e && e.parameter) {
        return e.parameter;          // form-encoded fallback
    }
    throw new Error('Empty request body');
}

/* Appending is serialized behind a script lock so two submissions landing at
 * the same moment cannot compute the same target row. */
function appendRow(data) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
        var sheet = getSheet();
        var lastColumn = sheet.getLastColumn();
        if (lastColumn < 1) { throw new Error('Sheet has no header row'); }

        var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (h) {
            return String(h).trim();
        });

        var row = new Array(lastColumn).fill('');

        Object.keys(FIELD_HEADERS).forEach(function (field) {
            var index = indexOfHeader(headers, FIELD_HEADERS[field]);
            if (index !== -1) {
                row[index] = String(data[field] || '').trim();
            }
        });

        var stampIndex = indexOfHeader(headers, TIMESTAMP_HEADERS);
        if (stampIndex !== -1) {
            row[stampIndex] = new Date();
        }

        sheet.appendRow(row);
    } finally {
        lock.releaseLock();
    }
}

function getSheet() {
    var book = SPREADSHEET_ID
        ? SpreadsheetApp.openById(SPREADSHEET_ID)
        : SpreadsheetApp.getActive();
    if (!book) {
        throw new Error('No spreadsheet: bind the script to the sheet or set SPREADSHEET_ID');
    }
    var sheet = SHEET_NAME ? book.getSheetByName(SHEET_NAME) : book.getSheets()[0];
    if (!sheet) { throw new Error('Sheet not found: ' + SHEET_NAME); }
    return sheet;
}

function indexOfHeader(headers, candidates) {
    for (var i = 0; i < candidates.length; i++) {
        var wanted = candidates[i].toLowerCase();
        for (var j = 0; j < headers.length; j++) {
            if (headers[j].toLowerCase() === wanted) { return j; }
        }
    }
    return -1;
}

function json(payload) {
    return ContentService
        .createTextOutput(JSON.stringify(payload))
        .setMimeType(ContentService.MimeType.JSON);
}

/* Run this from the editor to check the wiring without going through the site.
 * It writes a real row — delete it afterwards. */
function testAppend() {
    appendRow({
        name: 'Test Applicant',
        email: 'test@psu.edu.sa',
        studentId: '000000000',
        major: 'Computer Science',
        interests: 'Cybersecurity',
        year: 'Junior (Y3)',
        experience: 'Testing the registration pipeline.',
        portfolio: 'https://github.com/test'
    });
}
