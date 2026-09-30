#!/usr/bin/env tsx
// pnpm --filter @svp/explorer start -- --scenario <path> --out out/<id> [--heal <timing.json>] [--headed] [--dry-run [fixture]] [--start-url <url>]
import { run } from './index.ts';

function parse(argv: string[]) {
  const a = argv.filter((x) => x !== '--');
  const o: Record<string, string | boolean> = {};
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const name = k.slice(2);
    const next = a[i + 1];
    if (next !== undefined && !next.startsWith('--')) { o[name] = next; i++; } else o[name] = true;
  }
  return o;
}

const o = parse(process.argv.slice(2));
if (o.help || (!o.scenario && !o.heal)) {
  console.error('usage: explorer --scenario <scenario.json> --out out/<id> [--heal out/<id>/timing.json] [--headed] [--dry-run [fixture.json]] [--start-url <url>]');
  process.exit(o.help ? 0 : 2);
}
run({
  scenario: o.scenario as string | undefined,
  out: o.out as string | undefined,
  heal: o.heal as string | undefined,
  headed: !!o.headed,
  dryRun: o['dry-run'] as boolean | string | undefined,
  startUrl: o['start-url'] as string | undefined,
}).then(
  (r) => { console.log(r.recipePath); },
  (e) => { console.error(`[explorer] FAILED: ${(e as Error).message}`); process.exit(1); },
);
