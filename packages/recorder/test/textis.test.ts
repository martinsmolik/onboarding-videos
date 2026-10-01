import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { splitTextIs, exactTextRegex, recipeLocator } from '../src/index.js';

test('splitTextIs parses trailing :text-is', () => {
  assert.deepEqual(splitTextIs('p.a:text-is("Zobraz překlad")'), { css: 'p.a', text: 'Zobraz překlad' });
  assert.deepEqual(splitTextIs('a[href="/x"]'), { css: 'a[href="/x"]', text: null });
  assert.deepEqual(splitTextIs('b:text-is("say \\"hi\\"")'), { css: 'b', text: 'say "hi"' });
});

test('exactTextRegex is exact and whitespace tolerant', () => {
  const r = exactTextRegex('Volno (krátí odpracovanou dobu)');
  assert.ok(r.test('  Volno  (krátí odpracovanou\ndobu) '));
  assert.ok(!r.test('Volno (krátí odpracovanou dobu) x'));
});

test('recipeLocator matches whole element text like explorer resolve.js', async () => {
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    await p.setContent(`<p class="cp"><span> Zobraz překlad </span><i></i></p>
      <div class="o"><span>Nová</span> <b>Kristýna</b></div><div class="o">Nová Kristýna X</div>
      <nb-calendar-year-cell><div class="cell-content">2026</div></nb-calendar-year-cell>`);
    assert.equal(await p.locator('p.cp:text-is("Zobraz překlad")').count(), 0, 'Playwright native semantics (why we translate)');
    assert.equal(await recipeLocator(p, 'p.cp:text-is("Zobraz překlad")').count(), 1);
    assert.equal(await recipeLocator(p, '.o:text-is("Nová Kristýna")').textContent(), 'Nová Kristýna');
    assert.equal(await recipeLocator(p, 'nb-calendar-year-cell:text-is("2026")').count(), 1);
  } finally { await b.close(); }
});
