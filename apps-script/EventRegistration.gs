/** Canonical public event intake. Load alongside Code.gs; no other doPost/doGet. */
var REGISTRATION_SPREADSHEET_ID = '1WtNGmVYO8hk_w3I37n1T6wS9_z_dTyTPW4fTHZ4lW3s';
var REGISTRATION_VERSION = '2026-09-05.1';
var REGISTRATION_SOURCE = 'acm-event-registration';

var REGISTRATION_EVENTS = {
  jam26: {
    sheet: 'jam26',
    fields: {
      fullName:        'Full Name',
      universityId:    'University ID',
      universityEmail: 'University Email',
      phoneNumber:     'Phone Number',
      major:           'Major',
      teamName:        'Team Name',
      teamMembers:     'Team Members'
    },
    required: ['fullName', 'universityId', 'universityEmail', 'phoneNumber', 'major', 'teamName'],
    emailFields: ['universityEmail'],
    optionalGroup: [],
    enums: {},
    limits: {
      fullName: 120, universityId: 40, universityEmail: 254, phoneNumber: 40,
      major: 120, teamName: 120, teamMembers: 1500
    },
    // Each entry: sheet columns scanned against the submitted values.
    uniqueChecks: [
      { headers: ['University Email'], fields: ['universityEmail'],
        message: 'this participant is already registered' },
      { headers: ['University ID'], fields: ['universityId'],
        message: 'this participant is already registered' }
    ],
    rateFields: ['universityEmail', 'universityId']
  },

  ctf30: {
    sheet: 'ctf30',
    fields: {
      teamName:      'Team Name',
      captainName:   'Captain Name',
      captainId:     'Captain University ID',
      captainEmail:  'Captain University Email',
      captainPhone:  'Captain Phone Number',
      captainMajor:  'Captain Major',
      member2Name:   'Member 2 Name',
      member2Id:     'Member 2 University ID',
      member2Email:  'Member 2 University Email',
      member2Major:  'Member 2 Major',
      member3Name:   'Member 3 Name',
      member3Id:     'Member 3 University ID',
      member3Email:  'Member 3 University Email',
      member3Major:  'Member 3 Major',
      experience:    'Experience Level'
    },
    required: [
      'teamName', 'experience',
      'captainName', 'captainId', 'captainEmail', 'captainPhone', 'captainMajor',
      'member2Name', 'member2Id', 'member2Email', 'member2Major'
    ],
    emailFields: ['captainEmail', 'member2Email'],
    // All four or none, so a half-filled third member never lands.
    optionalGroup: ['member3Name', 'member3Id', 'member3Email', 'member3Major'],
    optionalGroupEmails: ['member3Email'],
    enums: { experience: ['Beginner', 'Intermediate', 'Advanced'] },
    limits: {
      teamName: 120, experience: 40,
      captainName: 120, captainId: 40, captainEmail: 254, captainPhone: 40, captainMajor: 120,
      member2Name: 120, member2Id: 40, member2Email: 254, member2Major: 120,
      member3Name: 120, member3Id: 40, member3Email: 254, member3Major: 120
    },
    uniqueChecks: [
      { headers: ['Captain University Email', 'Member 2 University Email', 'Member 3 University Email'],
        fields: ['captainEmail', 'member2Email', 'member3Email'],
        message: 'one of these participants is already registered' },
      { headers: ['Captain University ID', 'Member 2 University ID', 'Member 3 University ID'],
        fields: ['captainId', 'member2Id', 'member3Id'],
        message: 'one of these participants is already registered' },
      { headers: ['Team Name'], fields: ['teamName'],
        message: 'that team name is already taken' }
    ],
    // Nobody may occupy two slots on the same team.
    distinctWithinRow: [
      { fields: ['captainEmail', 'member2Email', 'member3Email'],
        message: 'each member needs a different university email' },
      { fields: ['captainId', 'member2Id', 'member3Id'],
        message: 'each member needs a different university ID' }
    ],
    rateFields: ['captainEmail', 'teamName']
  }
};

/** Same window both front-ends wait on before giving up, less a safety margin. */
var REGISTRATION_LOCK_MS = 15000;
/** Seconds an identical submitter is asked to wait before retrying. */
var REGISTRATION_RATE_SECONDS = 300;
var DEFAULT_FIELD_LIMIT = 500;


/**
 * Public registration intake. Append-only, allowlisted, and never able to read
 * back or modify existing rows.
 */
