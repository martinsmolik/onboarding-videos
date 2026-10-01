import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page, type Locator } from 'playwright';
import type { Action, Recipe, RunOptions, RunResult, Step, Timing, TimingStep, ZoomWindow } from './types.js';
import { BEACON_PX, BEACON_STRIP_PX, CURSOR_INIT_SCRIPT, HIGHLIGHT_FN, cursorInitScript } from './cursor.js';
import { login, shouldLogin } from './login.js';
import { discoverCdp, safeUrl } from './cdp.js';
import { ScreencastCapture } from './screencast.js';
import { envPlaceholders, makeRunId, sanitizeRunId, substituteRecipe } from './placeholders.js';

export type { RunOptions, RunResult, Recipe, Timing, TimingStep, ZoomWindow } from './types.js';
export { discoverCdp, listTargets, safeUrl, parseDevToolsActivePort, parseLocalStateCdpPort, macProfileDirs } from './cdp.js';
export { substituteRecipe, envPlaceholders, unknownPlaceholders, makeRunId, sanitizeRunId, startDate, offsetDate, formatDate } from './placeholders.js';
export { concatScript } from './screencast.js';

const execFileP = promisify(execFile);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)));

// ---------------------------------------------------------------- defaults
const DEFAULT_BEFORE_MS = 300;
const DEFAULT_HOLD_MS = 800;
// Brief: typing must be quick (or pasted – use `fill`). CDP screencast: 35 ms/char default, `speed: "fast"` = 15 ms.
const DEFAULT_TYPE_DELAY_MS = 35;
const FAST_TYPE_DELAY_MS = 15;
// recordVideo + beacon keeps its old defaults: Playwright's writer emits >= 1 video frame (40 ms) per repaint, so
// faster typing stretches the video against the narration inside the step (measured on the smoke recipe: 40 ms/char
// adds ~120-150 ms drift per typing step vs 80 ms). An explicit delay_ms is always honoured.
const BEACON_TYPE_DELAY_MS = 80;
const BEACON_FAST_TYPE_DELAY_MS = 40;
const DEFAULT_ZOOM_SCALE = 1.6;
const DEFAULT_ZOOM_HOLD_MS = 2500;
const ZOOM_IN_MS = 400;
const ZOOM_OUT_MS = 400;
/** the zoomed element must stay inside this fraction of the viewport (scale is clamped otherwise) */
const ZOOM_FIT = 0.96;
const LOCATOR_TIMEOUT_MS = 10_000;
const EXPECT_TIMEOUT_MS = 5_000;
const SCROLL_PX = 400;
const CZECH_CHARS_PER_SEC = 14;
const MIN_ESTIMATED_AUDIO_MS = 1500;
const TAIL_MS = 1000;

// ---------------------------------------------------------------- recipe
export function loadRecipe(file: string): Recipe {
  const recipe = JSON.parse(fs.readFileSync(file, 'utf8')) as Recipe;
  validateRecipe(recipe);
  return recipe;
}

export function validateRecipe(r: Recipe): void {
  const errs: string[] = [];
  if (!r || typeof r !== 'object') throw new Error('recipe: not an object');
  if (!r.id) errs.push('missing id');
  if (!r.viewport || !Number.isInteger(r.viewport.width) || !Number.isInteger(r.viewport.height))
    errs.push('viewport.width/height must be integers');
  if (!r.start?.url) errs.push('missing start.url');
  if (!Array.isArray(r.steps) || r.steps.length === 0) errs.push('steps must be a non-empty array');
  else {
    const seen = new Set<string>();
    for (const s of r.steps) {
      if (!s.id) errs.push('step without id');
      else if (seen.has(s.id)) errs.push(`duplicate step id ${s.id}`);
      seen.add(s.id);
      if (typeof s.narration !== 'string') errs.push(`${s.id}: narration must be a string`);
      if (s.part !== undefined && !(Number.isInteger(s.part) && s.part >= 1)) errs.push(`${s.id}: part must be an integer >= 1`);
      if (!Array.isArray(s.actions)) errs.push(`${s.id}: actions must be an array`);
      else for (const a of s.actions) {
        if (a.type === 'zoom') {
          if (!a.selector) errs.push(`${s.id}: zoom needs a selector`);
          if (a.value !== undefined && !(Number(a.value) > 1)) errs.push(`${s.id}: zoom value must be a scale > 1, e.g. "1.6" (got ${JSON.stringify(a.value)})`);
        }
        if (a.type === 'fill' && !a.selector) errs.push(`${s.id}: fill needs a selector`);
      }
    }
  }
  if (errs.length) throw new Error('recipe invalid: ' + errs.join('; '));
}

/** Text that is actually spoken (narration_tts, default narration). */
export function ttsText(s: Pick<Step, 'narration' | 'narration_tts'>): string {
  return (s.narration_tts ?? s.narration ?? '').trim();
}

