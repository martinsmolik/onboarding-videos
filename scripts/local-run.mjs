#!/usr/bin/env node
// One-command local run on Martin's Mac: tts -> record (attached to BrowserOS neo over CDP) -> mux.
//
//   pnpm local:check [recipe] [--id <id>] [--cdp auto|url] [--session-file f]     pre-flight only
//   pnpm local <recipe> [--id <id>] [--cdp auto|url] [--session-file f] [--no-intro]
//                       [--intro-image thumb.png] [--outro-image end.png] [--no-interstitials] [--no-chapters]
//                       [--provider external|elevenlabs|say|espeak|mock] [--run-id X] [--subtitles burn|sidecar|none] [--no-open]
//                       [--card-style brand|classic] [--no-thumbnail] [--lufs -16|0]
//   pnpm local <recipe> --id <id> --mux-only [...]   re-mux an existing recording (no tts, no record):
//                       needs out/<id>/raw.mp4 (timing.video_path) + timing.json + audio/durations.json
//
// ffmpeg: env FFMPEG_PATH / FFPROBE_PATH > Homebrew ffmpeg-full keg (/opt/homebrew/opt/ffmpeg-full/bin) > PATH.
// Brand cards (default style) are HTML rendered to PNG in a temporary tab of the browser found over CDP (or a local
// Chromium/Chrome); fonts come from ~/.onboarding-videos/brand/fonts (scripts/brand-fetch.mjs). Without any browser
// the classic drawtext cards are used when ffmpeg has drawtext, else cards are skipped – see the pre-flight line.
//
// No LLM here – recipes and voiceovers are produced interactively with Claude; this script only replays.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userCwd = process.env.INIT_CWD || process.cwd();
const isMac = process.platform === 'darwin';

// ---------------------------------------------------------------- args
const BOOL = ['no-intro', 'no-open', 'check', 'help', 'no-interstitials', 'no-chapters', 'mux-only', 'no-thumbnail'];
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    const nxt = argv[i + 1];
    if (nxt !== undefined && !nxt.startsWith('--') && !BOOL.includes(k)) { o[k] = nxt; i++; }
    else o[k] = true;
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
const checkOnly = !!args.check;
const muxOnly = !!args['mux-only'];
if (args.help) {
  console.log(`usage:
  pnpm local:check [recipe.json] [--id <id>] [--cdp auto|http://127.0.0.1:9110] [--session-file out/session.json]
  pnpm local <recipe.json> [--id <id>] [--cdp auto|<url>] [--session-file <file>] [--no-intro]
             [--intro-image <png> [--intro-sec 3]] [--outro-image <png> [--outro-sec 3]] [--no-interstitials] [--no-chapters]
             [--provider external|elevenlabs|say|espeak|mock] [--run-id <id>] [--subtitles burn|sidecar|none] [--no-open]
  pnpm local <recipe.json> --id <id> --mux-only [same mux flags]   re-mux out/<id>/ (skips tts + record)
  pnpm voice:manifest <recipe.json> [--id <id>]     to-do list for the voiceover (provider external)`);
  process.exit(0);
}

// .env from the repo root (real environment wins)
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) { try { process.loadEnvFile(envFile); } catch { /* ignore */ } }

const resolveUser = (p) => path.resolve(userCwd, p);
const recipeArg = args._[0];
const sessionFile = typeof args['session-file'] === 'string' ? resolveUser(args['session-file']) : null;
// --session-file alone = launched Playwright Chromium; otherwise attach over CDP (default auto)
const cdpSpec = sessionFile && args.cdp === undefined ? null : (typeof args.cdp === 'string' ? args.cdp : 'auto');
const outRoot = path.resolve(process.env.SVP_OUT_DIR || path.join(root, 'out'));
const forcedProvider = typeof args.provider === 'string' ? args.provider : null;

