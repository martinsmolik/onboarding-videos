import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { concatScript } from '../src/screencast.js';
import { discoverCdp, macProfileDirs, parseDevToolsActivePort, parseLocalStateCdpPort, safeUrl } from '../src/cdp.js';
import { envPlaceholders, formatDate, makeRunId, offsetDate, sanitizeRunId, startDate, substituteRecipe, unknownPlaceholders } from '../src/placeholders.js';
import type { Recipe } from '../src/types.js';

const recipe = (): Recipe => ({
  id: 'x', version: 1, lang: 'en', viewport: { width: 1920, height: 1080 },
  start: { url: 'https://app-pre-production.sloneek.com/{{ENV:TENANT_PATH}}' },
  steps: [
    { id: 's01', narration: 'Type {{RUN_ID}} – narration is left alone', actions: [
      { type: 'type', selector: '[data-test=name]', value: 'Onboarding {{RUN_ID}}' },
      { type: 'type', selector: 'input[name=email]', value: '{{ENV:DEMO_EMAIL}}' }
    ], expect: { visible: 'text=Onboarding {{ RUN_ID }}' } }
  ]
});

test('makeRunId is YYYYMMDDHHmmss (local time)', () => {
  assert.equal(makeRunId(new Date(2026, 9, 1, 9, 5, 7)), '20261001090507');
});

test('substituteRecipe replaces RUN_ID / ENV in replayed fields only and does not mutate input', () => {
  const r = recipe();
  const { recipe: out, replaced } = substituteRecipe(r, '20261001090507', { TENANT_PATH: 'dashboard', DEMO_EMAIL: 'demo@example.com' });
  assert.equal(replaced, 4);
  assert.equal(out.start.url, 'https://app-pre-production.sloneek.com/dashboard');
  assert.equal(out.steps[0].actions[0].value, 'Onboarding 20261001090507');
  assert.equal(out.steps[0].actions[1].value, 'demo@example.com');
  assert.equal(out.steps[0].expect!.visible, 'text=Onboarding 20261001090507');
  assert.equal(out.steps[0].narration, 'Type {{RUN_ID}} – narration is left alone');
  assert.equal(r.steps[0].actions[0].value, 'Onboarding {{RUN_ID}}');
  assert.deepEqual(envPlaceholders(r), ['DEMO_EMAIL', 'TENANT_PATH']);
});

test('substituteRecipe: missing env var -> error naming the variable, never a value', () => {
  assert.throws(() => substituteRecipe(recipe(), '1', { TENANT_PATH: 'secret-value' }), (e: Error) => /DEMO_EMAIL/.test(e.message) && !/secret-value/.test(e.message));
});

test('parseDevToolsActivePort', () => {
  assert.deepEqual(parseDevToolsActivePort('9222\n/devtools/browser/abc-123\n'), { port: 9222, wsPath: '/devtools/browser/abc-123' });
  assert.deepEqual(parseDevToolsActivePort('9110'), { port: 9110, wsPath: undefined });
  assert.equal(parseDevToolsActivePort('nope'), null);
});

test('parseLocalStateCdpPort reads browseros.server.cdp_port', () => {
  assert.equal(parseLocalStateCdpPort(JSON.stringify({ browseros: { server: { cdp_port: 9110, proxy_port: 9010 } } })), 9110);
  assert.equal(parseLocalStateCdpPort('{"browser":{}}'), null);
  assert.equal(parseLocalStateCdpPort('not json'), null);
});

test('macProfileDirs covers BrowserOS neo (BrowserClaw) and BrowserOS', () => {
  const d = macProfileDirs('/Users/m');
  assert.equal(d[0], '/Users/m/Library/Application Support/BrowserClaw');
  assert.ok(d.includes('/Users/m/Library/Application Support/BrowserOS'));
});

test('safeUrl strips query and fragment (tokens never printed)', () => {
  assert.equal(safeUrl('https://app.sloneek.com/x/y?token=abc#frag'), 'https://app.sloneek.com/x/y');
  assert.equal(safeUrl('chrome://newtab/'), 'chrome:newtab/');
});

test('concatScript: durations = next - ts, ms time base, tail held until end', () => {
  const frames = [{ file: '/f/f1.jpg', ts: 100 }, { file: '/f/f2.jpg', ts: 100.5 }, { file: '/f/f3.jpg', ts: 100.5 }, { file: '/f/f4.jpg', ts: 102 }];
  const { text, totalSec, used } = concatScript(frames, 105);
  assert.equal(used, 3); // f2 dropped: same timestamp as f3
  assert.equal(totalSec, 5);
  const lines = text.trim().split('\n');
  assert.equal(lines[0], 'ffconcat version 1.0');
  const durs = lines.filter(l => l.startsWith('duration')).map(l => Number(l.split(' ')[1]));
  const files = lines.filter(l => l.startsWith('file')).map(l => l.slice(6, -1));
  assert.deepEqual(files, ['f1.jpg', 'f3.jpg', 'f4.jpg', 'f4.jpg']);
  assert.ok(lines.filter(l => l === 'option framerate 1000').length === 4);
  const sum = durs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 5) < 1e-6, `sum ${sum}`);
  assert.ok(Math.abs(durs[0] - 0.5) < 1e-6 && Math.abs(durs[1] - 1.5) < 1e-6);
  assert.ok(Math.abs(durs[3] - 1 / 30) < 1e-6); // the repeat starts one output frame before the end
});

test('concatScript: single frame, end before frame -> at least one frame', () => {
  const r = concatScript([{ file: 'a.jpg', ts: 10 }], 9);
  assert.ok(Math.abs(r.totalSec - 1 / 30) < 1e-9);
});

