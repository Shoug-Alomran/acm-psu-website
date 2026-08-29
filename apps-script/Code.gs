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

        if (data.action === 'positionSignup') {
            return json(registerForPosition(data));
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

function doGet(e) {
    if (e && e.parameter && e.parameter.action === 'positions') {
        try {
            return json({ status: 'ok', positions: listPublishedPositions() });
        } catch (err) {
            return json({ status: 'error', message: String(err && err.message || err) });
        }
    }
    return json({ status: 'ok', message: 'ACM registration and position endpoint is live.' });
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
    var book = getBook();
    if (!book) {
        throw new Error('No spreadsheet: bind the script to the sheet or set SPREADSHEET_ID');
    }
    var sheet = SHEET_NAME ? book.getSheetByName(SHEET_NAME) : book.getSheets()[0];
    if (!sheet) { throw new Error('Sheet not found: ' + SHEET_NAME); }
    return sheet;
}

function getBook() {
    return SPREADSHEET_ID
        ? SpreadsheetApp.openById(SPREADSHEET_ID)
        : SpreadsheetApp.getActive();
}

/* -------------------------------------------------------------------------
 * Project position registry
 * ------------------------------------------------------------------------- */

var POSITIONS_SHEET = 'Positions';
var POSITION_SIGNUPS_SHEET = 'Position Signups';

var POSITION_HEADERS = [
    'Position ID', 'Project', 'Title', 'Summary', 'Responsibilities',
    'Requirements', 'Commitment', 'Capacity', 'Deadline', 'Selection Method',
    'Status', 'Waitlist Enabled'
];

var POSITION_SIGNUP_HEADERS = [
    'Timestamp', 'Position ID', 'Project', 'Position', 'Full Name', 'PSU Email',
    'Student ID', 'Interest Note', 'Status'
];

function listPublishedPositions() {
    var book = getBook();
    if (!book) { throw new Error('No spreadsheet configured'); }
    var positionsSheet = book.getSheetByName(POSITIONS_SHEET);
    var signupsSheet = book.getSheetByName(POSITION_SIGNUPS_SHEET);
    if (!positionsSheet || !signupsSheet) {
        throw new Error('Position sheets are missing. Run setupPositionSheets once.');
    }

    var positions = rowsAsObjects(positionsSheet);
    var signups = rowsAsObjects(signupsSheet);
    var counts = {};
    signups.forEach(function (signup) {
        if (String(signup['Status'] || '').toLowerCase() === 'assigned') {
            var id = String(signup['Position ID'] || '').trim();
            counts[id] = (counts[id] || 0) + 1;
        }
    });

    return positions.filter(function (position) {
        return ['open', 'closed'].indexOf(String(position['Status'] || '').toLowerCase()) !== -1;
    }).map(function (position) {
        var id = String(position['Position ID'] || '').trim();
        var capacity = Math.max(0, Number(position['Capacity']) || 0);
        var filled = counts[id] || 0;
        var manuallyClosed = String(position['Status'] || '').toLowerCase() === 'closed';
        return {
            id: id,
            project: String(position['Project'] || ''),
            title: String(position['Title'] || ''),
            summary: String(position['Summary'] || ''),
            responsibilities: String(position['Responsibilities'] || ''),
            requirements: String(position['Requirements'] || ''),
            commitment: String(position['Commitment'] || ''),
            capacity: capacity,
            filled: filled,
            remaining: Math.max(0, capacity - filled),
            deadline: displaySheetValue(position['Deadline']),
            selection: String(position['Selection Method'] || 'First come, first served'),
            status: manuallyClosed || filled >= capacity ? 'closed' : 'open',
            waitlist: isTruthy(position['Waitlist Enabled'])
        };
    });
}

function registerForPosition(data) {
    ['positionId', 'name', 'email', 'studentId', 'note'].forEach(function (field) {
        if (!String(data[field] || '').trim()) { throw new Error('Missing required field: ' + field); }
    });
    if (String(data.commitment || '') !== 'yes') { throw new Error('You must accept the commitment'); }

    var email = String(data.email).trim().toLowerCase();
    if (!/@psu\.edu\.sa$/i.test(email)) { throw new Error('Use your PSU email address'); }

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
        var book = getBook();
        var positionsSheet = book.getSheetByName(POSITIONS_SHEET);
        var signupsSheet = book.getSheetByName(POSITION_SIGNUPS_SHEET);
        if (!positionsSheet || !signupsSheet) { throw new Error('Position registry is not configured'); }

        var positionId = String(data.positionId).trim();
        var position = rowsAsObjects(positionsSheet).filter(function (row) {
            return String(row['Position ID'] || '').trim() === positionId;
        })[0];
        if (!position || String(position['Status'] || '').toLowerCase() !== 'open') {
            throw new Error('This position is not open');
        }

        var signups = rowsAsObjects(signupsSheet);
        var studentId = String(data.studentId).trim();
        var prior = signups.filter(function (signup) {
            var samePerson = String(signup['PSU Email'] || '').toLowerCase() === email || String(signup['Student ID'] || '').trim() === studentId;
            var active = ['assigned', 'waitlisted'].indexOf(String(signup['Status'] || '').toLowerCase()) !== -1;
            return samePerson && active;
        });
        if (prior.some(function (signup) { return String(signup['Position ID']) === positionId; })) {
            throw new Error('You already requested this position');
        }
        if (prior.some(function (signup) { return String(signup['Status']).toLowerCase() === 'assigned'; })) {
            throw new Error('You already hold an active assignment');
        }

        var assignedCount = signups.filter(function (signup) {
            return String(signup['Position ID']) === positionId && String(signup['Status']).toLowerCase() === 'assigned';
        }).length;
        var capacity = Math.max(0, Number(position['Capacity']) || 0);
        var signupStatus = assignedCount < capacity ? 'Assigned' : 'Waitlisted';
        if (signupStatus === 'Waitlisted' && !isTruthy(position['Waitlist Enabled'])) {
            throw new Error('This position is full and registration is closed');
        }

        signupsSheet.appendRow([
            new Date(), positionId, position['Project'], position['Title'],
            String(data.name).trim(), email, studentId, String(data.note).trim(), signupStatus
        ]);
        return { status: 'ok', assignmentStatus: signupStatus.toLowerCase() };
    } finally {
        lock.releaseLock();
    }
}

