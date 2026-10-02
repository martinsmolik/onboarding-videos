#!/usr/bin/env node
// Download the Sloneek brand fonts used by the video cards (Geometria Bold for titles, Inter for text) from the
// sloneek.com theme into ~/.onboarding-videos/brand/fonts (or $BRAND_FONT_DIR). They are not committed: Geometria
// is a licensed web font. Idempotent; never fails the caller (exit 0 with a warning when offline / blocked).
//
//   node scripts/brand-fetch.mjs [--force]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://www.sloneek.com/wp-content/themes/sloneek/static/fonts/';
const FILES = { 'Geometria-Bold.woff2': 'geometria/Geometria-Bold.woff2', 'Inter-Regular.woff2': 'inter/Inter-Regular.woff2', 'Inter-SemiBold.woff2': 'inter/Inter-SemiBold.woff2' };
const dir = process.env.BRAND_FONT_DIR || path.join(process.env.HOME || os.homedir(), '.onboarding-videos', 'brand', 'fonts');
const force = process.argv.includes('--force');
fs.mkdirSync(dir, { recursive: true });

let ok = 0;
for (const [name, rel] of Object.entries(FILES)) {
  const f = path.join(dir, name);
  if (!force && fs.existsSync(f) && fs.statSync(f).size > 1000) { ok++; continue; }
  try {
    const r = await fetch(BASE + rel, { headers: { 'user-agent': 'Mozilla/5.0 (sloneek-video-pipeline brand-fetch)', referer: 'https://www.sloneek.com/' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1000 || buf.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`not a woff2 file (${buf.length} B)`);
    fs.writeFileSync(f + '.tmp', buf);
    fs.renameSync(f + '.tmp', f);
    ok++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ! ${name}: ${e.message}`);
  }
}
const n = Object.keys(FILES).length;
console.log(ok === n ? `  ✓ brand fonts in ${dir}` : `  ! brand fonts ${ok}/${n} in ${dir} – cards fall back to Inter/Helvetica (copy the .woff2 files there by hand to fix)`);