function doPost(e) {
  var form = (e && e.parameter) || {};
  var event = String(form.event || '').trim();
  var requestId = String(form.requestId || '');
  var reply = function(message) { return registrationReply(event, message, requestId); };
  if (!Object.prototype.hasOwnProperty.call(REGISTRATION_EVENTS, event)) return reply('Error: unsupported event');
  if (requestId && !/^[a-f0-9]{32}$/.test(requestId)) return registrationReply(event, 'Error: invalid request identifier', '');
  if (e && e.postData && e.postData.length > 20000) return reply('Error: submission is too large');
  if (String(form.website || '').trim()) return reply('Error: registration could not be accepted');
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(REGISTRATION_LOCK_MS);
    // Apps Script does not expose the client IP. This is best-effort abuse
    // protection, not a substitute for a dedicated anti-bot service.
    var cache = CacheService.getScriptCache();
    var bucket = 'event-burst:' + event + ':' + Math.floor(Date.now() / 60000);
    var count = Number(cache.get(bucket) || 0);
    if (count >= 120) return reply('Error: registration is busy. Please try again in a minute');
    cache.put(bucket, String(count + 1), 60);
    return handleEventRegistration(REGISTRATION_EVENTS[event], form);
  } catch (err) {
    console.error('Event registration failed');
    return reply('Error: registration could not be confirmed. Contact the organizers before retrying.');
  } finally {
    try { lock.releaseLock(); } catch (releaseError) {}
  }
}


function handleEventRegistration(config, form) {
  var reply = function (message) { return registrationReply(config.sheet, message, String(form.requestId || '')); };
  var value = function (field) { return String(form[field] === undefined ? '' : form[field]).trim(); };

  // Honeypot submissions never write a row or receive a saved acknowledgement.
  if (value('website')) return reply('Error: registration could not be accepted');

  var i;

  for (i = 0; i < config.required.length; i += 1) {
    if (!value(config.required[i])) return reply('Error: missing ' + config.required[i]);
  }

  // Optional block is all-or-nothing.
  var group = config.optionalGroup || [];
  var filled = group.filter(function (field) { return value(field); });
  var hasGroup = group.length > 0 && filled.length === group.length;
  if (filled.length && !hasGroup) {
    return reply('Error: complete every optional member field or leave them all blank');
  }

  var fieldNames = Object.keys(config.fields);
  for (i = 0; i < fieldNames.length; i += 1) {
    var field = fieldNames[i];
    var limit = config.limits[field] || DEFAULT_FIELD_LIMIT;
    if (value(field).length > limit) return reply('Error: ' + field + ' is too long');
  }

  var enumFields = Object.keys(config.enums || {});
  for (i = 0; i < enumFields.length; i += 1) {
    if (config.enums[enumFields[i]].indexOf(value(enumFields[i])) === -1) {
      return reply('Error: invalid ' + enumFields[i]);
    }
  }

  var emailFields = (config.emailFields || []).slice();
  if (hasGroup) emailFields = emailFields.concat(config.optionalGroupEmails || []);
  for (i = 0; i < emailFields.length; i += 1) {
    if (!isRegistrationEmail(value(emailFields[i]))) {
      return reply('Error: invalid ' + emailFields[i]);
    }
  }

  if (config.sheet === 'jam26' && value('teamMembers')) {
    var teammates = value('teamMembers').split(',').map(function (email) { return email.trim(); });
    if (teammates.length > 10 || teammates.some(function (email) { return !isRegistrationEmail(email) || email.length > 254; })) {
      return reply('Error: enter up to 10 valid team member emails separated by commas');
    }
  }

  var withinRow = config.distinctWithinRow || [];
  for (i = 0; i < withinRow.length; i += 1) {
    var seen = withinRow[i].fields
      .map(function (f) { return value(f).toLowerCase(); })
      .filter(function (v) { return v; });
    if (hasArrayDuplicate(seen)) return reply('Error: ' + withinRow[i].message);
  }

  // Resolve the worksheet from the constant config, never from the payload.
  var sheet = registrationSheet_(config.sheet);
  if (!sheet) return reply('Error: registration storage is not ready. Please contact the organizers.');

  var headers = readHeaderRow_(sheet);

  // Preserve the header-mismatch safety rule: if the tab is not laid out as
  // expected, refuse rather than write a row with silently dropped columns.
  if (!sameHeaders_(EVENT_SHEETS[config.sheet], headers)) {
    console.error('HEADER MISMATCH: ' + config.sheet);
    return reply('Error: registration storage is not ready. Please contact the organizers.');
  }

  var duplicate = findExistingRegistration(sheet, headers, config, value);
  if (duplicate) return reply('Error: ' + duplicate);

  // Rate limit last, so a rejected attempt never locks out an immediate retry.
  var identity = (config.rateFields || [])
    .map(function (f) { return value(f).toLowerCase(); })
    .join('|');
  if (identity && !allowRegistrationRequest(config.sheet, identity, REGISTRATION_RATE_SECONDS)) {
    return reply('Error: please wait before submitting again');
  }

  var row = new Array(headers.length);
  for (i = 0; i < row.length; i += 1) row[i] = '';

  fieldNames.forEach(function (name) {
    var col = headers.indexOf(config.fields[name]);
    if (col !== -1) row[col] = safeRegistrationCell(value(name));
  });

  var tsCol = headers.indexOf('Timestamp');
  if (tsCol !== -1) row[tsCol] = new Date();

  // appendRow only ever adds a new last row. No existing registration is read
  // back to the caller, cleared, or overwritten anywhere in this handler.
  sheet.appendRow(row);
  SpreadsheetApp.flush();

  // The worksheet row is written and the registration is safe. Copying it to
  // the platform is a convenience for the club's records backup, so it happens
  // after the durable write and can never turn a saved registration into an
  // error the participant sees. A copy that fails is recovered by the admin
  // import, which reads this worksheet.
  try {
    mirrorRegistrationToPlatform_(config.sheet, headers, row, form.requestId);
  } catch (mirrorError) {
    console.error('Registration mirror failed for ' + config.sheet);
  }

  return reply('OK');
}


