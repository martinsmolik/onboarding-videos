import type { Locator, Page } from 'playwright';
import { COLLECT_SCRIPT } from './browser-script.ts';

export interface SnapItem {
  ref: number;
  key: string;
  tag: string;
  role: string | null;
  name: string;
  text: string;
  testid: string | null;
  inViewport: boolean;
  visible: boolean;
  disabled: boolean;
  value?: string;
  placeholder?: string;
  checked?: boolean;
  options?: string[];
  candidates: { sel: string; tier: number }[];
  /** first candidate proven unique AND pointing at this element; null if none */
  selector: string | null;
  /** only the nth-of-type css fallback worked – must not be used in a recipe */
  unstable: boolean;
}

export interface Snapshot {
  gen: number;
  url: string;
  title: string;
  total: number;
  items: SnapItem[];
  text: string;
}

let GEN = 0;

/** Does `sel` resolve to exactly one element, and is that element the one tagged `key`? */
async function provesUnique(page: Page, sel: string, key: string): Promise<boolean> {
  try {
    const loc = page.locator(sel);
    if ((await loc.count()) !== 1) return false;
    const got = await loc.evaluate((el: any) => el.__svpRef, undefined, { timeout: 1000 });
    return got === key;
  } catch {
    return false;
  }
}

async function resolveSelectors(page: Page, raw: Omit<SnapItem, 'selector' | 'unstable'>[]): Promise<SnapItem[]> {
  const out: SnapItem[] = [];
  const CHUNK = 20;
  for (let i = 0; i < raw.length; i += CHUNK) {
    const part = await Promise.all(
      raw.slice(i, i + CHUNK).map(async (it) => {
        for (const c of it.candidates) {
          if (await provesUnique(page, c.sel, it.key)) return { ...it, selector: c.sel, unstable: c.tier >= 9 };
        }
        return { ...it, selector: null, unstable: true };
      }),
    );
    out.push(...part);
  }
  return out;
}

function fmtItem(it: SnapItem): string {
  const parts = [`[${it.ref}]`, it.role ?? it.tag];
  if (it.text) parts.push(JSON.stringify(it.text));
  if (it.testid) parts.push(`testid=${it.testid}`);
  if (it.value !== undefined && it.value !== '') parts.push(`value=${JSON.stringify(it.value.slice(0, 40))}`);
  if (it.placeholder) parts.push(`placeholder=${JSON.stringify(it.placeholder)}`);
  if (it.options) parts.push(`options=${JSON.stringify(it.options)}`);
  if (it.checked !== undefined) parts.push(it.checked ? 'checked' : 'unchecked');
  parts.push(`selector=${it.selector ?? '(none)'}`);
  const flags = [];
  if (it.unstable) flags.push('UNSTABLE');
  if (!it.inViewport) flags.push('offscreen');
  if (!it.visible) flags.push('hidden');
  if (it.disabled) flags.push('disabled');
  if (flags.length) parts.push(`(${flags.join(', ')})`);
  return parts.join(' ');
}

const MAX_CHARS = 14000;

export async function takeSnapshot(page: Page, max = 150): Promise<Snapshot> {
  const gen = ++GEN;
  const res = (await page.evaluate(`(${COLLECT_SCRIPT})(${JSON.stringify({ gen, max, mode: 'snapshot' })})`)) as {
    url: string; title: string; total: number; items: Omit<SnapItem, 'selector' | 'unstable'>[];
  };
  const items = await resolveSelectors(page, res.items);
  const header = [`# snapshot g${gen}`, `URL: ${res.url}`, `Title: ${res.title}`,
    `${items.length} of ${res.total} elements listed (interactive first, viewport first; document order)`];
  const lines: string[] = [];
  let size = header.join('\n').length;
  for (const it of items) {
    const l = fmtItem(it);
    if (size + l.length + 1 > MAX_CHARS) { lines.push(`… truncated (${items.length - lines.length} more)`); break; }
    lines.push(l);
    size += l.length + 1;
  }
  return { gen, url: res.url, title: res.title, total: res.total, items, text: [...header, ...lines].join('\n') };
}

/**
 * For an ambiguous locator: describe each matched element (up to 5) with a unique selector,
 * so the model can pick the one it meant without redoing the step.
 */
export async function describeMatches(page: Page, loc: Locator, limit = 5): Promise<string[]> {
  const gen = ++GEN;
  try {
    await loc.evaluateAll((els: any[], n: number) => { els.slice(0, n).forEach((e) => { e.__svpMark = true; }); }, limit);
    const res = (await page.evaluate(`(${COLLECT_SCRIPT})(${JSON.stringify({ gen, mode: 'marked' })})`)) as {
      items: Omit<SnapItem, 'selector' | 'unstable'>[];
    };
    const items = await resolveSelectors(page, res.items);
    return items.map((it) => fmtItem(it).replace(/^\[\d+\] /, '- '));
  } catch (e) {
    return [`(could not describe matches: ${(e as Error).message.split('\n')[0]})`];
  }
}