// ---------------------------------------------------------------- pre-flight helpers
const results = [];
const ok = (m) => { results.push(['ok', m]); console.log(`  ✓ ${m}`); };
const warn = (m) => { results.push(['warn', m]); console.log(`  ! ${m}`); };
const bad = (m) => { results.push(['bad', m]); console.log(`  ✗ ${m}`); };
const info = (m) => console.log(`      ${m}`);
const has = (bin, a = ['-version']) => spawnSync(bin, a, { stdio: 'ignore' }).status === 0;
const req = createRequire(path.join(root, 'package.json'));

// Placeholders – mirrors packages/recorder/src/placeholders.ts (duplicated on purpose: scripts do not import package code)
const PH = /\{\{\s*(RUN_ID|ENV:([A-Za-z_][A-Za-z0-9_]*)|DAY:\+(\d{1,3})d(?:\+(\d{1,3}))?|DATE:\+(\d{1,3})d(?:\+(\d{1,3}))?:([^{}]+?))\s*\}\}/;
const startDate = (today, n) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, 12); const w = d.getDay(); if (w === 6) d.setDate(d.getDate() + 2); else if (w === 0) d.setDate(d.getDate() + 1); return d; };
const fmtDate = (d, f) => f.replace(/YYYY|MM|DD|M|D/g, (t) => t === 'YYYY' ? String(d.getFullYear()) : t === 'MM' ? String(d.getMonth() + 1).padStart(2, '0') : t === 'M' ? String(d.getMonth() + 1) : t === 'DD' ? String(d.getDate()).padStart(2, '0') : String(d.getDate()));
function recipeStrings(r) {
  const out = [r.start?.url];
  for (const st of r.steps ?? []) { for (const a of st.actions ?? []) out.push(a.value, a.selector); out.push(st.expect?.visible, st.expect?.url_contains); }
  return out.filter((s) => typeof s === 'string');
}

console.log('== pre-flight');
const major = Number(process.versions.node.split('.')[0]);
major >= 22 ? ok(`node ${process.version}`) : bad(`node ${process.version} – need >= 22 (brew install node@22)`);
// same resolution as packages/assembler/src/util.ts ffmpegBin/ffprobeBin (duplicated on purpose)
const isExe = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } };
const FULL_KEGS = ['/opt/homebrew/opt/ffmpeg-full/bin', '/usr/local/opt/ffmpeg-full/bin', '/home/linuxbrew/.linuxbrew/opt/ffmpeg-full/bin'];
const kegFfmpeg = FULL_KEGS.map((d) => path.join(d, 'ffmpeg')).find(isExe);
const ffmpegBin = process.env.FFMPEG_PATH || kegFfmpeg || 'ffmpeg';
const ffprobeBin = process.env.FFPROBE_PATH || (ffmpegBin !== 'ffmpeg' && isExe(path.join(path.dirname(ffmpegBin), 'ffprobe')) ? path.join(path.dirname(ffmpegBin), 'ffprobe') : 'ffprobe');
const ffSrc = process.env.FFMPEG_PATH ? 'env FFMPEG_PATH' : kegFfmpeg ? 'Homebrew ffmpeg-full keg' : 'PATH';
has(ffmpegBin) && has(ffprobeBin) ? ok(`ffmpeg + ffprobe (${ffmpegBin === 'ffmpeg' ? 'from PATH' : `${ffmpegBin}, ${ffSrc}`})`) : bad(`ffmpeg/ffprobe missing (${ffmpegBin} / ${ffprobeBin}) – ${isMac ? 'brew install ffmpeg' : 'apt install ffmpeg'}`);
if (ffmpegBin !== 'ffmpeg' && !has('ffmpeg')) (muxOnly ? warn : bad)('the recorder runs `ffmpeg` from PATH – keep Homebrew `ffmpeg` installed or `brew link --overwrite ffmpeg-full`');

let playwright = null;
try {
  const preq = createRequire(path.join(root, 'packages/recorder/package.json'));
  const pwPath = preq.resolve('playwright');
  playwright = await import(pwPath);
  ok(`playwright package (${JSON.parse(fs.readFileSync(path.join(path.dirname(pwPath), 'package.json'), 'utf8')).version})`);
} catch {
  bad('playwright package not installed – run `pnpm i` in the repo root');
}

