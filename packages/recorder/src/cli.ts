#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { run } from './index.js';
import { discoverCdp, listTargets } from './cdp.js';

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

const USAGE = `usage: pnpm --filter @svp/recorder start -- --recipe <recipe.json> --out out/<id>
         [--durations out/<id>/audio/durations.json] [--headed] [--strict]
         [--cdp auto|<http://127.0.0.1:9110>|<ws://...>]   attach to a running browser (BrowserOS neo), CDP screencast capture
         [--session-file out/session.json]                 Playwright storageState for a launched Chromium (no CDP)
         [--capture video|screencast]                      launch mode capture (default video = recordVideo + beacon)
         [--run-id <id>]                                   value for {{RUN_ID}} (default YYYYMMDDHHmmss)
         [--keep-frames]                                   keep screencast JPEGs in <out>/.frames
       pnpm --filter @svp/recorder start -- --cdp-check [auto|<endpoint>] [--json]   discovery + list of page targets`;

const args = parseArgs(process.argv.slice(2));

// .env from where pnpm was invoked (repo root) – {{ENV:NAME}} placeholders may live there. Real env wins.
for (const b of new Set([process.env.INIT_CWD, process.cwd(), path.resolve(process.cwd(), '../..')])) {
  const f = b && path.join(b, '.env');
  if (f && fs.existsSync(f)) { try { (process as any).loadEnvFile(f); } catch { /* ignore */ } break; }
}

if (args['cdp-check'] !== undefined) {
  const spec = typeof args['cdp-check'] === 'string' ? args['cdp-check'] : typeof args.cdp === 'string' ? args.cdp : 'auto';
  const { found, tried } = await discoverCdp(spec);
  if (!found) {
    if (args.json) console.log(JSON.stringify({ ok: false, tried }));
    else console.log(`CDP: nothing answered (${spec}). Tried:\n  - ${tried.join('\n  - ')}`);
    process.exit(1);
  }
  const targets = await listTargets(found).catch(() => []);
  const pages = targets.filter(t => t.type === 'page');
  // prove that Playwright itself can attach (protocol compatibility), then just disconnect – no tab is opened
  let playwright: { ok: boolean; contexts?: number; pages?: number; error?: string };
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.connectOverCDP(found.endpoint, { timeout: 10_000 });
    playwright = { ok: true, contexts: b.contexts().length, pages: b.contexts().reduce((n, c) => n + c.pages().length, 0) };
    await b.close(); // connectOverCDP: disconnect only, the browser keeps running
  } catch (e) {
    playwright = { ok: false, error: (e as Error).message.split('\n')[0].slice(0, 300) };
  }
  if (args.json) console.log(JSON.stringify({ ok: playwright.ok, endpoint: found.endpoint, source: found.source, browser: found.browser, userAgent: found.userAgent, pages, playwright, tried }));
  else {
    console.log(`CDP: ${found.endpoint}  via ${found.source}`);
    console.log(`playwright connectOverCDP: ${playwright.ok ? `ok (${playwright.contexts} context(s), ${playwright.pages} page(s))` : `FAILED – ${playwright.error}`}`);
    if (found.browser) console.log(`browser: ${found.browser}${found.userAgent ? `  |  ${found.userAgent}` : ''}`);
    console.log(`page targets (${pages.length}):`);
    for (const t of pages) console.log(`  - ${t.title.slice(0, 60).padEnd(60)}  ${t.url}`);
  }
  process.exit(playwright.ok ? 0 : 1);
}

if (args.help || !args.recipe || !args.out) {
  console.log(USAGE);
  process.exit(args.help ? 0 : 1);
}
const capture = typeof args.capture === 'string' ? args.capture : undefined;
if (capture && capture !== 'video' && capture !== 'screencast') { console.error('--capture must be video|screencast'); process.exit(1); }

// `pnpm --filter` runs with cwd = package dir; resolve relative paths against
// the directory pnpm was invoked from (repo root) so `out/<id>` lands where README says.
const base = process.env.INIT_CWD || process.cwd();
const resolve = (p: string) => path.resolve(base, p);

run({
  recipe: resolve(String(args.recipe)),
  out: resolve(String(args.out)),
  durations: typeof args.durations === 'string' ? resolve(args.durations) : undefined,
  headed: !!args.headed,
  strict: !!args.strict,
  cdp: args.cdp === true ? 'auto' : typeof args.cdp === 'string' ? args.cdp : undefined,
  sessionFile: typeof args['session-file'] === 'string' ? resolve(args['session-file']) : undefined,
  capture: capture as 'video' | 'screencast' | undefined,
  runId: typeof args['run-id'] === 'string' ? args['run-id'] : undefined,
  keepFrames: !!args['keep-frames']
}).then(() => {
  // Failed steps are reported in timing.json (status: failed) – that is the
  // self-heal signal, not a crash, so the process still exits 0.
  process.exit(0);
}).catch(err => {
  console.error('recorder failed:', err);
  process.exit(1);
});