/** Effective part per step: step.part, else inherited from the previous step; part_title from the step that opened the part. */
export function effectiveParts(steps: Pick<Step, 'part' | 'part_title'>[]): { part?: number; part_title?: string }[] {
  let part: number | undefined, title: string | undefined;
  return steps.map(s => {
    if (s.part !== undefined && s.part !== part) { part = s.part; title = undefined; }
    if (s.part_title !== undefined && part !== undefined) title = s.part_title;
    return part === undefined ? {} : { part, ...(title ? { part_title: title } : {}) };
  });
}

/** Standalone fallback when audio/durations.json is missing: Czech ≈ 14 chars/s. */
export function estimateAudioMs(narration: string): number {
  const text = (narration ?? '').trim();
  if (!text) return 0;
  return Math.max(MIN_ESTIMATED_AUDIO_MS, Math.round((text.length / CZECH_CHARS_PER_SEC) * 1000));
}

function loadDurations(file: string | undefined, log: (l: string) => void): Record<string, number> | null {
  if (!file) return null;
  if (!fs.existsSync(file)) {
    log(`durations: ${file} not found – estimating from narration length`);
    return null;
  }
  const d = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, number>;
  log(`durations: loaded ${Object.keys(d).length} entries from ${file}`);
  return d;
}

// ---------------------------------------------------------------- recorder
/**
 * Zoom geometry. scale = min(wanted, what still fits ZOOM_FIT of the viewport). Origin = element centre,
 * moved only as far as needed to keep the zoomed element fully on screen (an element at the left edge
 * zooms "to the right" instead of being cut off).
 */
export function zoomFit(wanted: number, box: { x: number; y: number; width: number; height: number }, vp: { width: number; height: number }): { scale: number; ox: number; oy: number } {
  const scale = Math.max(1, Math.min(wanted, box.width > 0 ? (ZOOM_FIT * vp.width) / box.width : Infinity, box.height > 0 ? (ZOOM_FIT * vp.height) / box.height : Infinity));
  const axis = (x0: number, w: number, size: number) => {
    const c = x0 + w / 2;
    if (scale <= 1.0001) return c;
    const m = (size * (1 - ZOOM_FIT)) / 2;
    // zoomed edge o + s(x - o) must stay within [m, size - m]
    const hi = (scale * x0 - m) / (scale - 1), lo = (scale * (x0 + w) - size + m) / (scale - 1);
    return lo <= hi ? Math.min(hi, Math.max(lo, c)) : c;
  };
  return { scale, ox: Math.round(axis(box.x, box.width, vp.width)), oy: Math.round(axis(box.y, box.height, vp.height)) };
}

class Recorder {
  private cursor = { x: 0, y: 0 };
  private beaconK = 0;
  private t0 = 0;
  /** zoom windows of the current step (Recorder.now() time); replaySteps collects them */
  zooms: ZoomWindow[] = [];

  constructor(private page: Page, private viewport: { width: number; height: number }, private log: (l: string) => void, private beaconMode = false) {
    this.cursor = { x: Math.round(viewport.width / 2), y: Math.round(viewport.height / 2) };
    // Re-place the overlay after every full navigation (init script re-creates it fresh at 50/50).
    page.on('load', () => { void this.reinjectCursor(); });
  }

  start(): void { this.t0 = Date.now(); }
  now(): number { return Date.now() - this.t0; }
  /** Date.now() at start() – screencast mode maps it onto the frame clock afterwards. */
  get wallT0(): number { return this.t0; }

  async reinjectCursor(): Promise<void> {
    try {
      await this.page.evaluate(
        ([x, y, k]) => { const c = (window as any).__svpCursor; c?.beacon(k); return c?.moveTo(x, y, 0); },
        [this.cursor.x, this.cursor.y, this.beaconK]
      );
    } catch { /* page may be mid-navigation; next action re-injects anyway */ }
  }

  /** Flip the sync beacon colour for step k (1-based). Returns after the style is applied. */
  async setBeacon(k: number): Promise<void> {
    this.beaconK = k;
    await this.page.evaluate(kk => { (window as any).__svpCursor?.beacon(kk); }, k).catch(() => {});
  }

  private locator(selector: string): Locator {
    return this.page.locator(selector).first();
  }

