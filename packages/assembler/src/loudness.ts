// Per-clip loudness normalisation (EBU R128). ElevenLabs returns every step at a different level (measured on
// absence-cs: -19 to -32 LUFS, a 13 dB spread), so scenes jump in volume. mux measures each narration clip and
// gives it a static gain to the same integrated loudness – no compression, the voice keeps its dynamics; a
// per-clip true-peak limiter catches the few peaks a big gain pushes over -1 dBFS.
import fs from "node:fs";
import path from "node:path";
import { run } from "./util.js";

/** Spoken-word target (podcast / AES streaming practice); YouTube normalises down to -14, never up. */
export const DEFAULT_LUFS = -16;
/** Never boost a clip by more than this (a near-silent clip would otherwise turn into noise). */
export const MAX_GAIN_DB = 20;
export const PEAK_LIMIT = 0.891; // -1 dBFS

export interface ClipLoudness { lufs: number; peakDb: number }
export interface ClipGain { id: string; lufs: number; gainDb: number }

/** Integrated loudness + sample peak of one file (ffmpeg ebur128 summary). */
export async function measureLoudness(file: string): Promise<ClipLoudness> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=sample", "-f", "null", "-"]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const i = summary.match(/I:\s+(-?[\d.]+|-inf)\s+LUFS/);
  const p = summary.match(/Peak:\s+(-?[\d.]+|-inf)\s+dBFS/);
  if (!i) throw new Error(`ebur128: no integrated loudness for ${file}`);
  const num = (v: string | undefined) => (v === undefined || v === "-inf" ? -Infinity : Number(v));
  return { lufs: num(i[1]), peakDb: num(p?.[1]) };
}

/** Gain (dB) that brings `lufs` to `target`; 0 for silence, capped at MAX_GAIN_DB. */
export function gainFor(lufs: number, target: number): number {
  if (!Number.isFinite(lufs) || lufs < -70) return 0;
  return Math.round(Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, target - lufs)) * 100) / 100;
}

/**
 * Measure every clip (cached in audio/loudness.json by file size + mtime) and return the gain per clip id.
 * Measurement failures are reported and that clip is left untouched.
 */
export async function normalizeClips(audioDir: string, clips: { id: string; file: string }[], target: number, warn: (m: string) => void): Promise<ClipGain[]> {
  const cacheF = path.join(audioDir, "loudness.json");
  let cache: Record<string, ClipLoudness & { key: string }> = {};
  try { cache = JSON.parse(fs.readFileSync(cacheF, "utf8")); } catch { /* none yet */ }
  const res: ClipGain[] = [];
  for (const c of clips) {
    const st = fs.statSync(c.file);
    const key = `${path.basename(c.file)}:${st.size}:${Math.round(st.mtimeMs)}`;
    let m = cache[c.id]?.key === key ? cache[c.id] : undefined;
    if (!m) {
      try { m = { key, ...(await measureLoudness(c.file)) }; cache[c.id] = m; }
      catch (e: any) { warn(`loudness: ${c.id} not measured (${e.message}) - left as is`); continue; }
    }
    res.push({ id: c.id, lufs: m.lufs, gainDb: gainFor(m.lufs, target) });
  }
  try { fs.writeFileSync(cacheF, JSON.stringify(cache, null, 1)); } catch { /* read-only out dir is fine */ }
  return res;
}

/** ffmpeg filter fragment for one clip: static gain + true-peak safety limiter ("" when no change is needed). */
export function gainFilter(gainDb: number): string {
  if (!gainDb) return "";
  return `,volume=${gainDb.toFixed(2)}dB` + (gainDb > 0 ? `,alimiter=limit=${PEAK_LIMIT}:level=0:attack=2:release=40` : "");
}
