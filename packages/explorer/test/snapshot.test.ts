// Unit tests: snapshot -> selector derivation against demo-app, policy, replay validation,
// and an end-to-end dry run (scripted model) compared with samples/recipe.absence-request.json.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { takeSnapshot } from '../src/snapshot.ts';
import { policyViolations } from '../src/policy.ts';
import { validateActions, ValidationError } from '../src/replay.ts';
import { run } from '../src/index.ts';

// preinstalled browsers on some cloud boxes; otherwise Playwright's default cache (pnpm setup / cloud-setup.sh)
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const DEMO = pathToFileURL(path.join(ROOT, 'demo-app/index.html')).href;
let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
});
after(async () => { await browser.close(); });

const STATES: [string, (p: Page) => Promise<void>][] = [
  ['dashboard', async () => {}],
  ['attendance', async (p) => { await p.click('[data-testid=nav-attendance]'); }],
  ['absences', async (p) => { await p.click('[data-testid=nav-absences]'); }],
  ['absence form open', async (p) => { await p.click('[data-testid=nav-absences]'); await p.click('[data-testid=btn-new-absence]'); }],
  ['after submit (toast)', async (p) => {
    await p.click('[data-testid=nav-absences]'); await p.click('[data-testid=btn-new-absence]'); await p.click('[data-testid=absence-submit]');
  }],
  ['people', async (p) => { await p.click('[data-testid=nav-people]'); }],
  ['settings', async (p) => { await p.click('[data-testid=nav-settings]'); }],
];

for (const [name, reach] of STATES) {
  test(`snapshot selectors are unique and point at the right element – ${name}`, async () => {
    await page.goto(DEMO);
    await reach(page);
    const snap = await takeSnapshot(page);
    assert.ok(snap.items.length > 0);
    const visibleTestids: string[] = await page.$$eval('[data-testid]', (els) =>
      els.filter((e) => (e as HTMLElement).checkVisibility()).map((e) => e.getAttribute('data-testid')!));
    for (const t of visibleTestids) {
      const it = snap.items.find((i) => i.testid === t);
      assert.ok(it, `testid ${t} missing from snapshot`);
      assert.equal(it!.selector, `[data-testid=${t}]`, `testid ${t} should win selector priority`);
    }
    for (const it of snap.items) {
      assert.ok(it.selector, `[${it.ref}] ${it.text} has no selector`);
      const loc = page.locator(it.selector!);
      assert.equal(await loc.count(), 1, `${it.selector} must match exactly 1`);
      assert.equal(await loc.evaluate((el: any) => el.__svpRef), it.key, `${it.selector} must resolve to [${it.ref}] itself`);
      const interactive = ['a', 'button', 'input', 'select', 'textarea'].includes(it.tag);
      if (interactive) {
        assert.equal(it.unstable, false, `interactive ${it.tag} "${it.text}" must get a stable selector`);
        assert.deepEqual(policyViolations(it.selector!), [], `${it.selector} must satisfy policy`);
      }
    }
  });
}

test('policy rejects positional / generated selectors, accepts stable ones', () => {
  for (const bad of ['css=main > section:nth-of-type(3) input', 'div:nth-child(2)', '.css-1x2y3z', '.sc-abcdef', 'xpath=//div', '.btn_ab12c', 'role=button >> nth=1'])
    assert.ok(policyViolations(bad).length > 0, `should reject ${bad}`);
  for (const ok of ['[data-testid=nav-absences]', 'role=button[name="Uložit 2."s]', 'text="1. 10. 2026"', '[data-testid=absence-form] >> role=button[name="Odeslat"s]', '[data-testid=v1.2]'])
    assert.deepEqual(policyViolations(ok), [], `should accept ${ok}`);
});

test('validation flags ambiguous selectors (hidden duplicates count) and accepts testids', async () => {
  await page.goto(DEMO);
  await assert.rejects(validateActions(page, [{ type: 'click', selector: 'text="Absence"' }]),
    (e: unknown) => e instanceof ValidationError && /AMBIGUOUS – matches 2/.test(e.message) && /data-testid=nav-absences/.test(e.message));
  await validateActions(page, [{ type: 'click', selector: '[data-testid=nav-absences]' }]);
  assert.ok(await page.locator('[data-testid=page-absences]').isVisible());
  await assert.rejects(validateActions(page, [{ type: 'click', selector: '[data-testid=does-not-exist]' }]), /matches NO element/);
});

test('dry run end-to-end reproduces the hand-written sample recipe selectors', { timeout: 120_000 }, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-'));
  const r = await run({
    scenario: path.join(ROOT, 'samples/scenario.absence-request.json'),
    out, dryRun: true, startUrl: DEMO, log: () => {},
  });
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples/recipe.absence-request.json'), 'utf8'));
  assert.equal(r.recipe.steps.length, sample.steps.length);
  r.recipe.steps.forEach((s, i) => {
    assert.equal(s.id, sample.steps[i].id);
    assert.equal(s.narration, sample.steps[i].narration);
    assert.deepEqual(s.actions, sample.steps[i].actions, `actions of ${s.id}`);
    if (sample.steps[i].expect) assert.deepEqual(s.expect, sample.steps[i].expect, `expect of ${s.id}`);
  });
  assert.deepEqual(r.recipe.viewport, { width: 1920, height: 1080 });
  assert.match(r.recipe.app_version!, /^\d{4}-\d{2}-\d{2}$/);
  fs.rmSync(out, { recursive: true, force: true });
});