  private async elementCenter(selector: string): Promise<{ x: number; y: number; loc: Locator; box: { x: number; y: number; width: number; height: number } }> {
    const loc = this.locator(selector);
    await loc.waitFor({ state: 'visible', timeout: LOCATOR_TIMEOUT_MS });
    await loc.scrollIntoViewIfNeeded({ timeout: LOCATOR_TIMEOUT_MS });
    const box = await loc.boundingBox();
    if (!box) throw new Error(`no bounding box for ${selector}`);
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), loc, box };
  }


  /** Animate overlay cursor AND the real mouse along the same eased path. */
  private async glideTo(x: number, y: number): Promise<void> {
    const { x: sx, y: sy } = this.cursor;
    const dist = Math.hypot(x - sx, y - sy);
    const ms = Math.round(600 + 300 * Math.min(1, dist / 1200)); // 600–900 ms, distance based
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
    const STEPS = 12;

    await this.reinjectCursor();
    const overlay = this.page
      .evaluate(([tx, ty, d]) => (window as any).__svpCursor?.moveTo(tx, ty, d), [x, y, ms])
      .catch(() => {});
    const started = Date.now();
    for (let i = 1; i <= STEPS; i++) {
      const e = ease(i / STEPS);
      await this.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      const due = started + (ms * i) / STEPS;
      await sleep(due - Date.now());
    }
    await overlay;
    this.cursor = { x, y };
  }

  private async ripple(): Promise<void> {
    await this.page.evaluate(() => { (window as any).__svpCursor?.click(); }).catch(() => {});
  }

  async runAction(a: Action): Promise<void> {
    await sleep(a.before_ms ?? DEFAULT_BEFORE_MS);
    switch (a.type) {
      case 'navigate': {
        if (!a.value) throw new Error('navigate: missing value (url)');
        await this.page.goto(a.value, { waitUntil: 'load', timeout: 30_000 });
        await this.reinjectCursor();
        return;
      }
      case 'click': {
        if (!a.selector) throw new Error('click: missing selector');
        const { x, y } = await this.elementCenter(a.selector);
        await this.glideTo(x, y);
        await this.ripple();
        await this.page.mouse.click(x, y);
        return;
      }
      case 'hover': {
        if (!a.selector) throw new Error('hover: missing selector');
        const { x, y } = await this.elementCenter(a.selector);
        await this.glideTo(x, y);
        return;
      }
      case 'type': {
        if (!a.selector) throw new Error('type: missing selector');
        const { x, y, loc } = await this.elementCenter(a.selector);
        await this.glideTo(x, y);
        await this.ripple();
        await this.page.mouse.click(x, y);
        if (a.clear) await loc.fill('');
        const fast = a.speed === 'fast';
        const delay = a.delay_ms ?? (this.beaconMode ? (fast ? BEACON_FAST_TYPE_DELAY_MS : BEACON_TYPE_DELAY_MS) : (fast ? FAST_TYPE_DELAY_MS : DEFAULT_TYPE_DELAY_MS));
        await loc.pressSequentially(a.value ?? '', { delay });
        return;
      }
      case 'fill': {
        // long texts: cursor goes to the field and clicks, then the whole value appears at once
        if (!a.selector) throw new Error('fill: missing selector');
        const { x, y, loc } = await this.elementCenter(a.selector);
        await this.glideTo(x, y);
        await this.ripple();
        await this.page.mouse.click(x, y);
        await loc.fill(a.value ?? ''); // sets the value + 'input' event (works for React/Angular controlled inputs)
        await loc.dispatchEvent('change').catch(() => {});
        await sleep(150);
        return;
      }
      case 'zoom': {
        if (!a.selector) throw new Error('zoom: missing selector');
        const wanted = a.value !== undefined ? Number(a.value) : DEFAULT_ZOOM_SCALE;
        if (!(wanted > 1)) throw new Error(`zoom: value must be a scale > 1 (got ${a.value})`);
        const hold = a.hold_ms ?? DEFAULT_ZOOM_HOLD_MS;
        const { x, y, box } = await this.elementCenter(a.selector);
        // the cursor must point at the zoomed element: keep it if it already is inside, else glide to the centre
        const c = this.cursor;
        if (!(c.x >= box.x && c.x <= box.x + box.width && c.y >= box.y && c.y <= box.y + box.height)) await this.glideTo(x, y);
        const fit = zoomFit(wanted, box, this.viewport);
        const scale = +fit.scale.toFixed(3);
        if (scale < wanted - 0.01) this.log(`zoom ${a.selector}: scale ${wanted} -> ${scale} (element ${Math.round(box.width)}x${Math.round(box.height)} must fit the viewport – zoom a smaller element)`);
        const zoomTo = (s: number, ms: number) => this.page.evaluate(([cx, cy, ss, mm]) => (window as any).__svpCursor?.zoom(cx, cy, ss, mm), [fit.ox, fit.oy, s, ms]);
        const w: ZoomWindow = { selector: a.selector, scale, origin: [fit.ox, fit.oy], t_start_ms: this.now(), t_full_ms: 0, t_release_ms: 0, t_end_ms: 0 };
        try {
          const r = await zoomTo(scale, ZOOM_IN_MS) as { scrolled?: boolean } | undefined;
          if (r?.scrolled) this.log(`zoom ${a.selector}: the document is scrolled – the app's own position:fixed elements shift during the zoom`);
          w.t_full_ms = this.now();
          await sleep(hold);
          w.t_release_ms = this.now();
          await zoomTo(1, ZOOM_OUT_MS);
          w.t_end_ms = this.now();
        } catch (e) {
          await this.page.evaluate(() => (window as any).__svpCursor?.zoomReset()).catch(() => {});
          throw e;
        }
        this.zooms.push(w);
        return;
      }
      case 'press': {
        if (!a.value) throw new Error('press: missing value (key)');
        await this.page.keyboard.press(a.value);
        return;
      }
      case 'select': {
        if (!a.selector) throw new Error('select: missing selector');
        const { x, y, loc } = await this.elementCenter(a.selector);
        await this.glideTo(x, y);
        await this.ripple();
        // Native <select> popups are not part of the page video; pick the option directly.
        const v = a.value ?? '';
        await loc.selectOption({ label: v }).catch(() => loc.selectOption(v));
        await sleep(250);
        return;
      }
      case 'scroll': {
        const v = (a.value ?? '').trim();
        if (v === 'down' || v === 'up' || (!v && !a.selector)) {
          await this.page.mouse.wheel(0, v === 'up' ? -SCROLL_PX : SCROLL_PX);
          await sleep(400);
        } else {
          const sel = a.selector || v;
          const loc = this.locator(sel);
          await loc.waitFor({ state: 'attached', timeout: LOCATOR_TIMEOUT_MS });
          await loc.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
          await sleep(600);
        }
        return;
      }
      case 'wait': {
        await sleep(Number(a.value ?? 500) || 0);
        return;
      }
      case 'highlight': {
        if (!a.selector) throw new Error('highlight: missing selector');
        const { loc } = await this.elementCenter(a.selector);
        await loc.evaluate(HIGHLIGHT_FN as unknown as (el: Element) => Promise<void>); // resolves after the 2 s pulse
        return;
      }
      default:
        throw new Error(`unknown action type ${(a as Action).type}`);
    }
  }

  async checkExpect(step: Step): Promise<void> {
    const e = step.expect;
    if (!e) return;
    if (e.visible) {
      await this.locator(e.visible).waitFor({ state: 'visible', timeout: EXPECT_TIMEOUT_MS })
        .catch(() => { throw new Error(`expect.visible failed: ${e.visible}`); });
    }
    if (e.url_contains) {
      const needle = e.url_contains;
      await this.page.waitForURL(u => u.href.includes(needle), { timeout: EXPECT_TIMEOUT_MS })
        .catch(() => { throw new Error(`expect.url_contains failed: ${needle} (url=${this.page.url()})`); });
    }
  }
}

