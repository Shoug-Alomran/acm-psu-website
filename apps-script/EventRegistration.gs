/**
 * ACM PSU public event registration handler.
 *
 * Add this file to the Apps Script project attached to the
 * “ACM PSU — Club Records” workbook, then make Code.gs doPost(e) delegate to
 * handleEventRegistrationPost_(e).
 *
 * Allowed destinations are fixed to jam26 and ctf30. No request may choose an
 * arbitrary worksheet. Canonical Supabase mirror tabs are never touched here.
 */

var REGISTRATION_SPREADSHEET_ID = '1WtNGmVYO8hk_w3I37n1T6wS9_z_dTyTPW4fTHZ4lW3s';
var JAM_SHEET = 'jam26';
var CTF_SHEET = 'ctf30';

var JAM_FIELDS = {
  fullName: 'Full Name',
  universityId: 'University ID',
  universityEmail: 'University Email',
  phoneNumber: 'Phone Number',
  major: 'Major',
  teamName: 'Team Name',
  teamMembers: 'Team Members'
};

var CTF_FIELDS = {
  teamName: 'Team Name',
  captainName: 'Captain Name',
  captainId: 'Captain University ID',
  captainEmail: 'Captain University Email',
  captainPhone: 'Captain Phone Number',
  captainMajor: 'Captain Major',
  member2Name: 'Member 2 Name',
  member2Id: 'Member 2 University ID',
  member2Email: 'Member 2 University Email',
  member2Major: 'Member 2 Major',
  member3Name: 'Member 3 Name',
  member3Id: 'Member 3 University ID',
  member3Email: 'Member 3 University Email',
  member3Major: 'Member 3 Major',
  experience: 'Experience Level'
};

var EVENT_LIMITS = {
  fullName: 120,
  universityId: 40,
  universityEmail: 254,
  phoneNumber: 40,
  major: 120,
  teamName: 120,
  teamMembers: 1500,
  captainName: 120,
  captainId: 40,
  captainEmail: 254,
  captainPhone: 40,
  captainMajor: 120,
  member2Name: 120,
  member2Id: 40,
  member2Email: 254,
  member2Major: 120,
  member3Name: 120,
  member3Id: 40,
  member3Email: 254,
  member3Major: 120,
  experience: 40
};

