import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const sources = ['Code.gs', 'EventRegistration.gs'].map(f => readFileSync(new URL('../apps-script/' + f, import.meta.url), 'utf8')).join('\n');
function fixture(properties = {}) {
  const sheets = {}, cache = new Map(), fetches = [];
  let flushed = 0;
  const logs = [];
  const context = vm.createContext({ console: {error(){}}, Date, Object, JSON,
    Logger: {log(message){logs.push(String(message));}},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => properties[k] ?? null})},
    UrlFetchApp: {fetch(url, options){fetches.push({url, options});return {getResponseCode:()=>200};}},
    LockService: {getScriptLock: () => ({waitLock(){}, releaseLock(){}})},
    CacheService: {getScriptCache: () => ({get: k => cache.get(k), put: (k,v) => cache.set(k,v)})},
    Utilities: {DigestAlgorithm: {SHA_256:'sha256'}, computeDigest: (_,s) => createHash('sha256').update(s).digest(), base64EncodeWebSafe: b => b.toString('base64url')},
    HtmlService: {XFrameOptionsMode:{ALLOWALL:'ALLOWALL'}, createHtmlOutput: html => ({html, setXFrameOptionsMode(mode){this.mode=mode;return this;}})},
    ContentService: {MimeType:{JSON:'json'},createTextOutput: text => ({text,setMimeType(){return this;}})},
    SpreadsheetApp: {openById(id){assert.equal(id,'1WtNGmVYO8hk_w3I37n1T6wS9_z_dTyTPW4fTHZ4lW3s');return {getSheetByName:n=>sheets[n]};}, flush(){flushed++;}}
  });
  vm.runInContext(sources, context);
  function sheet(rows) {return {rows, getLastColumn:()=>Math.max(0,...rows.map(r=>r.length)), getLastRow:()=>rows.length,
    getRange(r,c,n,w){return {getValues:()=>rows.slice(r-1,r-1+n).map(row=>Array.from({length:w},(_,i)=>row[c-1+i]??'')),getDisplayValues:()=>rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w).map(v=>String(v).replace(/^'/,''))),setValues(values){rows.splice(r-1,values.length,...values);}};},appendRow(row){rows.push(row);}};}
  for(const [name,headers] of Object.entries(context.EVENT_SHEETS)) sheets[name]=sheet([Array.from(headers)]);
  function post(payload) {const response=context.doPost({parameter:payload});assert.equal(response.mode,'ALLOWALL');assert.match(response.html,/parent.postMessage/);assert.match(response.html,/top.postMessage/);const data=JSON.parse(response.html.match(/var m=(.*?);try/)[1]);assert.equal(data.source,'acm-event-registration');assert.equal(data.event,payload.event??'');return data.message;}
  return {context,sheets,post,cache,sheet,fetches,logs,get flushed(){return flushed;}};
}
const jam={event:'jam26',fullName:'ZZ Test Jam Delete Me',universityId:'999000001',universityEmail:'999000001@psu.edu.sa',phoneNumber:'0500000000',major:'Software Engineering',teamName:'ZZ_TEST_DELETE_ME',teamMembers:'jam.test.member@psu.edu.sa',website:''};
const ctf={event:'ctf30',teamName:'ZZ_TEST_TEAM_DELETE_ME',captainName:'ZZ Test Captain',captainId:'999000002',captainEmail:'999000002@psu.edu.sa',captainPhone:'0500000000',captainMajor:'Computer Science',member2Name:'ZZ Test Member Two',member2Id:'999000003',member2Email:'999000003@psu.edu.sa',member2Major:'Computer Science',member3Name:'',member3Id:'',member3Email:'',member3Major:'',experience:'Beginner',website:''};
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
test('Jam append, column H, explicit OK, duplicate email and ID',()=>{const f=fixture();assert.equal(f.post(jam),'OK');assert.equal(f.sheets.jam26.rows[1][7],jam.teamMembers);assert.equal(f.flushed,1);assert.match(f.post(jam),/already registered/);assert.match(f.post({...jam,universityEmail:'another@psu.edu.sa'}),/already registered/);assert.equal(f.sheets.jam26.rows.length,2);});
test('CTF append, blank optional columns, enum and duplicate participant across slots',()=>{const f=fixture();assert.equal(f.post(ctf),'OK');assert.deepEqual(Array.from(f.sheets.ctf30.rows[1].slice(11,15)),['','','','']);assert.equal(f.sheets.ctf30.rows[1][15],'Beginner');assert.match(f.post({...ctf,teamName:'Different',captainId:'999000004',captainEmail:'new@psu.edu.sa'}),/already registered/);assert.equal(f.sheets.ctf30.rows.length,2);});
for(const [name,payload,pattern] of [
 ['partial member3',{...ctf,member3Name:'Only a name'},/complete every optional member/],
 ['invalid experience',{...ctf,experience:'Expert'},/invalid experience/],
 ['duplicate member IDs',{...ctf,member2Id:ctf.captainId},/different university ID/],
 ['duplicate member emails',{...ctf,member2Email:ctf.captainEmail.toUpperCase()},/different university email/],
 ['missing field',{...jam,fullName:''},/missing/],['bad email',{...jam,universityEmail:'invalid'},/invalid/],
 ['bad teammate email',{...jam,teamMembers:'invalid'},/valid team member emails/],
 ['length limit',{...jam,fullName:'a'.repeat(121)},/too long/],['honeypot',{...jam,website:'bot'},/not be accepted/],
 ['canonical target',{...jam,event:'People'},/unsupported/],['no event',{...jam,event:''},/unsupported/],['prototype target',{...jam,event:'constructor'},/unsupported/],
 ['bad requestId',{...jam,requestId:'bad'},/invalid request/]
]) test(name+' never writes',()=>{const f=fixture();assert.match(f.post(payload),pattern);assert.equal(f.sheets.jam26.rows.length,1);assert.equal(f.sheets.ctf30.rows.length,1);});
test('exact header mismatch refuses writes without mutation',()=>{for(const mutate of [h=>h.reverse(),h=>h[0]+=' ',h=>h.push('Extra')]){const f=fixture();mutate(f.sheets.jam26.rows[0]);const before=JSON.stringify(f.sheets.jam26.rows);assert.match(f.post(jam),/not ready/);assert.equal(JSON.stringify(f.sheets.jam26.rows),before);}});
test('formula cells stored as literal text',()=>{const f=fixture();for(const prefix of ['=','+','-','@']) assert.equal(f.context.safeRegistrationCell(' '+prefix+'SUM(1)'),"'"+prefix+'SUM(1)');assert.equal(f.post({...jam,fullName:'=IMPORTXML("x")'}),'OK');assert.equal(f.sheets.jam26.rows[1][1],"'=IMPORTXML(\"x\")");});
test('burst throttle and lock failure never append',()=>{const f=fixture();f.cache.set('event-burst:jam26:'+Math.floor(Date.now()/60000),'120');assert.match(f.post(jam),/busy/);f.context.LockService.getScriptLock=()=>({waitLock(){throw Error('lock');},releaseLock(){}});assert.match(f.post(jam),/not be confirmed/);assert.equal(f.sheets.jam26.rows.length,1);});
test('storage/flush failure never acknowledges OK',()=>{const f=fixture();f.context.SpreadsheetApp.flush=()=>{throw Error('private details');};const result=f.post(jam);assert.match(result,/not be confirmed/);assert.doesNotMatch(result,/private details/);});
test('setup leaves event rows intact and refuses header mismatch including blank row1 with data',()=>{for(const rows of [[['wrong'],['registration']],[[''],['registration']]]){const f=fixture();const sheet=f.sheet(rows);const before=JSON.stringify(rows),notes=[];f.context.prepareEventSheet_({getSheetByName:()=>sheet},'jam26',f.context.EVENT_SHEETS.jam26,notes);assert.match(notes.join(''),/HEADER MISMATCH/);assert.equal(JSON.stringify(rows),before);}});
test('setup seeds only empty tabs and preserves matching rows',()=>{for(const initial of [[],null]){const f=fixture();for(const name of ['ensureEnoughColumns_','styleHeader_','formatColumns_','protectEventSheet_'])f.context[name]=()=>{};let sheet=initial===null?null:f.sheet(initial);const book={getSheetByName:()=>sheet,insertSheet(){sheet=f.sheet([]);return sheet;}};const notes=[];f.context.prepareEventSheet_(book,'jam26',f.context.EVENT_SHEETS.jam26,notes);assert.deepEqual(Array.from(sheet.rows[0]),Array.from(f.context.EVENT_SHEETS.jam26));sheet.rows.push(['existing registration']);const before=JSON.stringify(sheet.rows);f.context.prepareEventSheet_(book,'jam26',f.context.EVENT_SHEETS.jam26,notes);assert.equal(JSON.stringify(sheet.rows),before);assert.match(notes.join(''),/header row matches, left untouched/);}});
test('complete third member, team duplicate and optional email validation',()=>{const f=fixture();const third={...ctf,member3Name:'Third',member3Id:'999000004',member3Email:'third@psu.edu.sa',member3Major:'CS'};assert.equal(f.post(third),'OK');assert.equal(f.sheets.ctf30.rows[1][13],third.member3Email);assert.match(f.post({...ctf,captainEmail:'other@psu.edu.sa',captainId:'100000',member2Email:'other2@psu.edu.sa',member2Id:'100001'}),/team name/);const g=fixture();assert.match(g.post({...third,member3Email:'bad'}),/invalid member3Email/);assert.equal(g.sheets.ctf30.rows.length,1);});
test('reply safely escapes script markup and echoes correlation',()=>{const f=fixture();const result=f.context.registrationReply('jam26','</script><script>bad()</script>','a'.repeat(32));assert.doesNotMatch(result.html,/<script>bad/);const payload=JSON.parse(result.html.match(/var m=(.*?);try/)[1]);assert.equal(payload.requestId,'a'.repeat(32));assert.equal(payload.message,'</script><script>bad()</script>');});
test('health version and single entrypoints',()=>{const f=fixture();assert.deepEqual(JSON.parse(f.context.doGet().text),{status:'ok',message:'ACM PSU event registration endpoint is live.',version:'2026-09-05.1'});assert.equal((sources.match(/function doPost\(/g)||[]).length,1);assert.equal((sources.match(/function doGet\(/g)||[]).length,1);for(const name of ['jam26','ctf30']) assert.equal(name in f.context.CANONICAL_SHEETS,false);});
test('accepted registration is mirrored to the platform without changing the reply',()=>{const f=fixture({PLATFORM_INTAKE_URL:'https://example.test/intake',PLATFORM_INTAKE_TOKEN:'shared-secret'});const requestId='a'.repeat(32);assert.equal(f.post({...jam,requestId}),'OK');assert.equal(f.fetches.length,1);const call=f.fetches[0];assert.equal(call.url,'https://example.test/intake');assert.equal(call.options.method,'post');assert.equal(call.options.contentType,'application/json');assert.equal(call.options.headers['x-registration-token'],'shared-secret');assert.equal(call.options.muteHttpExceptions,true);const body=JSON.parse(call.options.payload);assert.equal(body.event,'jam26');assert.equal(body.requestId,requestId);assert.equal(body.fields['Full Name'],jam.fullName);assert.equal(body.fields['Team Members'],jam.teamMembers);assert.equal(typeof body.fields.Timestamp,'string');});
test('mirror is skipped entirely until it is configured',()=>{for(const properties of [{},{PLATFORM_INTAKE_URL:'https://example.test/intake'},{PLATFORM_INTAKE_TOKEN:'shared-secret'}]){const f=fixture(properties);assert.equal(f.post(jam),'OK');assert.equal(f.fetches.length,0);assert.equal(f.sheets.jam26.rows.length,2);}});
test('a failing mirror never loses or unacknowledges a registration',()=>{const f=fixture({PLATFORM_INTAKE_URL:'https://example.test/intake',PLATFORM_INTAKE_TOKEN:'shared-secret'});f.context.UrlFetchApp.fetch=()=>{throw Error('platform unreachable');};assert.equal(f.post(jam),'OK');assert.equal(f.sheets.jam26.rows.length,2);});
test('a rejected registration is never mirrored',()=>{const f=fixture({PLATFORM_INTAKE_URL:'https://example.test/intake',PLATFORM_INTAKE_TOKEN:'shared-secret'});assert.match(f.post({...jam,universityEmail:'invalid'}),/invalid/);assert.equal(f.post(jam),'OK');assert.match(f.post(jam),/already registered/);assert.equal(f.fetches.length,1);});

/* A workbook whose columns are typed, as a Google Sheets Table makes them.
   Every formatting call is recorded; setNumberFormat refuses the way the live
   workbook refused it. */
function workbookFixture({typed=true}={}) {
  const f = fixture();
  const calls = {numberFormat:0, columnWidth:0, frozenRows:0, protected:0};
  function makeSheet(rows) {
    const width = () => Math.max(0, ...rows.map(r=>r.length));
    const sheet = {rows,
      getLastRow:()=>rows.length, getLastColumn:()=>width(),
      getMaxRows:()=>Math.max(rows.length,1), getMaxColumns:()=>Math.max(width(),1),
      insertColumnsAfter(){}, setFrozenRows(){calls.frozenRows+=1;}, setRowHeight(){},
      setColumnWidth(){calls.columnWidth+=1;},
      getProtections:()=>[],
      protect(){calls.protected+=1;return {setDescription(){return this;},setWarningOnly(){return this;}};},
      getRange(r,c,n,w){
        const range = {
          getValues:()=>rows.slice(r-1,r-1+n).map(row=>Array.from({length:w},(_,i)=>row[c-1+i]??'')),
          getDisplayValues:()=>rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w).map(v=>String(v).replace(/^'/,''))),
          setValues(values){values.forEach((line,i)=>{const target=rows[r-1+i]??(rows[r-1+i]=[]);line.forEach((v,j)=>{target[c-1+j]=v;});});return range;},
          setNumberFormat(){calls.numberFormat+=1;if(typed)throw new Error("You can't set the number format of cells in a typed column.");return range;}};
        for(const chainable of ['setBackground','setFontColor','setFontWeight','setHorizontalAlignment','setVerticalAlignment','setWrap'])range[chainable]=()=>range;
        return range;}};
    return sheet;
  }
  const tabs = {};
  for(const [name,headers] of Object.entries(f.context.CANONICAL_SHEETS)) tabs[name]=makeSheet([Array.from(headers)]);
  // Event tabs carry a registration row, so formatting reaches row 2 and the
  // test can prove that row is never touched.
  for(const [name,headers] of Object.entries(f.context.EVENT_SHEETS)) tabs[name]=makeSheet([Array.from(headers),Array.from(headers,(_,i)=>'row-'+i)]);
  const book = {getSheetByName:n=>tabs[n]??null, insertSheet(n){tabs[n]=makeSheet([]);return tabs[n];}};
  f.context.SpreadsheetApp.getActiveSpreadsheet=()=>book;
  f.context.SpreadsheetApp.ProtectionType={SHEET:'SHEET'};
  return {...f, tabs, calls, book, report:()=>f.logs.join('\n')};
}

test('typed-column formatting failures warn instead of aborting setup',()=>{const w=workbookFixture();const before=JSON.stringify(w.tabs.jam26.rows);w.context.setupClubRecordsWorkbook();const report=w.report();assert.ok(w.calls.numberFormat>0,'number formatting was attempted');assert.match(report,/WARNING .*date format — skipped: You can't set the number format of cells in a typed column\./);
  // Requirement: the run still finishes and still reports both event tabs.
  assert.match(report,/Event jam26 — header row matches, left untouched\./);assert.match(report,/Event ctf30 — header row matches, left untouched\./);
  assert.match(report,/Mirror  People — headers applied \(14 columns\)\./);
  // Requirement: no data rows cleared, and the rest of the formatting still ran.
  assert.equal(JSON.stringify(w.tabs.jam26.rows),before);assert.equal(w.tabs.jam26.rows.length,2);assert.ok(w.calls.columnWidth>0);assert.ok(w.calls.frozenRows>0);assert.ok(w.calls.protected>0);});

test('an untyped workbook still formats cleanly and warns about nothing',()=>{const w=workbookFixture({typed:false});w.context.setupClubRecordsWorkbook();const report=w.report();assert.doesNotMatch(report,/WARNING/);assert.ok(w.calls.numberFormat>0);assert.equal(w.tabs.ctf30.rows.length,2);});

test('one unpreparable tab never costs the run its report',()=>{const w=workbookFixture();const broken=w.tabs['Members'];broken.getRange=()=>{throw new Error('sheet is a table');};w.context.setupClubRecordsWorkbook();const report=w.report();assert.match(report,/WARNING Mirror {2}Members — not prepared: sheet is a table \(no data was cleared\)\./);assert.match(report,/Event jam26 — header row matches, left untouched\./);assert.match(report,/Event ctf30 — header row matches, left untouched\./);});

test('setup never touches a filter',()=>{const w=workbookFixture();
  // A filter API reached at all is the production failure this removes, so the
  // mocks have none: any call would throw and be reported.
  w.context.setupClubRecordsWorkbook();assert.doesNotMatch(w.report(),/filter/i);
  for(const banned of [/\bapplyFilter_\b/,/\.getFilter\(/,/\.createFilter\(/,/\.remove\(\)/,/setBasicFilter/,/clearBasicFilter/]) assert.doesNotMatch(sources,banned,'Code.gs must not touch filters: '+banned);});

test('every setNumberFormat call in the source is guarded',()=>{const guarded=sources.split('setNumberFormat(').length-1;assert.equal(guarded,1);assert.match(sources,/safely_\([^\n]*date format[\s\S]{0,200}setNumberFormat\(/);});

console.log(`${count} server contract tests passed`);