// ---------------------------------------------------------------- ffprobe
async function probe(file: string): Promise<{ fps: number; durationMs: number | null }> {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=r_frame_rate,duration:format=duration',
      '-of', 'json', file
    ]);
    const j = JSON.parse(stdout) as { streams?: { r_frame_rate?: string; duration?: string }[]; format?: { duration?: string } };
    const s = j.streams?.[0] ?? {};
    let fps = 25;
    if (s.r_frame_rate) {
      const [n, d] = s.r_frame_rate.split('/').map(Number);
      if (n && d) fps = n / d;
    }
    const durStr = s.duration ?? j.format?.duration;
    const dur = durStr && durStr !== 'N/A' ? Number(durStr) : NaN;
    return { fps, durationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : null };
  } catch {
    return { fps: 25, durationMs: null };
  }
}

// ---------------------------------------------------------------- run
interface Prepared {
  recipe: Recipe;
  runId: string;
  /** resolved {{DAY:...}} / {{DATE:...}} tokens -> value (never ENV values) */
  dates: Record<string, string>;
  outDir: string;
  shotsDir: string;
  audioFor: (s: Step) => number;
  log: (l: string) => void;
}

function prepare(opts: RunOptions): Prepared {
  const log = opts.log ?? ((l: string) => console.log(l));
  const runId = sanitizeRunId(opts.runId || process.env.RUN_ID || makeRunId());
  const envNames = envPlaceholders(loadRecipe(opts.recipe));
  const { recipe, replaced, dates } = substituteRecipe(loadRecipe(opts.recipe), { runId, today: opts.today });
  if (replaced) log(`placeholders: ${replaced} substituted (RUN_ID=${runId}${envNames.length ? `; env: ${envNames.join(', ')}` : ''})`);
  for (const d of dates) {
    log(`placeholders: ${d.token} -> "${d.value}" (${d.date})${d.otherMonth ? '  WARNING: not in the current month – a date picker that opens on the current month will pick the wrong day' : ''}`);
  }
  const outDir = path.resolve(opts.out);
  const shotsDir = path.join(outDir, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });

  const durations = loadDurations(opts.durations ?? path.join(outDir, 'audio', 'durations.json'), log);
  const audioFor = (s: Step): number => {
    if (durations && Number.isFinite(durations[s.id])) return Math.round(durations[s.id]);
    const est = estimateAudioMs(ttsText(s));
    if (durations) log(`durations: no entry for ${s.id} – estimated ${est} ms`);
    return est;
  };
  return { recipe, runId, dates: Object.fromEntries(dates.map(d => [d.token, d.value])), outDir, shotsDir, audioFor, log };
}

/**
 * Playwright storageState JSON ({cookies?, origins:[{origin, localStorage:[{name,value}]}]}).
 * Only counts are logged – never names of cookies or any values (they are auth tokens).
 */
