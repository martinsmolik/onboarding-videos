#!/usr/bin/env tsx
import path from 'node:path';
import { run } from './index.js';

function parseArgs(argv: string[]) {
  const o: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { o[key] = next; i++; }
    else o[key] = true;
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.recipe || !args.out) {
  console.log(`usage: pnpm --filter @svp/recorder start -- --recipe <recipe.json> --out out/<id> [--durations out/<id>/audio/durations.json] [--headed] [--strict]`);
  process.exit(args.help ? 0 : 1);
}

// `pnpm --filter` runs with cwd = package dir; resolve relative paths against
// the directory pnpm was invoked from (repo root) so `out/<id>` lands where README says.
const base = process.env.INIT_CWD || process.cwd();
const resolve = (p: string) => path.resolve(base, p);

run({
  recipe: resolve(String(args.recipe)),
  out: resolve(String(args.out)),
  durations: typeof args.durations === 'string' ? resolve(args.durations) : undefined,
  headed: !!args.headed,
  strict: !!args.strict
}).then(() => {
  // Failed steps are reported in timing.json (status: failed) – that is the
  // self-heal signal, not a crash, so the process still exits 0.
  process.exit(0);
}).catch(err => {
  console.error('recorder failed:', err);
  process.exit(1);
});
