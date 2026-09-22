#!/usr/bin/env node
// Read-only, dependency-free. Never reads environment, database, or upload content.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = process.cwd();
const errors = [];
for (const arg of process.argv.slice(2)) {
  if (arg !== '--runtime' && !arg.startsWith('--state-path=')) {
    console.error(`UNKNOWN_OPTION ${arg}`);
    process.exit(1);
  }
}
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const exists = n => fs.existsSync(path.join(root, n));
const fail = s => errors.push(s);
const read = n => fs.readFileSync(path.join(root, n));
const safe = n => n && !path.isAbsolute(n) && !n.split(/[\\/]/).includes('..') && !n.includes('\\');
function regular(n) {
  if (!safe(n)) { fail(`UNSAFE_PATH ${n}`); return false; }
  let current = root;
  for (const part of n.split('/')) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) { fail(`MISSING ${n}`); return false; }
    if (fs.lstatSync(current).isSymbolicLink()) { fail(`SYMLINK ${n}`); return false; }
  }
  if (!fs.statSync(current).isFile()) { fail(`NOT_REGULAR ${n}`); return false; }
  return true;
}
if (exists('backend/package.json')) {
  console.error('WRAPPER_ROOT: enter backend/ and run node scripts/verify-install.mjs');
  process.exit(1);
}
for (const n of ['package.json','package-lock.json','tsconfig.json','server/index.ts',
  'shared/notificationDestination.ts','shared/notificationRouteManifest.ts',
  'shared/companyTaxonomy.ts','packages/cap-table-engine/src/index.ts',
  'server/public/index.html','migrations/0236_company_taxonomy.sql',
  'server/db/migrations/0236_company_taxonomy.sql','FILE_SHA256SUMS.txt','INSTALL_RECEIPT.json']) {
  regular(n);
}
if (errors.length) {
  console.error('PARTIAL_LAYOUT_OR_WRONG_ROOT: complete application root is required.');
  console.error(errors.join('\n')); process.exit(1);
}
let count = 0;
try {
  const receipt = JSON.parse(read('INSTALL_RECEIPT.json'));
  if (receipt.version !== '26.57.1') fail('UNEXPECTED_RELEASE_VERSION');
  const manifest = read('FILE_SHA256SUMS.txt');
  if (hash(manifest) !== receipt.manifestSha256) fail('MANIFEST_TAMPER FILE_SHA256SUMS.txt');
  const names = new Set();
  const exactNames = new Set();
  for (const line of manifest.toString().trim().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) { fail('INVALID_MANIFEST_LINE'); continue; }
    const [, sha, n] = match;
    if (names.has(n.toLowerCase())) { fail(`DUPLICATE_OR_CASE_COLLISION ${n}`); continue; }
    names.add(n.toLowerCase());
    exactNames.add(n);
    if (regular(n) && hash(read(n)) !== sha) fail(`CHANGED ${n}`);
    count++;
  }
  for (const n of receipt.runtimeClosure) if (!names.has(n.toLowerCase())) fail(`UNMANIFESTED_RUNTIME ${n}`);
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  if (![pkg.version, lock.version, lock.packages[''].version].every(v => v === receipt.version))
    fail('VERSION_MISMATCH');
  if (!read('migrations/0236_company_taxonomy.sql').equals(read('server/db/migrations/0236_company_taxonomy.sql')))
    fail('MIGRATION_MIRROR_MISMATCH');
  const html = read('server/public/index.html').toString();
  for (const m of html.matchAll(/(?:src|href)=["'](\/?assets\/[^"'?#]+)(?:[^"']*)["']/g))
    regular('server/public/' + m[1].replace(/^\//,''));
  if (!read('server/notificationPersonaRoutes.ts').toString().includes('../shared/notificationDestination'))
    fail('NOTIFICATION_IMPORT_CHANGED');
  // Runtime state is explicitly allowed and not opened. Unknown files fail closed.
  const stateNames = new Set(['.env','node_modules','uploads','logs','dist','.cache','coverage']);
  const namedState = process.argv.filter(x => x.startsWith('--state-path=')).map(x => x.slice(13));
  for (const n of namedState) {
    if (!safe(n)) fail('UNSAFE_STATE_PATH');
    if ([...names].some(p => p === n.toLowerCase() || p.startsWith(n.toLowerCase()+'/')))
      fail(`STATE_PATH_OVERLAPS_PACKAGE ${n}`);
  }
  function walk(dir='') {
    for (const d of fs.readdirSync(path.join(root, dir), {withFileTypes:true})) {
      const n = dir ? `${dir}/${d.name}` : d.name;
      if ((!dir && stateNames.has(d.name)) || namedState.some(s => n === s || n.startsWith(s+'/')) ||
          /^data\.db(?:-(?:wal|shm|journal))?$/.test(n)) continue;
      if (d.isSymbolicLink()) { fail(`UNEXPECTED_SYMLINK ${n}`); continue; }
      if (d.isDirectory()) walk(n);
      else if (!exactNames.has(n) && !['FILE_SHA256SUMS.txt','INSTALL_RECEIPT.json'].includes(n))
        fail(`UNEXPECTED_FILE ${n}`);
    }
  }
  walk();
  if (process.argv.includes('--runtime')) {
    if (Number(process.versions.node.split('.')[0]) < 20) fail('NODE_VERSION: validated runtime requires Node >=20');
    try {
      const expected = receipt.runtimeLauncher;
      if (!expected || !safe(expected.target) || !safe(expected.packagePath))
        throw new Error('Missing or invalid receipt launcher pin');
      const actual = path.relative(fs.realpathSync(root), fs.realpathSync(path.join(root,'node_modules/.bin/tsx'))).split(path.sep).join('/');
      if (actual !== expected.target) fail(`UNEXPECTED_TSX_TARGET ${actual}`);
      const loader = JSON.parse(read(expected.packagePath));
      const locked = lock.packages[path.posix.dirname(expected.packagePath)];
      if (loader.name !== expected.name || loader.version !== expected.version ||
          locked?.name !== expected.name || locked?.version !== expected.version)
        fail('TSX_PACKAGE_OR_LOCK_MISMATCH');
      if (regular(expected.target) && hash(read(expected.target)) !== expected.targetSha256)
        fail('TSX_LAUNCHER_CHANGED');
      if (regular(expected.packagePath) && hash(read(expected.packagePath)) !== expected.packageSha256)
        fail('TSX_PACKAGE_CHANGED');
      console.log(`RUNTIME node=${process.version} launcher=${actual} package=${loader.name} version=${loader.version}`);
    } catch (e) { fail(`TSX_RUNTIME_CHECK_FAILED ${e.message}; run npm ci --include=dev in this application root`); }
  }
} catch (e) { fail(`VERIFY_EXCEPTION ${e.message}`); }
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`INSTALL_TREE_OK mode=${process.argv.includes('--runtime') ? 'runtime' : 'integrity'} version=26.57.1 checked=${count} cwd=${root}`);
console.log('Integrity only; boot, database, environment and live acceptance remain separate gates.');