/** Entry point called by Code.gs doPost(e). */
function handleEventRegistrationPost_(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var form = (e && e.parameter) || {};
    var eventName = String(form.event || 'jam26').trim();

    if (eventName === 'jam26') return handleJamRegistration_(form);
    if (eventName === 'ctf30') return handleCtfRegistration_(form);

    return eventRegistrationPage_('Error: unsupported event');
  } catch (err) {
    console.error(err);
    return eventRegistrationPage_('Error: something went wrong on our side. Please try again, or contact the organizers.');
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function handleJamRegistration_(form) {
  if (form.website) return eventRegistrationPage_('OK');

  var required = ['fullName', 'universityId', 'universityEmail', 'phoneNumber', 'major', 'teamName'];
  var missing = eventRequireFields_(form, required);
  if (missing) return eventRegistrationPage_('Error: missing ' + missing);

  var validationError = eventValidateLengths_(form, required.concat(['teamMembers']));
  if (validationError) return eventRegistrationPage_('Error: ' + validationError);
  if (!eventIsEmail_(form.universityEmail)) return eventRegistrationPage_('Error: invalid universityEmail');

  var sheet = eventRegistrationSheet_(JAM_SHEET);
  if (eventDuplicateInAnyColumn_(sheet, ['University Email', 'University ID'], [form.universityEmail, form.universityId])) {
    return eventRegistrationPage_('Error: this participant is already registered');
  }

  var identity = String(form.universityEmail).trim().toLowerCase() + '|' + String(form.universityId).trim();
  if (!eventAllowRequest_('jam26', identity, 300)) {
    return eventRegistrationPage_('Error: please wait before submitting again');
  }

  var writeError = eventAppendMappedRow_(sheet, JAM_FIELDS, form);
  if (writeError) return eventRegistrationPage_('Error: ' + writeError);
  return eventRegistrationPage_('OK');
}

function handleCtfRegistration_(form) {
  if (form.website) return eventRegistrationPage_('OK');

  var required = [
    'teamName', 'captainName', 'captainId', 'captainEmail', 'captainPhone', 'captainMajor',
    'member2Name', 'member2Id', 'member2Email', 'member2Major', 'experience'
  ];
  var missing = eventRequireFields_(form, required);
  if (missing) return eventRegistrationPage_('Error: missing ' + missing);

  var optionalThird = ['member3Name', 'member3Id', 'member3Email', 'member3Major'];
  var anyThird = optionalThird.some(function (field) {
    return String(form[field] || '').trim();
  });
  if (anyThird) {
    var missingThird = eventRequireFields_(form, optionalThird);
    if (missingThird) {
      return eventRegistrationPage_('Error: complete every optional member field or leave them all blank');
    }
  }

  var validationError = eventValidateLengths_(form, required.concat(optionalThird));
  if (validationError) return eventRegistrationPage_('Error: ' + validationError);

  if (!eventIsEmail_(form.captainEmail) ||
      !eventIsEmail_(form.member2Email) ||
      (anyThird && !eventIsEmail_(form.member3Email))) {
    return eventRegistrationPage_('Error: invalid university email');
  }

  var emails = [form.captainEmail, form.member2Email];
  var ids = [form.captainId, form.member2Id];
  if (anyThird) {
    emails.push(form.member3Email);
    ids.push(form.member3Id);
  }
  if (eventHasDuplicates_(emails)) return eventRegistrationPage_('Error: each member needs a different university email');
  if (eventHasDuplicates_(ids)) return eventRegistrationPage_('Error: each member needs a different university ID');

  var sheet = eventRegistrationSheet_(CTF_SHEET);
  if (eventDuplicateInAnyColumn_(sheet,
      ['Captain University Email', 'Captain University ID', 'Team Name'],
      [form.captainEmail, form.captainId, form.teamName])) {
    return eventRegistrationPage_('Error: this team or captain is already registered');
  }

  var identity = String(form.captainEmail).trim().toLowerCase() + '|' + String(form.teamName).trim().toLowerCase();
  if (!eventAllowRequest_('ctf30', identity, 300)) {
    return eventRegistrationPage_('Error: please wait before submitting again');
  }

  var writeError = eventAppendMappedRow_(sheet, CTF_FIELDS, form);
  if (writeError) return eventRegistrationPage_('Error: ' + writeError);
  return eventRegistrationPage_('OK');
}

function eventRegistrationSheet_(name) {
  if (name !== JAM_SHEET && name !== CTF_SHEET) {
    throw new Error('unsupported registration sheet');
  }
  var workbook = SpreadsheetApp.openById(REGISTRATION_SPREADSHEET_ID);
  var sheet = workbook.getSheetByName(name);
  if (!sheet) throw new Error('no sheet named "' + name + '"');
  return sheet;
}

function eventAppendMappedRow_(sheet, mapping, form) {
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
    .getValues()[0]
    .map(function (h) { return String(h).trim(); });

  var expected = ['Timestamp'].concat(Object.keys(mapping).map(function (field) {
    return mapping[field];
  }));
  var missing = expected.filter(function (header) {
    return headers.indexOf(header) === -1;
  });
  if (missing.length) {
    return 'the ' + sheet.getName() + ' sheet is missing these columns: ' + missing.join(', ');
  }

  var row = new Array(headers.length).fill('');
  Object.keys(mapping).forEach(function (field) {
    var column = headers.indexOf(mapping[field]);
    if (column !== -1) row[column] = eventSafeCell_(form[field] || '');
  });
  row[headers.indexOf('Timestamp')] = new Date();
  sheet.appendRow(row);
  return '';
}

function eventRequireFields_(form, fields) {
  for (var i = 0; i < fields.length; i += 1) {
    if (!String(form[fields[i]] || '').trim()) return fields[i];
  }
  return '';
}

function eventValidateLengths_(form, fields) {
  for (var i = 0; i < fields.length; i += 1) {
    var field = fields[i];
    if (String(form[field] || '').length > (EVENT_LIMITS[field] || 500)) {
      return field + ' is too long';
    }
  }
  return '';
}

function eventIsEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function eventHasDuplicates_(values) {
  var seen = {};
  for (var i = 0; i < values.length; i += 1) {
    var value = String(values[i] || '').trim().toLowerCase();
    if (!value) continue;
    if (seen[value]) return true;
    seen[value] = true;
  }
  return false;
}

function eventSafeCell_(value) {
  var text = String(value || '').trim();
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function eventDuplicateInAnyColumn_(sheet, headersToCheck, valuesToCheck) {
  if (sheet.getLastRow() < 2) return false;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function (h) { return String(h).trim(); });

  for (var i = 0; i < headersToCheck.length; i += 1) {
    var col = headers.indexOf(headersToCheck[i]);
    if (col < 0) continue;
    var target = String(valuesToCheck[i] || '').trim().toLowerCase();
    if (!target) continue;
    var existing = sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (var r = 0; r < existing.length; r += 1) {
      if (String(existing[r][0]).trim().toLowerCase() === target) return true;
    }
  }
  return false;
}

function eventAllowRequest_(scope, identity, seconds) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    scope + '|' + identity
  );
  var key = Utilities.base64EncodeWebSafe(digest).slice(0, 80);
  var cache = CacheService.getScriptCache();
  if (cache.get(key)) return false;
  cache.put(key, '1', seconds);
  return true;
}

/**
 * HTML response suitable for the hidden-iframe CTF flow. The same response is
 * harmless for JAM's no-cors fetch. ALLOWALL is required so Google's response
 * can load in the event site's hidden iframe and post the result back.
 */
function eventRegistrationPage_(message) {
  var payload = JSON.stringify({
    source: 'acm-event-registration',
    message: String(message)
  }).replace(/</g, '\\u003c');

  var relay =
    'var m=' + payload + ';' +
    'try{parent.postMessage(m,"*")}catch(e){}' +
    'try{if(top!==parent)top.postMessage(m,"*")}catch(e){}';

  return HtmlService
    .createHtmlOutput('<p>' + eventEscapeHtml_(message) + '</p><script>' + relay + '<\/script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function eventEscapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
