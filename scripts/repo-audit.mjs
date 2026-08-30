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

// 1. Supabase migration versions must be unique.
const migrationFiles = walk('supabase/migrations').filter((file) => file.endsWith('.sql'));
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

// 3. Browser code must never contain the service-role secret name.
for (const file of [...walk('platform'), ...walk('assets/js')].filter((f) => /\.(ts|js)$/.test(f))) {
  const text = read(file);
  if (text.includes('SUPABASE_SERVICE_ROLE_KEY')) fail(`Browser-side code references SUPABASE_SERVICE_ROLE_KEY: ${file}`);
  if (/@ts-ignore|@ts-expect-error/.test(text)) fail(`TypeScript suppression found: ${file}`);
  if (/\bas\s+any\b/.test(text)) fail(`Unsafe 'as any' cast found: ${file}`);
}

// 4. Relative TypeScript imports written as .js must resolve to source .ts/.js files.
for (const file of walk('platform').filter((f) => f.endsWith('.ts'))) {
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

// 5. HTML module entrypoints must reference generated bundles that exist after build.
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

// 6. Prevent dangerous authorization shortcuts from silently entering migrations.
for (const file of migrationFiles) {
  const text = read(file);
  if (/disable\s+row\s+level\s+security/i.test(text)) fail(`Migration disables RLS: ${file}`);
  if (/grant\s+all\s+on\s+(table\s+)?public\./i.test(text)) fail(`Migration grants ALL on a public object: ${file}`);
}

for (const message of warnings) console.warn(`WARN: ${message}`);
if (errors.length) {
  for (const message of errors) console.error(`ERROR: ${message}`);
  console.error(`\nRepository audit failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`Repository audit passed: ${migrationFiles.length} migrations, ${functionDirs.length} Edge Functions, ${walk('platform').filter((f) => f.endsWith('.ts')).length} TypeScript source files checked.`);
