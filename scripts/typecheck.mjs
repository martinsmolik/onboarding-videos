#!/usr/bin/env node
// tsc --noEmit in every package that has a tsconfig.json
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let failed = [];
for (const d of fs.readdirSync(path.join(root, 'packages')).sort()) {
  const dir = path.join(root, 'packages', d);
  if (!fs.existsSync(path.join(dir, 'tsconfig.json'))) continue;
  console.log(`\n== typecheck ${d}`);
  const r = spawnSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', dir], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) failed.push(d);
}
if (failed.length) { console.error(`\ntypecheck FAILED: ${failed.join(', ')}`); process.exit(1); }
console.log('\ntypecheck OK');
