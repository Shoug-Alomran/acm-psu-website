import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
function parse(source,file){const result=spawnSync(process.execPath,['--input-type=module','--check'],{input:source,encoding:'utf8'});assert.equal(result.status,0,file+' '+result.stderr);}
const [jamRoot,ctfRoot]=process.argv.slice(2);
if(!jamRoot||!ctfRoot)throw Error('Usage: node scripts/check-event-contract.mjs JAM_CHECKOUT CTF_CHECKOUT');
const read=(root,file)=>readFileSync(path.join(root,file),'utf8');
const context=vm.createContext({});
vm.runInContext(read('apps-script','Code.gs')+'\n'+read('apps-script','EventRegistration.gs'),context);
const jamHeaders=['Timestamp','Full Name','University ID','University Email','Phone Number','Major','Team Name','Team Members'];
const ctfHeaders=['Timestamp','Team Name','Captain Name','Captain University ID','Captain University Email','Captain Phone Number','Captain Major','Member 2 Name','Member 2 University ID','Member 2 University Email','Member 2 Major','Member 3 Name','Member 3 University ID','Member 3 University Email','Member 3 Major','Experience Level'];
assert.deepEqual(Array.from(context.EVENT_SHEETS.jam26),jamHeaders);
assert.deepEqual(Array.from(context.EVENT_SHEETS.ctf30),ctfHeaders);
assert.deepEqual(Object.keys(context.REGISTRATION_EVENTS).sort(),['ctf30','jam26']);
const endpoint=root=>read(root,'config.js').match(/https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/g);
assert.equal(endpoint(jamRoot).length,1);assert.equal(endpoint(ctfRoot).length,1);assert.equal(endpoint(jamRoot)[0],endpoint(ctfRoot)[0]);
assert.equal(read(jamRoot,'assets/event-registration.js'),read(ctfRoot,'assets/event-registration.js'));
const jam=read(jamRoot,'team-formation.html'),ctf=read(ctfRoot,'register.html');
for(const [html,event] of [[jam,'jam26'],[ctf,'ctf30']]){
 assert.match(html,new RegExp("event: '"+event+"'"));
 assert.equal((html.match(/addEventListener\('submit'/g)||[]).length,1);
 assert.match(html,/assets\/event-registration\.js/);
 assert.doesNotMatch(html,/no-cors|fetch\(/);
 assert.match(html,/message !== 'OK'/);
}
const jamFields=[...jam.matchAll(/(\w+): val\('([^']+)'\)/g)].map(m=>{assert.equal(m[1],m[2]);return m[1];});
assert.deepEqual(jamFields.sort(),['fullName','universityId','universityEmail','phoneNumber','major','teamName','website'].sort());assert.match(jam,/teamMembers: emails.join\(', '\)/);
const names=[...ctf.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(m=>m[1]).filter(n=>!['rules','event','website'].includes(n)).sort();
assert.deepEqual(names,Object.keys(context.REGISTRATION_EVENTS.ctf30.fields).sort());
assert.doesNotMatch(read(jamRoot,'config.js'),/addEventListener|fetch\(/);
assert.match(read(ctfRoot,'assets/interactions-core.js'),/register\.html/);
const edge=read('supabase/functions/club-records-sheet-sync','index.ts');
const order=edge.match(/const ORDER:[\s\S]*?;/)[0];const mapping=edge.match(/const NAMES:[\s\S]*?\n};/)[0];
assert.doesNotMatch(order+mapping,/jam26|ctf30/);
assert.match(edge,/ORDER.includes\(key\)/);
const functions=['people','membershipApplications','members','clubPositions','opportunityPositions','positionApplications','participation','contributions','inquiries','exportLog'];
for(const [i,label] of Object.keys(context.CANONICAL_SHEETS).entries()){
 const body=edge.split('async function '+functions[i]+'(')[1];const header=body.match(/return \[\[([\s\S]*?)\],/)[1];const expected=[...header.matchAll(/'([^']*)'/g)].map(m=>m[1]);assert.deepEqual(Array.from(context.CANONICAL_SHEETS[label]),expected,label);
}
let parsed=0;
function scan(root,dir=root){for(const entry of readdirSync(dir,{withFileTypes:true})){
 if(['.git','node_modules','.github'].includes(entry.name))continue;const file=path.join(dir,entry.name);
 if(entry.isDirectory()){scan(root,file);continue;}
 if(entry.name.endsWith('.html')){const html=readFileSync(file,'utf8');for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 if(/application\/ld\+json|importmap/.test(m[1]))continue;
 const src=m[1].match(/src=["']([^"']+)/);if(src&&!/^https?:|^\/\//.test(src[1]))assert.ok(existsSync(path.resolve(path.dirname(file),src[1].split('?')[0])),file+': '+src[1]);
 if(m[2].trim()){parse(m[2],file);parsed++;}
 }}else if(entry.name.endsWith('.js')&&!entry.name.includes('tailwind.config')){parse(readFileSync(file,'utf8'),file);parsed++;}
}}
scan(jamRoot);scan(ctfRoot);
console.log(`PASS cross-repo endpoints, payloads, response guards, exact schemas, canonical sync isolation; ${parsed} scripts parsed`);