// ---------------------------------------------------------------- browser: CDP or session file
let cdpFound = null; // endpoint the recorder's discovery found – also handed to mux for PNG cards
const cdpBad = muxOnly ? warn : bad; // --mux-only records nothing: a missing browser only matters for PNG cards
if (cdpSpec) {
  if (!muxOnly) ok('CDP mode: Playwright\'s own Chromium is NOT needed (recording happens in a new tab of your running browser)');
  const r = spawnSync('pnpm', ['-s', '--filter', '@svp/recorder', 'start', '--', '--cdp-check', cdpSpec, '--json'], { cwd: root, encoding: 'utf8', env: process.env });
  let j = null;
  try { j = JSON.parse((r.stdout || '').trim().split('\n').filter(Boolean).pop() || 'null'); } catch { /* ignore */ }
  if (j?.ok) cdpFound = j.endpoint;
  if (j?.endpoint && !j.ok) {
    cdpBad(`CDP endpoint ${j.endpoint} answers, but Playwright cannot attach: ${j.playwright?.error ?? '?'}`);
  } else if (j?.ok) {
    ok(`CDP reachable: ${j.endpoint}  (found via ${j.source}); Playwright attach ok (${j.playwright.contexts} context(s))`);
    if (j.browser) info(`browser: ${j.browser}`);
    if (j.userAgent) info(`user-agent: ${j.userAgent}`);
    info(`open tabs (${j.pages.length}) – the recorder opens its own new tab and never touches these:`);
    for (const p of j.pages.slice(0, 15)) info(`  · ${String(p.title).slice(0, 50).padEnd(50)}  ${p.url}`);
    if (j.pages.length > 15) info(`  · … ${j.pages.length - 15} more`);
  } else {
    cdpBad(`CDP not reachable (${cdpSpec}).${j?.tried ? ' Tried: ' + j.tried.join(' | ') : ' ' + ((r.stderr || '').trim().split('\n').pop() || '')}`);
    info('BrowserOS neo serves CDP on 127.0.0.1:9110 while it runs (no flag needed). Is "BrowserOS neo" open?');
    info('Check: curl -s http://127.0.0.1:9110/json/version   ·   or pass --cdp http://127.0.0.1:<port>   ·   or use --session-file');
  }
}
if (sessionFile) {
  if (!fs.existsSync(sessionFile)) bad(`session file ${sessionFile} not found – see scripts/grab-session.md`);
  else {
    try {
      const s = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      const origins = Array.isArray(s.origins) ? s.origins : [];
      const keys = origins.reduce((n, o) => n + (Array.isArray(o.localStorage) ? o.localStorage.length : 0), 0);
      // counts and origins only – never key values (auth tokens)
      keys || (s.cookies || []).length ? ok(`session file: ${origins.length} origin(s) [${origins.map((o) => o.origin).join(', ')}], ${keys} localStorage key(s)`) : bad('session file has no localStorage keys / cookies');
    } catch { bad(`session file ${sessionFile} is not valid JSON`); }
  }
  if (cdpSpec) warn('--session-file is ignored together with --cdp (the attached browser has its own login)');
  else {
    let exe = null;
    try { exe = (playwright?.chromium ?? playwright?.default?.chromium)?.executablePath(); } catch { /* ignore */ }
    exe && fs.existsSync(exe) ? ok('Playwright Chromium installed (needed for --session-file mode)') : bad('Playwright Chromium missing – pnpm --filter @svp/recorder exec playwright install chromium');
  }
}

