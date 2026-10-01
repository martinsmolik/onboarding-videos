// CDP screencast capture (Page.startScreencast) -> raw.mp4 whose timeline equals wall time.
//
// Every frame carries metadata.timestamp (seconds, browser clock). Frames only arrive on repaint,
// so the video is built with the ffmpeg concat demuxer where each frame lasts until the next one
// (duration = next.ts - this.ts) – idle periods simply hold the last frame – and the final frame
// is held until the recording end. `-fps_mode cfr -r 30` then resamples that VFR timeline to CFR.
// Result: video t = frame.ts - t0 exactly, with t0 = first frame timestamp.
//
// Step timestamps are taken with Date.now(); `wallToTs` maps them into the screencast clock using
// offset = min over frames of (receipt wall time - frame timestamp)  (the smallest observed delivery
// latency; any constant clock difference cancels out).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CDPSession } from 'playwright';

const execFileP = promisify(execFile);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)));

export interface Frame { file: string; ts: number }
export const SCREENCAST_FPS = 30;

/**
 * ffconcat script: each frame shown for (next.ts - ts); the last one until endTs.
 * Frames with non-increasing timestamps are dropped (the later one replaces them instantly).
 * `option framerate 1000` gives every image a 1 ms time base – the image2 default (1/25 s) would
 * quantize every frame start to 40 ms. The last image is listed twice, the second time starting
 * one output frame before endTs: the concat demuxer ignores the final entry's duration and
 * `-fps_mode cfr` only fills gaps *between* packets, so this is what makes the hold reach endTs.
 */
export function concatScript(frames: Frame[], endTs: number, fps = SCREENCAST_FPS): { text: string; totalSec: number; used: number } {
  const fr = frames.filter((f, i) => i === frames.length - 1 || frames[i + 1].ts > f.ts);
  if (!fr.length) throw new Error('screencast: no frames');
  const lines = ['ffconcat version 1.0'];
  const entry = (file: string, dur: number) => lines.push(`file '${path.basename(file)}'`, 'option framerate 1000', `duration ${dur.toFixed(6)}`);
  const t0 = fr[0].ts;
  const last = fr[fr.length - 1];
  const end = Math.max(endTs, last.ts + 1 / fps);
  for (let i = 0; i < fr.length - 1; i++) entry(fr[i].file, fr[i + 1].ts - fr[i].ts);
  const hold = end - last.ts;
  if (hold > 2 / fps) { entry(last.file, hold - 1 / fps); entry(last.file, 1 / fps); }
  else entry(last.file, hold);
  return { text: lines.join('\n') + '\n', totalSec: end - t0, used: fr.length };
}

export class ScreencastCapture {
  readonly frames: Frame[] = [];
  private offset = Infinity;      // wallSec - frameTs (min latency)
  private maxOffset = -Infinity;
  private writes: Promise<void>[] = [];
  private n = 0;
  private running = false;
  private handler = (ev: { data: string; metadata: { timestamp?: number }; sessionId: number }) => this.onFrame(ev);

  constructor(private cdp: CDPSession, private dir: string, private size: { width: number; height: number }, private log: (l: string) => void) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }

  private onFrame(ev: { data: string; metadata: { timestamp?: number }; sessionId: number }): void {
    // ack first so Chromium can produce the next frame while we write this one
    this.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
    if (!this.running) return;
    const wall = Date.now() / 1000;
    const ts = typeof ev.metadata?.timestamp === 'number' ? ev.metadata.timestamp : wall;
    const off = wall - ts;
    if (off < this.offset) this.offset = off;
    if (off > this.maxOffset) this.maxOffset = off;
    const file = path.join(this.dir, `f${String(++this.n).padStart(6, '0')}.jpg`);
    this.frames.push({ file, ts });
    this.writes.push(fs.promises.writeFile(file, Buffer.from(ev.data, 'base64')));
  }

  async start(): Promise<void> {
    this.running = true;
    this.cdp.on('Page.screencastFrame', this.handler);
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 90, maxWidth: this.size.width, maxHeight: this.size.height, everyNthFrame: 1
    });
  }

  /** Resolves once at least one frame arrived (or after timeoutMs). */
  async waitFirstFrame(timeoutMs = 3000, nudge?: () => Promise<void>): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    let nudged = false;
    while (!this.frames.length && Date.now() < end) {
      if (!nudged && nudge && Date.now() > end - timeoutMs / 2) { nudged = true; await nudge().catch(() => {}); }
      await sleep(20);
    }
    return this.frames.length > 0;
  }

  get t0(): number { return this.frames.length ? this.frames[0].ts : NaN; }
  /** Wall-clock ms (Date.now()) -> screencast clock (seconds). */
  wallToTs(wallMs: number): number { return wallMs / 1000 - (Number.isFinite(this.offset) ? this.offset : 0); }
  /** Wall-clock ms -> video ms (t=0 = first frame). */
  wallToVideoMs(wallMs: number): number { return Math.round((this.wallToTs(wallMs) - this.t0) * 1000); }
  /** Delivery latency spread (max - min offset) in ms – a sanity number for the log. */
  get latencySpreadMs(): number { return Number.isFinite(this.offset) ? Math.round((this.maxOffset - this.offset) * 1000) : 0; }
  get minLatencyMs(): number { return Number.isFinite(this.offset) ? Math.round(this.offset * 1000) : 0; }

  async stop(): Promise<void> {
    this.running = false;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    this.cdp.off('Page.screencastFrame', this.handler);
    await Promise.all(this.writes);
  }

  /** Encode frames (up to endTs, screencast clock) into an H.264 CFR mp4 of exactly the content size. */
  async encode(outFile: string, endTs: number): Promise<{ frames: number; totalSec: number }> {
    const frames = this.frames.filter(f => f.ts <= endTs);
    const { text, totalSec, used } = concatScript(frames, endTs);
    const list = path.join(this.dir, 'frames.ffconcat');
    fs.writeFileSync(list, text);
    fs.writeFileSync(path.join(this.dir, 'frames.json'), JSON.stringify(frames.map(f => ({ file: path.basename(f.file), ts: f.ts }))));
    const { width: W, height: H } = this.size;
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,format=yuv420p`;
    const fpsMode = await supportsFpsMode() ? ['-fps_mode', 'cfr'] : ['-vsync', 'cfr'];
    await execFileP('ffmpeg', [
      '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', vf, ...fpsMode, '-r', String(SCREENCAST_FPS),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-t', totalSec.toFixed(3), '-movflags', '+faststart', outFile
    ], { cwd: this.dir, maxBuffer: 16 * 1024 * 1024 });
    this.log(`screencast: ${this.frames.length} frames received, ${used} used, ${totalSec.toFixed(2)} s, delivery latency min ${this.minLatencyMs} ms / spread ${this.latencySpreadMs} ms`);
    return { frames: used, totalSec };
  }
}

let fpsModeCache: boolean | null = null;
async function supportsFpsMode(): Promise<boolean> {
  if (fpsModeCache !== null) return fpsModeCache;
  try {
    const { stdout } = await execFileP('ffmpeg', ['-hide_banner', '-h', 'long'], { maxBuffer: 8 * 1024 * 1024 });
    fpsModeCache = stdout.includes('-fps_mode');
  } catch { fpsModeCache = false; }
  return fpsModeCache;
}