function rowsAsObjects(sheet) {
    var values = sheet.getDataRange().getValues();
    if (!values.length) { return []; }
    var headers = values[0].map(function (header) { return String(header).trim(); });
    return values.slice(1).filter(function (row) {
        return row.some(function (cell) { return String(cell).trim() !== ''; });
    }).map(function (row) {
        var record = {};
        headers.forEach(function (header, index) { record[header] = row[index]; });
        return record;
    });
}

function displaySheetValue(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
        return Utilities.formatDate(value, Session.getScriptTimeZone(), 'd MMM yyyy');
    }
    return String(value || 'Open until filled');
}

function isTruthy(value) {
    return ['true', 'yes', '1'].indexOf(String(value || '').toLowerCase()) !== -1;
}

/* Run once from the Apps Script editor. It creates both tabs and example
 * assignments. Edit or delete the examples directly in the Positions tab. */
function setupPositionSheets() {
    var book = getBook();
    if (!book) { throw new Error('No spreadsheet configured'); }
    var positions = book.getSheetByName(POSITIONS_SHEET) || book.insertSheet(POSITIONS_SHEET);
    var signups = book.getSheetByName(POSITION_SIGNUPS_SHEET) || book.insertSheet(POSITION_SIGNUPS_SHEET);

    if (positions.getLastRow() === 0) {
        positions.appendRow(POSITION_HEADERS);
        var defaults = defaultPositionRows();
        positions.getRange(2, 1, defaults.length, POSITION_HEADERS.length).setValues(defaults);
    }
    if (signups.getLastRow() === 0) { signups.appendRow(POSITION_SIGNUP_HEADERS); }
    [positions, signups].forEach(function (sheet) {
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold').setBackground('#1d4ed8').setFontColor('#ffffff');
        sheet.autoResizeColumns(1, sheet.getLastColumn());
    });
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