// ---------------------------------------------------------------- ffmpeg text filters: drawtext (brand cards) / subtitles (burn)
const cardCdp = cdpFound ?? cdpSpec ?? undefined;
{
  // asks the assembler (renders one tiny test card when drawtext is missing) – same code path as mux
  const r = spawnSync('pnpm', ['-s', '--filter', '@svp/assembler', 'start', '--', 'cards-check', '--json', ...(cardCdp ? ['--cdp', cardCdp] : [])], { cwd: root, encoding: 'utf8', env: process.env });
  let j = null;
  try { j = JSON.parse((r.stdout || '').trim().split('\n').filter(Boolean).pop() || 'null'); } catch { /* ignore */ }
  const fixHint = () => {
    info('fix (real ffmpeg text rendering, also needed for --subtitles burn):');
    info('  brew install ffmpeg-full        # keg-only; the assembler picks /opt/homebrew/opt/ffmpeg-full/bin automatically');
    info('  or make it THE ffmpeg: brew uninstall ffmpeg && brew install ffmpeg-full && brew link --overwrite ffmpeg-full');
    info('  or point at any ffmpeg with drawtext: FFMPEG_PATH=/path/to/ffmpeg FFPROBE_PATH=/path/to/ffprobe (e.g. in .env)');
  };
  const how = { 'png:cdp': `a temporary tab of your running browser over CDP (${cardCdp})`, 'png:chromium': "Playwright's Chromium (headless)", 'png:chrome': 'installed Google Chrome (headless)', 'png:msedge': 'installed Microsoft Edge (headless)' };
  if (!j) warn(`could not check ffmpeg filters: ${((r.stderr || r.stdout || '').trim().split('\n').pop() || '?')}`);
  else if (j.style === 'brand' && j.cards && j.cards.startsWith('png:')) {
    ok(`brand cards (intro, parts, outro, thumbnail) rendered via ${how[j.cards] ?? j.cards}`);
    if (j.brandFontsMissing?.length) warn(`brand fonts missing (${j.brandFontsMissing.join(', ')}) -> cards fall back to Inter/Helvetica. Fix: node scripts/brand-fetch.mjs`);
  }
  else if (j.drawtext) ok(`ffmpeg has drawtext${j.subtitles ? ' + subtitles (libass)' : ''} – ${j.style === 'brand' ? 'no browser for brand cards, classic cards drawn by ffmpeg' : 'cards drawn by ffmpeg'}`);
  else {
    warn(`ffmpeg${j.ffmpeg === 'ffmpeg' ? '' : ` (${j.ffmpeg})`} has NO drawtext filter${j.forcedNoDrawtext ? ' (forced by SVP_FORCE_NO_DRAWTEXT)' : ' (Homebrew core ffmpeg is built without libfreetype)'}`);
    if (j.cards && j.cards.startsWith('png:')) info(`fallback: intro/outro/part cards rendered as PNG stills via ${how[j.cards] ?? j.cards} – same look, nothing to do`);
    else {
      warn('no PNG card renderer works either -> intro/outro/part cards will be SKIPPED (chapters.txt still matches final.mp4; --intro-image/--outro-image still work)');
      for (const t of j.tried || []) info(`tried ${t}`);
    }
    fixHint();
  }
  if (j && !j.subtitles && args.subtitles === 'burn') { warn(`ffmpeg${j.ffmpeg === 'ffmpeg' ? '' : ` (${j.ffmpeg})`} has no 'subtitles' filter (libass) – --subtitles burn falls back to sidecar final.srt`); if (j.drawtext) fixHint(); }
}

