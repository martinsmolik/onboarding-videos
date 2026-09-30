import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import type { Action, Recipe, RunOptions, RunResult, Step, Timing, TimingStep } from './types.js';
import { BEACON_PX, BEACON_STRIP_PX, CURSOR_INIT_SCRIPT, HIGHLIGHT_FN } from './cursor.js';
import { login, shouldLogin } from './login.js';

export type { RunOptions, RunResult, Recipe, Timing, TimingStep } from './types.js';

const execFileP = promisify(execFile);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)));

// ---------------------------------------------------------------- defaults
const DEFAULT_BEFORE_MS = 300;
const DEFAULT_HOLD_MS = 800;
// 80 ms (= 2 video frames at 25 fps) keeps typing frame-exact; 60 ms would stretch the video by ~33 % while typing.
const DEFAULT_TYPE_DELAY_MS = 80;
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
      if (!Array.isArray(s.actions)) errs.push(`${s.id}: actions must be an array`);
    }
  }
  if (errs.length) throw new Error('recipe invalid: ' + errs.join('; '));
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
class Recorder {
  private cursor = { x: 0, y: 0 };
  private beaconK = 0;
  private t0 = 0;

  constructor(private page: Page, private viewport: { width: number; height: number }, private log: (l: string) => void) {
    this.cursor = { x: Math.round(viewport.width / 2), y: Math.round(viewport.height / 2) };
    // Re-place the overlay after every full navigation (init script re-creates it fresh at 50/50).
    page.on('load', () => { void this.reinjectCursor(); });
  }

  start(): void { this.t0 = Date.now(); }
  now(): number { return Date.now() - this.t0; }

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

  private async elementCenter(selector: string): Promise<{ x: number; y: number; loc: Locator }> {
    const loc = this.locator(selector);
    await loc.waitFor({ state: 'visible', timeout: LOCATOR_TIMEOUT_MS });
    await loc.scrollIntoViewIfNeeded({ timeout: LOCATOR_TIMEOUT_MS });
    const box = await loc.boundingBox();
    if (!box) throw new Error(`no bounding box for ${selector}`);
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), loc };
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
        await loc.pressSequentially(a.value ?? '', { delay: a.delay_ms ?? DEFAULT_TYPE_DELAY_MS });
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
export async function run(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const recipe = loadRecipe(opts.recipe);
  const outDir = path.resolve(opts.out);
  const shotsDir = path.join(outDir, 'shots');
  const videoTmp = path.join(outDir, '.video-tmp');
  fs.mkdirSync(shotsDir, { recursive: true });
  fs.mkdirSync(videoTmp, { recursive: true });

  const durations = loadDurations(opts.durations ?? path.join(outDir, 'audio', 'durations.json'), log);
  const audioFor = (s: Step): number => {
    if (durations && Number.isFinite(durations[s.id])) return Math.round(durations[s.id]);
    const est = estimateAudioMs(s.narration);
    if (durations) log(`durations: no entry for ${s.id} – estimated ${est} ms`);
    return est;
  };

  const { viewport } = recipe;
  const recordSize = { width: viewport.width, height: viewport.height + BEACON_STRIP_PX };
  const browser: Browser = await chromium.launch({ headless: !opts.headed });
  let context: BrowserContext | null = null;
  let videoPathTmp: string | null = null;
  const timingSteps: TimingStep[] = [];
  let recorder: Recorder | null = null;

  try {
    const storageState =
      recipe.start.storage_state && fs.existsSync(recipe.start.storage_state) ? recipe.start.storage_state : undefined;
    if (recipe.start.storage_state && !storageState) log(`storage_state ${recipe.start.storage_state} not found – ignoring`);

    // The browser viewport is BEACON_STRIP_PX taller than the recipe viewport: the extra
    // bottom rows hold an opaque strip with the sync beacon, which the assembler crops away
    // (timing.beacon_strip_px). Page content therefore never has to share pixels with the beacon.
    context = await browser.newContext({
      viewport: recordSize,
      deviceScaleFactor: 1,
      locale: recipe.lang === 'en' ? 'en-US' : recipe.lang === 'sk' ? 'sk-SK' : 'cs-CZ',
      storageState,
      recordVideo: { dir: videoTmp, size: recordSize }
    });
    await context.addInitScript(CURSOR_INIT_SCRIPT);

    const page = await context.newPage();
    recorder = new Recorder(page, viewport, log);
    recorder.start(); // t=0 ≈ first video frame (video starts with page creation)
    const video = page.video();

    if (!storageState && shouldLogin(recipe.start.url)) {
      await login(page, { url: recipe.start.url, user: process.env.SLONEEK_DEMO_USER!, pass: process.env.SLONEEK_DEMO_PASS!, log });
    }
    await page.goto(recipe.start.url, { waitUntil: 'load', timeout: 30_000 });
    await recorder.reinjectCursor();

    let aborted = false;
    for (const step of recipe.steps) {
      const audioMs = audioFor(step);
      const hold = step.hold_after_ms ?? DEFAULT_HOLD_MS;
      const shot = path.join(shotsDir, `${step.id}.png`);
      const rec: TimingStep = { id: step.id, t_start_ms: 0, t_actions_end_ms: 0, t_end_ms: 0, audio_ms: audioMs, status: 'ok', screenshot: shot };

      if (aborted) {
        rec.status = 'skipped';
        rec.t_start_ms = rec.t_actions_end_ms = rec.t_end_ms = recorder.now();
        delete rec.screenshot;
        timingSteps.push(rec);
        continue;
      }

      await recorder.setBeacon(timingSteps.length + 1);
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
        if (opts.strict) aborted = true;
      }

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
    steps: timingSteps
  };
  const timingPath = path.join(outDir, 'timing.json');
  fs.writeFileSync(timingPath, JSON.stringify(timing, null, 2));

  log('');
  log(fmtHeader());
  for (const s of timingSteps) log(fmtRow(s));
  log(`video: ${rawPath}  ${recordSize.width}x${recordSize.height} (content ${viewport.width}x${viewport.height} + ${BEACON_STRIP_PX} px beacon strip)  fps=${fps}  total=${totalMs} ms (last step end ${lastEnd} ms + ${TAIL_MS} ms tail => drift ${drift >= 0 ? '+' : ''}${drift} ms)`);
  log(`timing: ${timingPath}`);
  const failed = timingSteps.filter(s => s.status !== 'ok');
  if (failed.length) log(`${failed.length} step(s) not ok: ${failed.map(s => `${s.id}=${s.status}`).join(', ')}`);
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
  return `${s.id.padEnd(6)}${pad(s.t_start_ms, 8)}${pad(s.t_actions_end_ms, 9)}${pad(s.t_end_ms, 8)}${pad(s.audio_ms, 8)}${pad(s.t_end_ms - s.t_start_ms, 8)}  ${s.status}${s.error ? '  ' + s.error : ''}`;
}