export function loadSessionFile(file: string, log: (l: string) => void): { cookies: any[]; origins: { origin: string; localStorage: { name: string; value: string }[] }[] } {
  if (!fs.existsSync(file)) throw new Error(`session file ${file} not found (see scripts/grab-session.md)`);
  let j: any;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`session file ${file} is not valid JSON (see scripts/grab-session.md)`); }
  const origins = Array.isArray(j?.origins) ? j.origins : null;
  if (!origins || !origins.every((o: any) => typeof o?.origin === 'string' && Array.isArray(o.localStorage ?? [])))
    throw new Error(`session file ${file}: expected {"origins":[{"origin":"https://…","localStorage":[{"name":…,"value":…}]}]}`);
  const state = {
    cookies: Array.isArray(j.cookies) ? j.cookies : [],
    origins: origins.map((o: any) => ({ origin: o.origin.replace(/\/$/, ''), localStorage: (o.localStorage ?? []).filter((e: any) => typeof e?.name === 'string' && typeof e?.value === 'string') }))
  };
  const keys = state.origins.reduce((n: number, o: { localStorage: unknown[] }) => n + o.localStorage.length, 0);
  log(`session: ${path.basename(file)} – ${state.origins.length} origin(s) [${state.origins.map((o: { origin: string }) => o.origin).join(', ')}], ${keys} localStorage key(s), ${state.cookies.length} cookie(s)`);
  if (!keys && !state.cookies.length) log('session: WARNING – file holds no localStorage keys and no cookies');
  return state;
}

const localeFor = (lang: string) => (lang === 'en' ? 'en-US' : lang === 'sk' ? 'sk-SK' : 'cs-CZ');

/** The step/pacing engine shared by every capture mode. Times are Recorder.now() (ms since recorder.start()). */
async function replaySteps(page: Page, recorder: Recorder, p: Prepared, strict: boolean, beacon: boolean): Promise<TimingStep[]> {
  const { recipe, shotsDir, audioFor, log } = p;
  const { viewport } = recipe;
  const timingSteps: TimingStep[] = [];
  let aborted = false;
  const parts = effectiveParts(recipe.steps);
  for (const [si, step] of recipe.steps.entries()) {
    const audioMs = audioFor(step);
    const hold = step.hold_after_ms ?? DEFAULT_HOLD_MS;
    const shot = path.join(shotsDir, `${step.id}.png`);
    const rec: TimingStep = { id: step.id, ...parts[si], t_start_ms: 0, t_actions_end_ms: 0, t_end_ms: 0, audio_ms: audioMs, status: 'ok', screenshot: shot };
    recorder.zooms = [];

    if (aborted) {
      rec.status = 'skipped';
      rec.t_start_ms = rec.t_actions_end_ms = rec.t_end_ms = recorder.now();
      delete rec.screenshot;
      timingSteps.push(rec);
      continue;
    }

    if (beacon) await recorder.setBeacon(timingSteps.length + 1);
    rec.t_start_ms = recorder.now();
    try {
      for (const a of step.actions) await recorder.runAction(a);
      rec.t_actions_end_ms = recorder.now();
      await recorder.checkExpect(step);
    } catch (e) {
      if (!rec.t_actions_end_ms) rec.t_actions_end_ms = recorder.now();
      rec.status = 'failed';
      rec.error = (e as Error).message.split('\n')[0].slice(0, 500);
      log(`step ${step.id} FAILED: ${rec.error}`);
      if (strict) aborted = true;
    }
    if (recorder.zooms.length) rec.zooms = recorder.zooms;

    // screenshots are content-only (strip cropped) so QA / self-heal see what the viewer sees
    await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: viewport.width, height: viewport.height } }).catch(err => log(`screenshot ${step.id} failed: ${(err as Error).message}`));

    // Pacing: hold the step until narration AND actions are both done, then hold_after.
    const floor = Math.max(audioMs, step.min_duration_ms ?? 0);
    await sleep(rec.t_start_ms + floor - recorder.now());
    await sleep(hold);
    rec.t_end_ms = recorder.now();
    timingSteps.push(rec);
    log(fmtRow(rec));
  }
  return timingSteps;
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const p = prepare(opts);
  if (opts.cdp) return runScreencast(opts, p, 'cdp');
  if ((opts.capture ?? 'video') === 'screencast') return runScreencast(opts, p, 'launch');
  return runVideo(opts, p);
}