// ---------------------------------------------------------------- recipe: JSON + contracts/recipe.schema.json (ajv 2020) + placeholders
let recipe = null;
if (recipeArg) {
  const rp = resolveUser(recipeArg);
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(rp, 'utf8')); } catch (e) { bad(`recipe ${recipeArg}: ${e.code === 'ENOENT' ? 'file not found' : 'invalid JSON – ' + e.message}`); }
  if (parsed) {
    recipe = parsed;
    let validate = null;
    try {
      const Ajv2020 = req('ajv/dist/2020');
      const ajv = new (Ajv2020.default || Ajv2020)({ allErrors: true, strict: false });
      validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(root, 'contracts/recipe.schema.json'), 'utf8')));
    } catch (e) { bad(`ajv not available (${e.message.split('\n')[0]}) – run \`pnpm i\` in the repo root`); }
    if (validate) {
      if (validate(recipe)) ok(`recipe ${recipeArg}: valid against contracts/recipe.schema.json – id=${recipe.id}, ${recipe.steps.length} steps, lang=${recipe.lang}, viewport ${recipe.viewport.width}x${recipe.viewport.height}`);
      else {
        bad(`recipe ${recipeArg}: ${validate.errors.length} schema error(s) (contracts/recipe.schema.json)`);
        for (const e of validate.errors.slice(0, 12)) info(`${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ' ' + JSON.stringify(e.params.allowedValues) : ''}`);
      }
    }
    // placeholders
    const today = new Date();
    const envNames = new Set(), unknown = new Set(), dates = new Map();
    for (const s of recipeStrings(recipe)) {
      for (const m of s.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
        const p = m[0].match(PH);
        if (!p || p[0] !== m[0]) { unknown.add(m[0]); continue; }
        if (p[2]) envNames.add(p[2]);
        const n = p[3] ?? p[5], add = p[4] ?? p[6];
        if (n !== undefined) {
          const d = startDate(today, Number(n)); d.setDate(d.getDate() + Number(add ?? 0));
          dates.set(m[0].replace(/\s/g, ''), { value: p[3] !== undefined ? String(d.getDate()) : fmtDate(d, p[7].trim()), iso: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${fmtDate(d, 'YYYY-MM-DD')}`, other: d.getMonth() !== today.getMonth(), weekend: d.getDay() === 0 || d.getDay() === 6 });
        }
      }
    }
    if (unknown.size) bad(`recipe placeholders not understood: ${[...unknown].join(', ')} (known: {{RUN_ID}}, {{ENV:NAME}}, {{DAY:+Nd}}, {{DAY:+Nd+M}}, {{DATE:+Nd[+M]:MM/DD/YYYY}})`);
    const missing = [...envNames].filter((n) => process.env[n] === undefined);
    if (missing.length) bad(`unset env for {{ENV:…}}: ${missing.join(', ')} (put them in .env)`);
    else if (envNames.size) ok(`env placeholders set: ${[...envNames].join(', ')}`);
    if (dates.size) {
      const other = [...dates.values()].some((d) => d.other);
      const weekend = [...dates.values()].some((d) => d.weekend);
      (other || weekend ? warn : ok)(`date placeholders (today ${fmtDate(today, 'YYYY-MM-DD')}): ${[...dates].map(([t, d]) => `${t} -> ${d.value} (${d.iso})`).join(', ')}`);
      if (other) info('a date falls into the next month – a date picker that opens on the current month would pick the wrong day; lower N');
      if (weekend) info('a date falls on a weekend – only the START day ({{DAY:+Nd}}) skips to Monday, +M is plain calendar days; an expected "3 Days" range would not match');
    }
  }
} else if (!checkOnly) {
  bad('no recipe given: pnpm local <recipe.json>');
}

// ---------------------------------------------------------------- intro / outro stills (thumbnails)
for (const k of ['intro-image', 'outro-image']) {
  if (typeof args[k] !== 'string') continue;
  fs.existsSync(resolveUser(args[k])) ? ok(`--${k}: ${args[k]} (${args[k.replace('-image', '-sec')] ?? 3} s)`) : bad(`--${k}: ${args[k]} not found`);
}

// ---------------------------------------------------------------- voice (mirrors assembler chooseProvider)
const id = typeof args.id === 'string' ? args.id : recipe?.id;
const outDir = id ? path.join(outRoot, id) : null;
{
  const hasSay = isMac && has('which', ['say']);
  const hasEspeak = has('which', ['espeak-ng']);
  const key = !!process.env.ELEVENLABS_API_KEY;
  const rp = recipe?.voice?.provider;
  const usable = (p) => p === 'mock' || p === 'external' || (p === 'elevenlabs' ? key : p === 'say' ? hasSay : p === 'espeak' ? hasEspeak : false);
  const auto = key ? 'elevenlabs' : hasSay ? 'say' : hasEspeak ? 'espeak' : 'mock';
  const pick = forcedProvider || (rp === 'external' ? 'external' : ['elevenlabs', 'say', 'espeak'].includes(rp) && usable(rp) ? rp : auto);
  if (forcedProvider && !usable(forcedProvider)) bad(`--provider ${forcedProvider} is not available on this machine`);
  else if (pick === 'external') {
    if (!recipe || !outDir) ok('voice: external (pass a recipe to check the audio files)');
    else {
      // writes out/<id>/audio/manifest.json (the to-do list) and reports which files are there
      const r = spawnSync('pnpm', ['-s', '--filter', '@svp/assembler', 'start', '--', 'manifest', '--recipe', resolveUser(recipeArg), '--out', outDir], { cwd: root, encoding: 'utf8', env: process.env });
      const mf = path.join(outDir, 'audio', 'manifest.json');
      if (r.status !== 0 || !fs.existsSync(mf)) bad(`voice: external – could not write the manifest: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
      else {
        const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
        const notReady = m.steps.filter((s) => s.status !== 'present');
        if (!notReady.length) ok(`voice: external – all ${m.steps.length} narrated step(s) have audio in ${path.relative(root, path.join(outDir, 'audio'))}/`);
        else {
          bad(`voice: external – ${notReady.length} of ${m.steps.length} narrated step(s) have no usable audio yet`);
          for (const s of notReady) info(`${path.relative(root, s.path)}  [${s.status}]${s.reason ? ' ' + s.reason : ''}`);
          info(`to-do list: ${path.relative(root, mf)}  – ask Claude to generate the voiceover from it (ElevenLabs connector), then re-run`);
        }
      }
    }
  } else (pick === 'mock' ? warn : ok)(`voice: ${pick}${pick === 'say' ? ` (voice ${process.env.SAY_VOICE || ({ en: 'Samantha', cs: 'Zuzana', sk: 'Laura' }[(recipe?.lang || 'cs').slice(0, 2)] || 'Zuzana')})` : ''}${pick === 'mock' ? ' – silent tone only' : ''}`);
}

// ---------------------------------------------------------------- --mux-only: the recording must already be there
if (muxOnly) {
  if (!outDir) bad('--mux-only needs --id <id> (or a recipe with an id)');
  else {
    const tf = path.join(outDir, 'timing.json');
    let t = null;
    try { t = JSON.parse(fs.readFileSync(tf, 'utf8')); } catch (e) { bad(`--mux-only: ${path.relative(root, tf)} ${e.code === 'ENOENT' ? 'not found – record first (pnpm local <recipe> without --mux-only)' : 'is not valid JSON'}`); }
    if (t) {
      const raw = [t.video_path && path.join(outDir, path.basename(t.video_path)), path.join(outDir, 'raw.mp4'), path.join(outDir, 'raw.webm')].filter(Boolean).find((f) => fs.existsSync(f));
      raw ? ok(`--mux-only: ${path.relative(root, raw)} + timing.json (${t.steps?.length ?? 0} steps, ${((t.total_ms ?? 0) / 1000).toFixed(1)} s, recorded ${t.recorded_at ?? '?'})`) : bad(`--mux-only: raw video not found in ${path.relative(root, outDir)}/ (timing.video_path = ${t.video_path ?? '-'})`);
      const failedSteps = (t.steps || []).filter((s) => s.status === 'failed').map((s) => s.id);
      if (failedSteps.length) warn(`timing.json has ${failedSteps.length} FAILED step(s): ${failedSteps.join(', ')} – final.mp4 will be made but is not publishable`);
    }
    fs.existsSync(path.join(outDir, 'audio', 'durations.json')) ? ok('--mux-only: audio/durations.json') : bad(`--mux-only: ${path.relative(root, path.join(outDir, 'audio', 'durations.json'))} not found – run tts first`);
  }
}

const failed = results.filter((r) => r[0] === 'bad');
if (failed.length) {
  console.log(`\nPRE-FLIGHT FAILED (${failed.length}). Fix the ✗ items above.`);
  process.exit(1);
}
if (checkOnly) { console.log('\nPRE-FLIGHT OK'); process.exit(0); }

// ---------------------------------------------------------------- run
fs.mkdirSync(outDir, { recursive: true });
const recipeOut = path.join(outDir, 'recipe.json');
if (path.resolve(resolveUser(recipeArg)) !== recipeOut) fs.copyFileSync(resolveUser(recipeArg), recipeOut); // mux reads title/viewport from here

const t0 = Date.now();
const stage = (name, pnpmArgs) => {
  console.log(`\n== ${name}`);
  const r = spawnSync('pnpm', ['-s', ...pnpmArgs], { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status !== 0) { console.error(`\n${name} FAILED (exit ${r.status ?? r.signal}) – fix and re-run; finished stages are cheap to repeat (tts is cached).`); process.exit(1); }
};

if (muxOnly) console.log('\n== --mux-only: skipping tts + record, re-using the existing recording');
else {
  stage('1/3 tts', ['--filter', '@svp/assembler', 'start', '--', 'tts', '--recipe', recipeOut, '--out', outDir, ...(forcedProvider ? ['--provider', forcedProvider] : [])]);
  stage('2/3 record', ['--filter', '@svp/recorder', 'start', '--', '--recipe', recipeOut, '--out', outDir,
    ...(cdpSpec ? ['--cdp', cdpSpec] : []), ...(sessionFile && !cdpSpec ? ['--session-file', sessionFile, '--capture', 'screencast'] : []),
    ...(typeof args['run-id'] === 'string' ? ['--run-id', args['run-id']] : [])]);
}
const passStr = (k) => (typeof args[k] === 'string' ? [`--${k}`, k.endsWith('-image') ? resolveUser(args[k]) : args[k]] : []);
// --cdp for mux = where to render PNG brand cards when ffmpeg has no drawtext (ignored otherwise)
stage(muxOnly ? 'mux' : '3/3 mux', ['--filter', '@svp/assembler', 'start', '--', 'mux', '--out', outDir, ...(cardCdp ? ['--cdp', cardCdp] : []), ...(args['no-intro'] ? ['--no-intro'] : []),
  ...(args['no-interstitials'] ? ['--no-interstitials'] : []), ...(args['no-chapters'] ? ['--no-chapters'] : []),
  ...passStr('intro-image'), ...passStr('outro-image'), ...passStr('intro-sec'), ...passStr('outro-sec'),
  ...(args['no-thumbnail'] ? ['--no-thumbnail'] : []), ...passStr('card-style'), ...passStr('lufs'),
  ...(typeof args.subtitles === 'string' ? ['--subtitles', args.subtitles] : [])]);

const timing = JSON.parse(fs.readFileSync(path.join(outDir, 'timing.json'), 'utf8'));
const notOk = timing.steps.filter((s) => s.status !== 'ok');
const final = path.join(outDir, 'final.mp4');
console.log(`\n== done in ${Math.round((Date.now() - t0) / 1000)} s  (RUN_ID ${timing.run_id ?? '-'}, sync ${timing.sync_source})`);
if (notOk.length) {
  console.log(`!! ${notOk.length} step(s) not ok – the video is NOT publishable yet:`);
  for (const s of notOk) console.log(`   ${s.id} ${s.status}: ${s.error ?? ''}${s.screenshot ? `\n      screenshot: ${s.screenshot}` : ''}`);
}
console.log(`final:     ${final}`);
console.log(`subtitles: ${path.join(outDir, 'final.srt')}`);
if (fs.existsSync(path.join(outDir, 'chapters.txt'))) console.log(`chapters:  ${path.join(outDir, 'chapters.txt')}  (paste into the YouTube description)`);
console.log(`shots:     ${path.join(outDir, 'shots')}/`);
if (isMac && !args['no-open']) spawnSync('open', [final], { stdio: 'ignore' });
process.exit(notOk.length ? 2 : 0);