/**
 * Best-effort second copy into the ACM PSU platform.
 *
 * Configured through Script Properties rather than constants, because the
 * token is a credential and this file is public in the website repository:
 *
 *   PLATFORM_INTAKE_URL     the event-registration-intake Edge Function
 *   PLATFORM_INTAKE_TOKEN   the value of its EVENT_REGISTRATION_TOKEN secret
 *
 * With either missing the mirror is skipped silently, so registration keeps
 * working before the platform side is configured and after a token is rotated.
 * Nothing is read back and no response is inspected: this call cannot change
 * what the participant is told.
 */
function mirrorRegistrationToPlatform_(eventKey, headers, row, requestId) {
  var properties = PropertiesService.getScriptProperties();
  var url = String(properties.getProperty('PLATFORM_INTAKE_URL') || '').trim();
  var token = String(properties.getProperty('PLATFORM_INTAKE_TOKEN') || '').trim();
  if (!url || !token) return;

  var fields = {};
  for (var i = 0; i < headers.length; i += 1) {
    var value = row[i];
    fields[String(headers[i])] = value instanceof Date
      ? value.toISOString()
      : String(value === undefined || value === null ? '' : value);
  }

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-registration-token': token },
    // A non-2xx reply must not throw: the registration is already recorded.
    muteHttpExceptions: true,
    payload: JSON.stringify({
      event: String(eventKey),
      requestId: String(requestId || ''),
      fields: fields
    })
  });
}


/** Web-app executions always target the configured workbook explicitly. */
function registrationSheet_(name) {
  if (!Object.prototype.hasOwnProperty.call(REGISTRATION_EVENTS, name)) return null;
  return SpreadsheetApp.openById(REGISTRATION_SPREADSHEET_ID).getSheetByName(name);
}

/**
 * One read of the data range, then every uniqueness rule is answered from it.
 * Returns the message for the first rule that matches, or '' when the
 * submission is new. Nothing read here is ever returned to the caller.
 */
function findExistingRegistration(sheet, headers, config, value) {
  var checks = config.uniqueChecks || [];
  if (!checks.length || sheet.getLastRow() < 2) return '';

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues();

  for (var c = 0; c < checks.length; c += 1) {
    var check = checks[c];
    var wanted = Object.create(null);
    var any = false;
    check.fields.forEach(function (field) {
      var v = value(field).toLowerCase();
      if (v) { wanted[v] = true; any = true; }
    });
    if (!any) continue;

    for (var h = 0; h < check.headers.length; h += 1) {
      var col = headers.indexOf(check.headers[h]);
      if (col === -1) continue;
      for (var r = 0; r < rows.length; r += 1) {
        var cell = String(rows[r][col] === undefined ? '' : rows[r][col]).trim().toLowerCase();
        if (cell && wanted[cell]) return check.message;
      }
    }
  }
  return '';
}


function hasArrayDuplicate(values) {
  for (var i = 0; i < values.length; i += 1) {
    if (values.indexOf(values[i]) !== i) return true;
  }
  return false;
}


function isRegistrationEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}


/**
 * Neutralises spreadsheet formula injection. A leading =, +, - or @ makes
 * Sheets evaluate the cell, so the value is stored as literal text instead.
 */
function safeRegistrationCell(value) {
  var text = String(value || '').trim();
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}


/**
 * Per-identity throttle held in the script cache. Keys are hashed so no email
 * address or university ID is stored in the cache in readable form.
 */
function allowRegistrationRequest(scope, identity, seconds) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, scope + '|' + identity);
  var key = Utilities.base64EncodeWebSafe(digest).slice(0, 80);
  var cache = CacheService.getScriptCache();
  if (cache.get(key)) return false;
  cache.put(key, '1', seconds);
  return true;
}


/**
 * The reply both front-ends listen for. `source` must match the tag that the
 * requesting form filters on, or that form ignores this message and times out.
 */
function registrationReply(event, message, requestId) {
  var payload = JSON.stringify({ source: REGISTRATION_SOURCE, event: String(event),
    requestId: String(requestId || ''), message: String(message), version: REGISTRATION_VERSION })
    .replace(/</g, '\\u003c');
  var relay = 'var m=' + payload + ';' +
    'try{parent.postMessage(m,"*")}catch(e){}' +
    'try{if(top!==parent)top.postMessage(m,"*")}catch(e){}';
  return HtmlService.createHtmlOutput('<p>' + escapeRegistrationHtml(String(message)) + '</p><script>' + relay + '<\/script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


function escapeRegistrationHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


/**
 * GET is not a registration path and reports nothing about the workbook.
 */
function doGet() {
  return json_({ status: 'ok', message: 'ACM PSU event registration endpoint is live.', version: REGISTRATION_VERSION });
}


/** JSON response helper. */
function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
