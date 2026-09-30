// Deterministic (LLM-free) replay + validation. Mirrors what the recorder will do,
// but checks every selector for uniqueness *in the state right before the action*.
import type { Browser, BrowserContext, Page } from 'playwright';
import { describeMatches } from './snapshot.ts';
import { policyViolations } from './policy.ts';
import type { Action, Expect } from './types.ts';

export interface StartState {
  url: string;
  storageState?: string;
  viewport: { width: number; height: number };
}

export interface Session { context: BrowserContext; page: Page }

export async function openFresh(browser: Browser, start: StartState): Promise<Session> {
  const context = await browser.newContext({
    viewport: start.viewport,
    storageState: start.storageState,
    locale: 'cs-CZ',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(start.url, { waitUntil: 'load' });
  await settle(page);
  return { context, page };
}

export async function settle(page: Page, ms = 250): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/** Replace {{ENV_NAME}} placeholders (credentials never reach the LLM or the recipe). */
export function substituteEnv(v: string | undefined): string | undefined {
  if (v === undefined) return v;
  return v.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => process.env[k] ?? '');
}

export class ValidationError extends Error {
  constructor(public index: number, public detail: string) { super(detail); }
}

const NEEDS_SELECTOR = new Set(['click', 'hover', 'type', 'select', 'highlight']);

/** Wait until selector resolves to exactly one element; returns final count. */
export async function waitUnique(page: Page, selector: string, timeout = 5000): Promise<number> {
  const t0 = Date.now();
  let n = -1;
  while (true) {
    try { n = await page.locator(selector).count(); } catch (e) { throw new Error(`invalid selector: ${(e as Error).message.split('\n')[0]}`); }
    if (n === 1 || Date.now() - t0 > timeout) return n;
    await page.waitForTimeout(150);
  }
}

/** Execute one recipe action exactly as the recorder would (minus pacing). */
export async function perform(page: Page, a: Action): Promise<void> {
  const sel = a.selector ? page.locator(a.selector) : null;
  switch (a.type) {
    case 'navigate': await page.goto(a.value!, { waitUntil: 'load' }); break;
    case 'click': await sel!.click(); break;
    case 'hover': case 'highlight': await sel!.hover(); break;
    case 'type':
      if (a.clear) await sel!.fill('');
      await sel!.pressSequentially(substituteEnv(a.value) ?? '');
      break;
    case 'select': {
      const v = a.value ?? '';
      try { await sel!.selectOption({ label: v }, { timeout: 3000 }); }
      catch { await sel!.selectOption(v); }
      break;
    }
    case 'press':
      if (sel) await sel.press(a.value!); else await page.keyboard.press(a.value!);
      break;
    case 'scroll':
      if (a.value === 'down' || a.value === 'up' || !a.value) await page.mouse.wheel(0, a.value === 'up' ? -600 : 600);
      else await page.locator(a.value).scrollIntoViewIfNeeded();
      break;
    case 'wait': await page.waitForTimeout(Number(a.value ?? 500)); break;
    default: throw new Error(`unknown action type ${(a as Action).type}`);
  }
  await settle(page, 150);
}

/**
 * Validate + perform a list of actions in the given page. Throws ValidationError describing
 * exactly what is wrong (ambiguous / missing / policy) so the model can refine.
 */
export async function validateActions(page: Page, actions: Action[]): Promise<void> {
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const label = `action #${i + 1} ${JSON.stringify(a)}`;
    if (NEEDS_SELECTOR.has(a.type) && !a.selector) throw new ValidationError(i, `${label}: missing selector`);
    const sels = [a.selector, a.type === 'scroll' && a.value && !['up', 'down'].includes(a.value) ? a.value : undefined].filter(Boolean) as string[];
    for (const s of sels) {
      const v = policyViolations(s);
      if (v.length) throw new ValidationError(i, `${label}: selector violates policy: ${v.join('; ')}`);
      let n: number;
      try { n = await waitUnique(page, s); } catch (e) { throw new ValidationError(i, `${label}: ${(e as Error).message}`); }
      if (n === 0) throw new ValidationError(i, `${label}: selector matches NO element in the state before this action`);
      if (n > 1) {
        const m = await describeMatches(page, page.locator(s));
        throw new ValidationError(i, `${label}: selector is AMBIGUOUS – matches ${n} elements in the state before this action (must be exactly 1). Matches:\n${m.join('\n')}`);
      }
    }
    try { await perform(page, a); }
    catch (e) { throw new ValidationError(i, `${label}: failed to perform: ${(e as Error).message.split('\n')[0]}`); }
  }
}

export async function checkExpect(page: Page, expect: Expect | undefined): Promise<void> {
  if (!expect) return;
  if (expect.visible) {
    const v = policyViolations(expect.visible);
    if (v.length) throw new ValidationError(-1, `expect.visible violates policy: ${v.join('; ')}`);
    const n = await waitUnique(page, expect.visible);
    if (n !== 1) {
      const extra = n > 1 ? `\n${(await describeMatches(page, page.locator(expect.visible))).join('\n')}` : '';
      throw new ValidationError(-1, `expect.visible ${expect.visible} matches ${n} elements after the actions (must be exactly 1)${extra}`);
    }
    try { await page.locator(expect.visible).waitFor({ state: 'visible', timeout: 5000 }); }
    catch { throw new ValidationError(-1, `expect.visible ${expect.visible} exists but is not visible after the actions`); }
  }
  if (expect.url_contains && !page.url().includes(expect.url_contains)) {
    throw new ValidationError(-1, `expect.url_contains "${expect.url_contains}" not in ${page.url()}`);
  }
}
