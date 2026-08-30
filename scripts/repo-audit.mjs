import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function exists(rel) { return fs.existsSync(path.join(root, rel)); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function walk(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir.replaceAll('\\', '/'), entry.name);
    return entry.isDirectory() ? walk(rel) : [rel];
  });
}

const platformFiles = walk('platform').filter((file) => file.endsWith('.ts'));
const migrationFiles = walk('supabase/migrations').filter((file) => file.endsWith('.sql'));
const migrationText = migrationFiles.map(read).join('\n');

// 1. Supabase migration versions must be unique.
const versions = new Map();
for (const file of migrationFiles) {
  const name = path.basename(file);
  const match = name.match(/^(\d{14})_/);
  if (!match) {
    fail(`Migration does not start with a 14-digit version: ${file}`);
    continue;
  }
  const list = versions.get(match[1]) ?? [];
  list.push(file);
  versions.set(match[1], list);
}
for (const [version, files] of versions) {
  if (files.length > 1) fail(`Duplicate Supabase migration version ${version}: ${files.join(', ')}`);
}

// 2. Every deployed Edge Function must exist and every function directory needs index.ts.
const packageJson = JSON.parse(read('package.json'));
const deployScript = packageJson.scripts?.['functions:deploy'] ?? '';
const deployed = [...deployScript.matchAll(/supabase functions deploy\s+([\w-]+)/g)].map((m) => m[1]);
const functionDirs = fs.readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name);
for (const name of functionDirs) {
  if (!exists(`supabase/functions/${name}/index.ts`)) fail(`Edge Function ${name} has no index.ts`);
}
for (const name of deployed) {
  if (!functionDirs.includes(name)) fail(`functions:deploy references missing Edge Function: ${name}`);
}
for (const name of functionDirs) {
  if (!deployed.includes(name)) warn(`Edge Function exists but is not included in functions:deploy: ${name}`);
}

// Browser invocations must reference a real Edge Function directory.
for (const file of platformFiles) {
  const text = read(file);
  const patterns = [
    /functions\.invoke\(\s*['"]([\w-]+)['"]/g,
    /callFunction\(\s*['"]([\w-]+)['"]/g,
    /bestEffortFunctionSync\(\s*['"]([\w-]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (!functionDirs.includes(match[1])) fail(`${file} invokes missing Edge Function: ${match[1]}`);
    }
  }
}

// 3. Browser code must never contain the service-role secret name or TS escape hatches.
for (const file of [...platformFiles, ...walk('assets/js').filter((f) => f.endsWith('.js'))]) {
  const text = read(file);
  if (text.includes('SUPABASE_SERVICE_ROLE_KEY')) fail(`Browser-side code references SUPABASE_SERVICE_ROLE_KEY: ${file}`);
  if (/@ts-ignore|@ts-expect-error/.test(text)) fail(`TypeScript suppression found: ${file}`);
  if (file.endsWith('.ts') && /\bas\s+any\b/.test(text)) fail(`Unsafe 'as any' cast found: ${file}`);
}

// 4. Relative TypeScript imports written as .js must resolve to source .ts/.js files.
for (const file of platformFiles) {
  const text = read(file);
  for (const match of text.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
    const spec = match[1];
    const fromDir = path.dirname(path.join(root, file));
    const target = path.resolve(fromDir, spec);
    const candidates = spec.endsWith('.js')
      ? [target.slice(0, -3) + '.ts', target]
      : [target, `${target}.ts`, `${target}.js`, path.join(target, 'index.ts')];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      fail(`Broken relative import in ${file}: ${spec}`);
    }
  }
}

// 5. Every statically named browser/Edge Function RPC must exist in migration source.
const rpcNames = new Set();
for (const file of platformFiles) {
  for (const match of read(file).matchAll(/\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) rpcNames.add(match[1]);
}
for (const file of walk('supabase/functions').filter((f) => f.endsWith('.ts'))) {
  for (const match of read(file).matchAll(/\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) rpcNames.add(match[1]);
}
for (const rpc of rpcNames) {
  const escaped = rpc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declared = new RegExp(`(?:create\\s+or\\s+replace\\s+function|create\\s+function)\\s+public\\.${escaped}\\s*\\(`, 'i');
  if (!declared.test(migrationText)) fail(`Code calls RPC '${rpc}', but no public.${rpc}() declaration exists in migrations.`);
}

// 6. HTML script references must resolve to files currently present in the repository.
for (const file of [...walk('portal'), ...walk('admin')].filter((f) => f.endsWith('.html'))) {
  const text = read(file);
  for (const match of text.matchAll(/<script[^>]+src=['"]([^'"]+)['"]/gi)) {
    const src = match[1];
    if (/^(https?:)?\/\//.test(src)) continue;
    const clean = src.split(/[?#]/)[0];
    const resolved = clean.startsWith('/') ? clean.slice(1) : path.posix.normalize(path.posix.join(path.dirname(file), clean));
    if (!exists(resolved)) fail(`Missing script referenced by ${file}: ${src} -> ${resolved}`);
  }
}

// Every page source should have a generated bundle, preventing an unlinked/stale build entry.
for (const file of platformFiles.filter((f) => f.startsWith('platform/pages/'))) {
  const base = path.basename(file, '.ts');
  if (!exists(`assets/js/app/${base}.js`)) fail(`Missing generated page bundle for ${file}: assets/js/app/${base}.js`);
}

// 7. Prevent dangerous authorization shortcuts from silently entering migrations.
for (const file of migrationFiles) {
  const text = read(file);
  if (/disable\s+row\s+level\s+security/i.test(text)) fail(`Migration disables RLS: ${file}`);
  if (/grant\s+all\s+on\s+(table\s+)?public\./i.test(text)) fail(`Migration grants ALL on a public object: ${file}`);
}

// Function-level SQL hardening is validated by the project's linked Supabase
// lint/catalog migrations. A regex parser is deliberately not used here: SQL
// function bodies can contain DDL text and nested dollar-quoted blocks, which
// makes a source-only parser report neighboring functions incorrectly.

for (const message of warnings) console.warn(`WARN: ${message}`);
if (errors.length) {
  for (const message of errors) console.error(`ERROR: ${message}`);
  console.error(`\nRepository audit failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`Repository audit passed: ${migrationFiles.length} migrations, ${functionDirs.length} Edge Functions, ${platformFiles.length} TypeScript source files and ${rpcNames.size} RPC references checked.`);
