import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { effectiveParts, estimateAudioMs, ttsText, validateRecipe, zoomFit } from '../src/index.js';
import { cursorInitScript, BEACON_STRIP_PX, CURSOR_PX } from '../src/cursor.js';
import type { Recipe } from '../src/types.js';

test('ttsText: narration_tts wins, narration is the default; the estimate uses it', () => {
  assert.equal(ttsText({ narration: 'KPI', narration_tts: ' kej pí áj ' }), 'kej pí áj');
  assert.equal(ttsText({ narration: ' Ahoj ' }), 'Ahoj');
  assert.equal(estimateAudioMs(ttsText({ narration: '', narration_tts: '' })), 0);
});

test('effectiveParts: inherited part, title from the opening step, absent without parts', () => {
  const p = effectiveParts([
    { part: 1, part_title: 'Úvod' }, {}, { part: 2, part_title: 'Nastavení' }, {}, { part: 2 }, { part: 3 },
  ]);
  assert.deepEqual(p, [
    { part: 1, part_title: 'Úvod' }, { part: 1, part_title: 'Úvod' },
    { part: 2, part_title: 'Nastavení' }, { part: 2, part_title: 'Nastavení' }, { part: 2, part_title: 'Nastavení' },
    { part: 3 },
  ]);
  assert.deepEqual(effectiveParts([{}, {}]), [{}, {}]);
});

const base = (actions: any[]): Recipe => ({ id: 'x', version: 1, lang: 'cs', viewport: { width: 1920, height: 1080 }, start: { url: 'http://x' }, steps: [{ id: 's01', narration: '', actions }] });

test('validateRecipe: zoom needs selector and a scale > 1, fill needs a selector, part >= 1', () => {
  assert.doesNotThrow(() => validateRecipe(base([{ type: 'zoom', selector: '#a', value: '1.6', hold_ms: 1000 }, { type: 'fill', selector: '#b', value: 'x' }])));
  assert.doesNotThrow(() => validateRecipe(base([{ type: 'zoom', selector: '#a' }]))); // default 1.6
  assert.throws(() => validateRecipe(base([{ type: 'zoom', value: '1.6' }])), /zoom needs a selector/);
  assert.throws(() => validateRecipe(base([{ type: 'zoom', selector: '#a', value: '0.8' }])), /scale > 1/);
  assert.throws(() => validateRecipe(base([{ type: 'fill', value: 'x' }])), /fill needs a selector/);
  const r = base([]); (r.steps[0] as any).part = 0;
  assert.throws(() => validateRecipe(r), /part must be/);
});

test('zoomFit: scale clamped to fit, origin = centre unless the zoomed element would leave the viewport', () => {
  const vp = { width: 1920, height: 1080 };
  // small element in the middle: centre origin, full scale
  assert.deepEqual(zoomFit(1.6, { x: 900, y: 500, width: 120, height: 40 }, vp), { scale: 1.6, ox: 960, oy: 520 });
  // left-edge nav item: origin pushed left so the zoomed box starts at the 2 % margin
  const nav = zoomFit(1.8, { x: 0, y: 112, width: 240, height: 43 }, vp);
  assert.equal(nav.scale, 1.8);
  const left = nav.ox + 1.8 * (0 - nav.ox);
  assert.ok(Math.abs(left - 1920 * 0.02) < 1, `zoomed left edge ${left}`);
  // full-width card: scale limited to 96 % of the viewport width
  const card = zoomFit(1.6, { x: 280, y: 80, width: 1600, height: 59 }, vp);
  assert.ok(Math.abs(card.scale - (0.96 * 1920) / 1600) < 1e-9);
  // wider than the viewport -> no zoom
  assert.equal(zoomFit(2, { x: 0, y: 0, width: 1920, height: 100 }, vp).scale, 1);
});

const exe = (() => { try { return chromium.executablePath(); } catch { return ''; } })();
test('overlay zoom (browser): cursor stays 28 px on its content point, beacon strip never moves, styles restored', { skip: !exe || !fs.existsSync(exe) }, async () => {
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 800, height: 600 + BEACON_STRIP_PX } });
    await page.addInitScript(cursorInitScript({ beacon: true }));
    await page.goto('data:text/html,' + encodeURIComponent('<body style="margin:0"><div id="t" style="position:absolute;left:300px;top:200px;width:100px;height:40px;background:#3b82f6"></div></body>'));
    await page.evaluate(() => { const c = (window as any).__svpCursor; c.beacon(1); return c.moveTo(340, 215, 0); });
    // string, not a function: tsx would inject __name() helpers that do not exist in the page
    const rects = () => page.evaluate(`(() => {
      function r(id) { const e = document.getElementById(id).getBoundingClientRect(); return [e.left, e.top, e.width, e.height].map(v => Math.round(v * 10) / 10); }
      return { cursor: r('__svp-cursor'), strip: r('__svp-strip'), beacon: r('__svp-beacon'), t: r('t'), html: document.documentElement.getAttribute('style') || '' };
    })()`) as Promise<{ cursor: number[]; strip: number[]; beacon: number[]; t: number[]; html: string }>;
    const before = await rects();
    await page.evaluate(() => (window as any).__svpCursor.zoom(350, 220, 2, 50));
    const z = await rects();
    // target scaled 2x around (350,220)
    assert.deepEqual(z.t, [250, 180, 200, 80]);
    // cursor: normal size, hot spot (tip at +4.67,+2.33 inside the 28 px box) moved to the zoomed content point 350+2*(340-350)=330, 220+2*(215-220)=210
    assert.equal(Math.round(z.cursor[2]), CURSOR_PX);
    const hot = { x: z.cursor[0] + (4 * CURSOR_PX) / 24, y: z.cursor[1] + (2 * CURSOR_PX) / 24 };
    assert.ok(Math.abs(hot.x - 330) < 0.6 && Math.abs(hot.y - 210) < 0.6, `cursor hot spot ${hot.x},${hot.y}`);
    assert.deepEqual(z.strip, before.strip);
    assert.deepEqual(z.beacon, before.beacon);
    await page.evaluate(() => (window as any).__svpCursor.zoom(350, 220, 1, 50));
    const after = await rects();
    assert.deepEqual(after.t, before.t);
    assert.deepEqual(after.cursor, before.cursor);
    assert.deepEqual(after.strip, before.strip);
    assert.equal(after.html, '', `html style restored, got "${after.html}"`);
  } finally { await b.close(); }
});