test('discoverCdp: explicit endpoint, env CDP_URL, Local State port, port probe, node inspector rejected', async () => {
  const mk = (body: object) => new Promise<http.Server>(res => {
    const s = http.createServer((req, rsp) => {
      if (req.url?.startsWith('/json/version')) { rsp.setHeader('content-type', 'application/json'); rsp.end(JSON.stringify(body)); }
      else if (req.url?.startsWith('/json/list')) rsp.end(JSON.stringify([{ type: 'page', title: 'Sloneek', url: 'https://app.sloneek.com/a?t=SECRET' }]));
      else { rsp.statusCode = 404; rsp.end(); }
    }).listen(0, '127.0.0.1', () => res(s));
  });
  const browser = await mk({ Browser: 'Chrome/151.0.7922.137', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/x' });
  const node = await mk({ Browser: 'node.js/v22.0.0', 'Protocol-Version': '1.1' });
  const port = (browser.address() as AddressInfo).port;
  const nodePort = (node.address() as AddressInfo).port;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'svp-cdp-'));
  try {
    const a = await discoverCdp(`http://127.0.0.1:${port}`);
    assert.equal(a.found?.endpoint, `http://127.0.0.1:${port}`);
    assert.equal(a.found?.browser, 'Chrome/151.0.7922.137');

    const b = await discoverCdp('auto', { env: { CDP_URL: `http://127.0.0.1:${port}` }, home, ports: [] });
    assert.equal(b.found?.source, 'env CDP_URL');

    const claw = path.join(home, 'Library', 'Application Support', 'BrowserClaw');
    fs.mkdirSync(claw, { recursive: true });
    fs.writeFileSync(path.join(claw, 'Local State'), JSON.stringify({ browseros: { server: { cdp_port: port } } }));
    const c = await discoverCdp('auto', { env: {}, home, ports: [] });
    assert.match(c.found!.source, /BrowserClaw.*cdp_port/);
    fs.rmSync(path.join(claw, 'Local State'));

    const d = await discoverCdp('auto', { env: {}, home, ports: [nodePort, port] });
    assert.equal(d.found?.source, `port probe ${port}`); // node inspector skipped

    const e = await discoverCdp('auto', { env: {}, home, ports: [nodePort] });
    assert.equal(e.found, null);
    assert.ok(e.tried.length >= 1);

    const { listTargets } = await import('../src/cdp.js');
    const t = await listTargets(a.found!);
    assert.deepEqual(t, [{ type: 'page', title: 'Sloneek', url: 'https://app.sloneek.com/a' }]);
  } finally {
    browser.close(); node.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('sanitizeRunId: lowercase [a-z0-9] only', () => {
  assert.equal(sanitizeRunId('Run-2026_10.01X'), 'run20261001x');
  assert.equal(sanitizeRunId(makeRunId()), makeRunId().toLowerCase());
  assert.throws(() => sanitizeRunId('---'), /no \[a-z0-9\]/);
});

test('DAY/DATE placeholders: today+N, weekend -> next Monday, +M calendar days, formats', () => {
  const thu = new Date(2026, 9, 1, 9, 0); // Thu 1 Oct 2026
  assert.equal(startDate(thu, 0).getDate(), 1);
  assert.equal(startDate(thu, 2).getDate(), 5);   // Sat 3 -> Mon 5
  assert.equal(startDate(thu, 3).getDate(), 5);   // Sun 4 -> Mon 5
  assert.equal(startDate(thu, 4).getDate(), 5);   // Mon 5 stays
  assert.equal(offsetDate(thu, 2, 2).getDate(), 7); // Mon 5 + 2 = Wed 7
  assert.equal(formatDate(offsetDate(thu, 25, 2), 'MM/DD/YYYY'), '10/28/2026'); // Mon 26 + 2
  assert.equal(formatDate(new Date(2026, 0, 5), 'D.M.YYYY'), '5.1.2026');
  const r: Recipe = {
    id: 'd', version: 1, lang: 'en', viewport: { width: 10, height: 10 }, start: { url: 'http://x' },
    steps: [{ id: 's01', narration: '', actions: [
      { type: 'click', selector: 'nb-calendar-day-cell:text-is("{{DAY:+25d}}")' },
      { type: 'click', selector: 'nb-calendar-day-cell:text-is("{{ DAY:+25d+2 }}")' }
    ], expect: { visible: 'div:text-is("{{DATE:+25d:MM/DD/YYYY}} - {{DATE:+25d+2:MM/DD/YYYY}}, 3 Days")' } }]
  };
  const { recipe: out, dates, replaced } = substituteRecipe(r, { runId: 'x', today: thu, env: {} });
  assert.equal(replaced, 4);
  assert.equal(out.steps[0].actions[0].selector, 'nb-calendar-day-cell:text-is("26")');
  assert.equal(out.steps[0].actions[1].selector, 'nb-calendar-day-cell:text-is("28")');
  assert.equal(out.steps[0].expect!.visible, 'div:text-is("10/26/2026 - 10/28/2026, 3 Days")');
  assert.ok(dates.every(d => !d.otherMonth));
  // crossing into the next month is flagged
  const late = substituteRecipe(r, { runId: 'x', today: new Date(2026, 9, 20), env: {} });
  assert.ok(late.dates.some(d => d.otherMonth));
});

test('unknown placeholders are an error instead of being typed literally', () => {
  const r: Recipe = { id: 'u', version: 1, lang: 'en', viewport: { width: 1, height: 1 }, start: { url: 'http://x' },
    steps: [{ id: 's01', narration: '', actions: [{ type: 'type', selector: '#a', value: '{{RUNID}} {{DAY:14d}}' }] }] };
  assert.deepEqual(unknownPlaceholders(r), ['{{DAY:14d}}', '{{RUNID}}']);
  assert.throws(() => substituteRecipe(r, 'x', {}), /unknown placeholders/);
});
