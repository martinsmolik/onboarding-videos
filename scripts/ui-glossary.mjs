#!/usr/bin/env node
// UI glosář cs → en → pl z hotových receptů. Bez modelu, jen čte out/*/recipe.json.
// Použití (v kořeni repa):  node ui-glossary.mjs out > docs/ui-glossary.md
// Páruje texty prvků podle "kostry" selektoru: text tlačítka/odkazu se nahradí ◊ a zbytek
// (data-cy, href, id, role) musí sedět ve všech jazycích. Co spárovat nejde, vypíše zvlášť.
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || 'out';
const LANGS = ['cs', 'en', 'pl'];
const SKIP = /^(rehearse-|smoke|rzd-)/;
// texty uvnitř selektorů: :text-is("X"), :has-text("X"), text="X", [name="X"], hasText
const LABEL = /(:text-is\(|:has-text\(|^text=|\[name=)(["'])((?:\\.|(?!\2).)*)\2/g;

const topics = new Map(); // topic -> lang -> [{skeleton, labels[]}]
for (const dir of fs.readdirSync(outDir)) {
  if (SKIP.test(dir)) continue;
  const f = path.join(outDir, dir, 'recipe.json');
  if (!fs.existsSync(f)) continue;
  let r; try { r = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  const m = dir.match(/^(.*?)-(cs|en|pl)$/);
  const lang = r.lang || (m ? m[2] : 'cs');
  const topic = m ? m[1] : dir;
  if (!LANGS.includes(lang)) continue;
  const items = [];
  for (const s of r.steps || []) {
    const seen = {};
    for (const a of s.actions || []) {
      const sel = a.selector;
      if (!sel) continue;
      const labels = [...sel.matchAll(LABEL)].map((x) => x[3]);
      if (!labels.length) continue;
      const skeleton = sel.replace(LABEL, (_, p, q) => `${p}${q}◊${q}`);
      // klíč: krok + kostra + pořadí v kroku, aby se stejné kostry (h3:text-is) nepletly
      const n = (seen[skeleton] = (seen[skeleton] || 0) + 1);
      items.push({ key: `${s.id}|${skeleton}|${n}`, skeleton, labels });
    }
  }
  if (!topics.has(topic)) topics.set(topic, {});
  topics.get(topic)[lang] = items;
}

const rows = new Map(); // cs label -> {en:Set, pl:Set, topics:Set}
const unmatched = [];
for (const [topic, byLang] of topics) {
  if (!byLang.cs) continue;
  for (const it of byLang.cs) {
    // kostra jen z textu (text="◊") se mezi jazyky spárovat nedá – nic jiného ji neidentifikuje
    if (/^text=(["'])◊\1$/.test(it.skeleton)) { unmatched.push(`${topic}: ${it.labels.join(' / ')}`); continue; }
    it.labels.forEach((cs, i) => {
      const row = rows.get(cs) || { en: new Set(), pl: new Set(), topics: new Set() };
      for (const l of ['en', 'pl']) {
        const hit = (byLang[l] || []).find((x) => x.key === it.key);
        if (hit && hit.labels[i] !== undefined) row[l].add(hit.labels[i]);
      }
      row.topics.add(topic);
      rows.set(cs, row);
    });
  }
}

const cell = (s) => (s.size ? [...s].join(' / ') : '?');
console.log('# UI glosář cs → en → pl\n');
console.log('Vytaženo z hotových receptů (`out/*/recipe.json`). `?` = v tom jazyce zatím není spárované, ověřit v aplikaci.\n');
const sorted = [...rows].sort((a, b) => a[0].localeCompare(b[0], 'cs'));
const same = (cs, r) => r.en.size === 1 && r.pl.size === 1 && r.en.has(cs) && r.pl.has(cs);
console.log('| cs | en | pl | témata |\n|---|---|---|---|');
for (const [cs, r] of sorted.filter(([cs, r]) => !same(cs, r))) {
  console.log(`| ${cs} | ${cell(r.en)} | ${cell(r.pl)} | ${[...r.topics].join(', ')} |`);
}
const sameRows = sorted.filter(([cs, r]) => same(cs, r)).map(([cs]) => cs);
if (sameRows.length) console.log(`\n## Stejné ve všech jazycích (data, jména, čísla)\n\n${sameRows.join(' · ')}`);
if (unmatched.length) {
  console.log('\n## Nespárované (selektor jen podle textu)\n');
  for (const u of [...new Set(unmatched)]) console.log(`- ${u}`);
}
const pairs = [...rows.values()];
console.error(`témat: ${topics.size}, českých názvů: ${rows.size}, s en: ${pairs.filter((r) => r.en.size).length}, s pl: ${pairs.filter((r) => r.pl.size).length}, nespárovaných: ${new Set(unmatched).size}`);
