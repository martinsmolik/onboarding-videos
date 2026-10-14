#!/usr/bin/env node
// Stav videí téma × jazyk z out/ (bez modelu, bez tokenů).
// Použití v kořeni repa:  node scripts/video-status.mjs > docs/dev/VIDEO-STATUS.md
// Hotové = out/<id>/final.mp4. Jazyk z recipe.json (lang), jinak z přípony id, jinak cs.
// rehearse-*, smoke a rzd-* se nepočítají.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'out');
const LANGS = ['cs', 'en', 'pl'];
const EXTRA = ['goals', 'custom-reports', 'integrations']; // témata z Notionu, která nejsou ve videos.csv
const ALIAS = { absence: 'absences' };
const SKIP = /^(rehearse-|smoke$|rzd-)/;

const topics = [];
const add = (t) => { if (!topics.includes(t)) topics.push(t); };
const csv = fs.existsSync(path.join(root, 'videos.csv')) ? fs.readFileSync(path.join(root, 'videos.csv'), 'utf8') : '';
for (const line of csv.split(/\r?\n/).slice(1)) { const id = line.split(',')[0]?.trim(); if (id) add(id.replace(/-(cs|en|pl|sk)$/, '')); }
EXTRA.forEach(add);

const done = {}; let rehearsals = 0;
for (const dir of fs.existsSync(outDir) ? fs.readdirSync(outDir) : []) {
  if (!fs.existsSync(path.join(outDir, dir, 'final.mp4'))) continue;
  if (SKIP.test(dir)) { if (dir.startsWith('rehearse-')) rehearsals++; continue; }
  let lang = null;
  try { lang = JSON.parse(fs.readFileSync(path.join(outDir, dir, 'recipe.json'), 'utf8')).lang ?? null; } catch {}
  const m = dir.match(/^(.*?)-(cs|en|pl)$/);
  lang = lang || (m ? m[2] : 'cs');
  let topic = m ? m[1] : dir;
  topic = ALIAS[topic] || topic;
  add(topic);
  (done[topic] ||= {})[lang] = dir;
}

const has = (t, l) => Boolean(done[t]?.[l]);
const reuse = [], full = [];
for (const t of topics) {
  if (has(t, 'cs')) { for (const l of ['en', 'pl']) if (!has(t, l)) reuse.push(`${t}-${l}`); }
  else full.push(t);
}
const total = topics.length * LANGS.length;
const ok = topics.reduce((n, t) => n + LANGS.filter((l) => has(t, l)).length, 0);

console.log(`# Stav videí\n\nVygenerováno ${new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })} skriptem \`scripts/video-status.mjs\` z \`out/\`. Ručně neupravovat.\n`);
console.log(`Hotovo **${ok} z ${total}** (${topics.length} témat × cs/en/pl). Zkušebních běhů \`rehearse-*\`: ${rehearsals}.\n`);
console.log('| téma | cs | en | pl |\n|---|---|---|---|');
for (const t of topics) console.log(`| ${t} | ${LANGS.map((l) => (has(t, l) ? '✓' : '·')).join(' | ')} |`);
console.log(`\n## Jazykové verze převzetím českého receptu (${reuse.length})\n`);
console.log(reuse.length ? reuse.map((x) => `- ${x}`).join('\n') : '- nic');
console.log(`\n## Témata bez češtiny, nejdřív plná výroba cs (${full.length})\n`);
console.log(full.length ? full.map((x) => `- ${x}`).join('\n') : '- nic');