// ---------------------------------------------------------------- mode 1: launch + recordVideo + beacon (original path)
async function runVideo(opts: RunOptions, p: Prepared): Promise<RunResult> {
  const { recipe, outDir, log } = p;
  const videoTmp = path.join(outDir, '.video-tmp');
  fs.mkdirSync(videoTmp, { recursive: true });

  const { viewport } = recipe;
  const recordSize = { width: viewport.width, height: viewport.height + BEACON_STRIP_PX };
  const browser: Browser = await chromium.launch({ headless: !opts.headed });
  let context: BrowserContext | null = null;
  let videoPathTmp: string | null = null;
  let timingSteps: TimingStep[] = [];
  let recorder: Recorder | null = null;

  try {
    const session = opts.sessionFile ? loadSessionFile(opts.sessionFile, log) : undefined;
    const storageState =
      session ?? (recipe.start.storage_state && fs.existsSync(recipe.start.storage_state) ? recipe.start.storage_state : undefined);
    if (!session && recipe.start.storage_state && !storageState) log(`storage_state ${recipe.start.storage_state} not found – ignoring`);

    // The browser viewport is BEACON_STRIP_PX taller than the recipe viewport: the extra
    // bottom rows hold an opaque strip with the sync beacon, which the assembler crops away
    // (timing.beacon_strip_px). Page content therefore never has to share pixels with the beacon.
    context = await browser.newContext({
      viewport: recordSize,
      deviceScaleFactor: 1,
      locale: localeFor(recipe.lang),
      storageState,
      recordVideo: { dir: videoTmp, size: recordSize }
    });
    await context.addInitScript(CURSOR_INIT_SCRIPT);

    const page = await context.newPage();
    recorder = new Recorder(page, viewport, log, true);
    recorder.start(); // t=0 ≈ first video frame (video starts with page creation)
    const video = page.video();

    if (!storageState && shouldLogin(recipe.start.url)) {
      await login(page, { url: recipe.start.url, user: process.env.SLONEEK_DEMO_USER!, pass: process.env.SLONEEK_DEMO_PASS!, log });
    }
    await page.goto(recipe.start.url, { waitUntil: 'load', timeout: 30_000 });
    await recorder.reinjectCursor();
    if (session) {
      const n = await page.evaluate(() => { try { return localStorage.length; } catch { return -1; } }).catch(() => -1);
      log(`page: ${safeUrl(page.url())}  localStorage keys: ${n}`);
    }

    timingSteps = await replaySteps(page, recorder, p, !!opts.strict, true);

    await sleep(TAIL_MS);
    await context.close(); // finalizes the webm
    context = null;
    videoPathTmp = video ? await video.path() : null;
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (!videoPathTmp || !fs.existsSync(videoPathTmp)) throw new Error('video file was not produced');
  const rawPath = path.join(outDir, 'raw.webm');
  fs.renameSync(videoPathTmp, rawPath);
  fs.rmSync(videoTmp, { recursive: true, force: true });

  const { fps, durationMs } = await probe(rawPath);
  const lastEnd = timingSteps.length ? timingSteps[timingSteps.length - 1].t_end_ms : 0;
  const totalMs = durationMs ?? lastEnd + TAIL_MS;
  if (durationMs === null) log('ffprobe: no duration reported – using measured wall time');
  const drift = totalMs - (lastEnd + TAIL_MS);

  // Re-anchor every step onto true video time using the beacon transitions.
  const syncSource = applyBeaconSync(timingSteps, await scanBeacon(rawPath, fps), totalMs, log);

  const timing: Timing = {
    recipe_id: recipe.id,
    video_path: rawPath,
    fps,
    total_ms: totalMs,
    recorded_at: new Date().toISOString(),
    sync_source: syncSource,
    beacon_strip_px: BEACON_STRIP_PX,
    run_id: p.runId,
    ...(Object.keys(p.dates).length ? { placeholder_dates: p.dates } : {}),
    capture: 'video',
    browser_mode: 'launch',
    steps: timingSteps
  };
  const timingPath = writeTiming(outDir, timing, log);
  log(`video: ${rawPath}  ${recordSize.width}x${recordSize.height} (content ${viewport.width}x${viewport.height} + ${BEACON_STRIP_PX} px beacon strip)  fps=${fps}  total=${totalMs} ms (last step end ${lastEnd} ms + ${TAIL_MS} ms tail => drift ${drift >= 0 ? '+' : ''}${drift} ms)`);
  log(`timing: ${timingPath}`);
  return { timing, timingPath, videoPath: rawPath };
}

function writeTiming(outDir: string, timing: Timing, log: (l: string) => void): string {
  const timingPath = path.join(outDir, 'timing.json');
  fs.writeFileSync(timingPath, JSON.stringify(timing, null, 2));
  log('');
  log(fmtHeader());
  for (const s of timing.steps) log(fmtRow(s));
  const failed = timing.steps.filter(s => s.status !== 'ok');
  if (failed.length) log(`${failed.length} step(s) not ok: ${failed.map(s => `${s.id}=${s.status}`).join(', ')}`);
  return timingPath;
}

// ---------------------------------------------------------------- mode 2: CDP screencast (attach to BrowserOS neo, or launch)
async function runScreencast(opts: RunOptions, p: Prepared, mode: 'cdp' | 'launch'): Promise<RunResult> {
  const { recipe, outDir, log } = p;
  const { viewport } = recipe;
  const framesDir = path.join(outDir, '.frames');
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let cdp: CDPSession | null = null;
  let cap: ScreencastCapture | null = null;
  let timingSteps: TimingStep[] = [];
  let wallT0 = 0, endWall = 0;
  const onSignal = () => {
    // never leave our recording tab behind in the user's browser
    void (async () => { await page?.close().catch(() => {}); process.exit(130); })();
  };

  try {
    if (mode === 'cdp') {
      const { found, tried } = await discoverCdp(opts.cdp!, { log });
      if (!found) throw new Error(`no CDP endpoint answered (${opts.cdp}). Tried:\n  - ${tried.join('\n  - ')}\nIs the browser running? BrowserOS neo serves CDP on 127.0.0.1:9110 by default; run \`pnpm local:check\`.`);
      log(`cdp: ${found.endpoint}  via ${found.source}${found.browser ? `  (${found.browser})` : ''}`);
      browser = await chromium.connectOverCDP(found.endpoint, { timeout: 15_000 });
      context = browser.contexts()[0] ?? null;
      if (!context) throw new Error('cdp: browser has no default context');
      if (opts.sessionFile) log('cdp: --session-file ignored (the attached browser already has its own logins)');
      page = await context.newPage(); // a NEW tab – existing tabs are never touched
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
    } else {
      browser = await chromium.launch({ headless: !opts.headed });
      const session = opts.sessionFile ? loadSessionFile(opts.sessionFile, log) : undefined;
      const storageState = session ?? (recipe.start.storage_state && fs.existsSync(recipe.start.storage_state) ? recipe.start.storage_state : undefined);
      context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: localeFor(recipe.lang), storageState });
      page = await context.newPage();
      if (!storageState && shouldLogin(recipe.start.url))
        await login(page, { url: recipe.start.url, user: process.env.SLONEEK_DEMO_USER!, pass: process.env.SLONEEK_DEMO_PASS!, log });
    }
    await page.addInitScript(cursorInitScript({ beacon: false })); // this page only
    cdp = await context.newCDPSession(page);
    if (mode === 'cdp') {
      // size the new tab to the recipe viewport independent of the real window size; 1x pixels
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false,
        screenWidth: viewport.width, screenHeight: viewport.height
      });
    }
    await page.bringToFront().catch(() => {});

    const recorder = new Recorder(page, viewport, log);
    await page.goto(recipe.start.url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {}); // SPA settle (capped)
    await sleep(300);
    await recorder.reinjectCursor();
    const lsKeys = await page.evaluate(() => { try { return localStorage.length; } catch { return -1; } }).catch(() => -1);
    log(`page: ${safeUrl(page.url())}  localStorage keys: ${lsKeys}`);

    cap = new ScreencastCapture(cdp, framesDir, viewport, log);
    await cap.start();
    const got = await cap.waitFirstFrame(4000, () => recorder.reinjectCursor());
    if (!got) throw new Error('screencast: no frames within 4 s – is the browser window visible (not minimized / on another Space)?');

    recorder.start();
    wallT0 = recorder.wallT0;
    timingSteps = await replaySteps(page, recorder, p, !!opts.strict, false);
    await sleep(TAIL_MS);
    endWall = Date.now();
    await cap.stop();
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (cap) await cap.stop().catch(() => {});
    if (cdp && mode === 'cdp') await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    if (cdp) await cdp.detach().catch(() => {});
    if (mode === 'cdp') await page?.close().catch(() => {});
    else await context?.close().catch(() => {});
    // for connectOverCDP this only disconnects – the user's browser keeps running
    await browser?.close().catch(() => {});
  }

  const rawPath = path.join(outDir, 'raw.mp4');
  const endTs = cap!.wallToTs(endWall);
  await cap!.encode(rawPath, endTs);
  // Move step times from the Date.now() clock into video time: t_video = map(wall) - t0.
  const delta = cap!.wallToVideoMs(wallT0);
  for (const s of timingSteps) {
    s.t_start_ms += delta; s.t_actions_end_ms += delta; s.t_end_ms += delta;
    for (const z of s.zooms ?? []) { z.t_start_ms += delta; z.t_full_ms += delta; z.t_release_ms += delta; z.t_end_ms += delta; }
  }
  if (!opts.keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });

  const { fps, durationMs } = await probe(rawPath);
  const plannedMs = cap!.wallToVideoMs(endWall);
  const totalMs = durationMs ?? plannedMs;
  const lastEnd = timingSteps.length ? timingSteps[timingSteps.length - 1].t_end_ms : 0;
  log(`screencast sync: wall->video offset +${delta} ms (t0 = first frame); video ${totalMs} ms vs wall timeline ${plannedMs} ms (diff ${totalMs - plannedMs >= 0 ? '+' : ''}${totalMs - plannedMs} ms)`);

  const timing: Timing = {
    recipe_id: recipe.id,
    video_path: rawPath,
    fps,
    total_ms: totalMs,
    recorded_at: new Date().toISOString(),
    sync_source: 'screencast',
    beacon_strip_px: 0,
    run_id: p.runId,
    ...(Object.keys(p.dates).length ? { placeholder_dates: p.dates } : {}),
    capture: 'screencast',
    browser_mode: mode,
    steps: timingSteps
  };
  const timingPath = writeTiming(outDir, timing, log);
  log(`video: ${rawPath}  ${viewport.width}x${viewport.height}  fps=${fps}  total=${totalMs} ms (last step end ${lastEnd} ms + ${TAIL_MS} ms tail)`);
  log(`timing: ${timingPath}`);
  return { timing, timingPath, videoPath: rawPath };
}

