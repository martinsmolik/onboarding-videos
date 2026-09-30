#!/usr/bin/env node
// Runs each package's `test` script in sequence; stops at the first failure.
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
for (const d of fs.readdirSync(path.join(root, 'packages')).sort()) {
  const pj = path.join(root, 'packages', d, 'package.json');
  if (!fs.existsSync(pj)) continue;
  const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
  if (!pkg.scripts?.test) { console.log(`-- ${d}: no test script, skipping`); continue; }
  console.log(`\n== test ${d}`);
  const r = spawnSync('pnpm', ['--filter', pkg.name, 'run', 'test'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\ntest FAILED in ${d}`); process.exit(r.status || 1); }
}
console.log('\nall tests OK');