// ---------------------------------------------------------------- beacon sync
/**
 * Playwright's video writer emits max(1, round(fps*dt)) frames per screencast
 * frame, so video time drifts from wall time by a few hundred ms per minute
 * (more when the page repaints >25 fps). The overlay flips a 6x6 px square in
 * the bottom-left corner (inside the extra BEACON_STRIP_PX rows below the
 * recipe viewport) at each step start; scanning it in raw.webm gives the
 * exact video frame where each step begins.
 */
async function scanBeacon(file: string, fps: number): Promise<number[] | null> {
  try {
    const { stdout } = await execFileP('ffmpeg', [
      '-v', 'error', '-i', file,
      '-vf', `crop=${BEACON_PX}:${BEACON_PX}:0:ih-${BEACON_PX}`,
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
    ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    const buf = stdout as unknown as Buffer;
    const per = BEACON_PX * BEACON_PX;
    const frames = Math.floor(buf.length / per);
    const cls = (i: number): 'b' | 'w' | 'g' => {
      let sum = 0;
      for (let j = 0; j < per; j++) sum += buf[i * per + j];
      const m = sum / per;
      return m < 90 ? 'b' : m > 165 ? 'w' : 'g';
    };
    const transitions: number[] = [];
    let prev = cls(0);
    for (let i = 1; i < frames; i++) {
      const c = cls(i);
      if (c !== prev && c !== 'g') transitions.push(Math.round((i / fps) * 1000));
      if (c !== 'g' || prev === 'g') prev = c; // ignore grey blips once running
    }
    return transitions;
  } catch {
    return null;
  }
}

function applyBeaconSync(all: TimingStep[], beacons: number[] | null, totalMs: number, log: (l: string) => void): 'beacon' | 'wall' {
  const steps = all.filter(s => s.status !== 'skipped'); // skipped steps never flipped the beacon
  if (!beacons || beacons.length !== steps.length) {
    log(`beacon sync: expected ${steps.length} transitions, found ${beacons ? beacons.length : 'none'} – keeping wall-clock times`);
    return 'wall';
  }
  const deltas = steps.map((s, i) => beacons[i] - s.t_start_ms);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const d = deltas[i];
    const start = beacons[i];
    const end = i + 1 < steps.length ? beacons[i + 1] : Math.min(totalMs, s.t_end_ms + d);
    s.t_start_ms = start;
    s.t_end_ms = Math.max(start, end);
    s.t_actions_end_ms = Math.min(s.t_end_ms, Math.max(start, s.t_actions_end_ms + d));
    const clamp = (v: number) => Math.min(s.t_end_ms, Math.max(start, v + d));
    for (const z of s.zooms ?? []) { z.t_start_ms = clamp(z.t_start_ms); z.t_full_ms = clamp(z.t_full_ms); z.t_release_ms = clamp(z.t_release_ms); z.t_end_ms = clamp(z.t_end_ms); }
  }
  const lastEnd = steps.length ? steps[steps.length - 1].t_end_ms : 0;
  for (const s of all) if (s.status === 'skipped') s.t_start_ms = s.t_actions_end_ms = s.t_end_ms = lastEnd;
  const maxAbs = Math.max(...deltas.map(Math.abs));
  log(`beacon sync: re-anchored ${steps.length} steps to video time (wall->video correction ${deltas.map(d => (d >= 0 ? '+' : '') + d).join(', ')} ms; max |${maxAbs}| ms)`);
  return 'beacon';
}

// ---------------------------------------------------------------- log table
const pad = (v: string | number, n: number) => String(v).padStart(n);
function fmtHeader(): string {
  return `${'step'.padEnd(6)}${pad('start', 8)}${pad('act_end', 9)}${pad('end', 8)}${pad('audio', 8)}${pad('dur', 8)}  status`;
}
function fmtRow(s: TimingStep): string {
  const extra = [s.part !== undefined ? `part ${s.part}` : '', ...(s.zooms ?? []).map(z => `zoom x${z.scale} ${z.t_start_ms}-${z.t_end_ms}`)].filter(Boolean).join(', ');
  return `${s.id.padEnd(6)}${pad(s.t_start_ms, 8)}${pad(s.t_actions_end_ms, 9)}${pad(s.t_end_ms, 8)}${pad(s.audio_ms, 8)}${pad(s.t_end_ms - s.t_start_ms, 8)}  ${s.status}${extra ? '  [' + extra + ']' : ''}${s.error ? '  ' + s.error : ''}`;
}
