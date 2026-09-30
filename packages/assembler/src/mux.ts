import fs from "node:fs";
import path from "node:path";
import { cuesForStep, toSrt, type Cue } from "./srt.js";
import { probeDurationMs, probeVideoSize, readJson, resolvePath, run } from "./util.js";

export interface MuxOptions {
  out: string;
  subtitles?: "burn" | "sidecar" | "none";
  bgm?: string;
  bgmVolume?: number;
  /** Intro card (recipe.title + "Sloneek · onboarding"). Default: on when recipe.json has a title. */
  intro?: boolean;
  /** Outro card ("sloneek.com"). Default: same as intro. */
  outro?: boolean;
  log?: (m: string) => void;
}
export interface MuxResult {
  finalPath: string;
  srtPath?: string;
  totalMs: number;
  /** ms of intro card in front of the recording; every audio offset and SRT cue is shifted by this. */
  introMs: number;
  outroMs: number;
  stepsWithAudio: number;
  warnings: string[];
  ffmpegArgs: string[];
}

export const INTRO_MS = 2500;
export const OUTRO_MS = 2000;
const FADE_S = 0.4;
const OUT_FPS = 30;
const FONT_DIR = "/usr/share/fonts/truetype/dejavu";

/** ffmpeg colour syntax: accept "#1f2a44" / "1f2a44" / "0x1f2a44" / named. */
function ffColor(v: string | undefined, dflt: string): string {
  const s = (v || dflt).trim();
  if (/^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return "0x" + s.replace(/^#/, "");
  return s;
}
function fontArg(bold: boolean): string {
  const f = path.join(FONT_DIR, bold ? "DejaVuSans-Bold.ttf" : "DejaVuSans.ttf");
  return fs.existsSync(f) ? `fontfile=${f}` : `font=DejaVu Sans`;
}
/** Wrap a title to lines of <= max chars on word boundaries (drawtext honours newlines in textfile). */
export function wrapTitle(text: string, max = 34): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) { lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3).join("\n");
}

/**
 * Filter chain for a brand card: solid colour, title (+ subtitle), accent bar, fade in/out.
 * Text is read from files in `out` (relative names, cwd=out) so no drawtext escaping is needed.
 */
function cardFilter(w: number, h: number, durMs: number, bg: string, fg: string, titleFile: string, subFile: string | null, label: string): string {
  const d = (durMs / 1000).toFixed(3);
  const lines = fs.readFileSync(titleFile, "utf8").split("\n").length;
  const titleSize = Math.round(h * (lines > 1 ? 0.058 : 0.066));
  const subSize = Math.round(h * 0.028);
  const titleY = subFile ? `(h-text_h)/2-${Math.round(h * 0.045)}` : `(h-text_h)/2`;
  const parts = [
    `color=c=${bg}:s=${w}x${h}:r=${OUT_FPS}:d=${d}`,
    `drawtext=${fontArg(true)}:textfile=${path.basename(titleFile)}:fontsize=${titleSize}:fontcolor=${fg}:x=(w-text_w)/2:y=${titleY}:line_spacing=${Math.round(titleSize * 0.25)}:text_align=center`,
  ];
  if (subFile) {
    const barY = Math.round(h * 0.5 + h * 0.045 + titleSize * 0.35);
    parts.push(`drawbox=x=(iw-${Math.round(w * 0.04)})/2:y=${barY}:w=${Math.round(w * 0.04)}:h=${Math.max(3, Math.round(h * 0.004))}:color=${fg}@0.55:t=fill`);
    parts.push(`drawtext=${fontArg(false)}:textfile=${path.basename(subFile)}:fontsize=${subSize}:fontcolor=${fg}@0.85:x=(w-text_w)/2:y=${barY + Math.round(h * 0.03)}`);
  }
  parts.push(`fade=t=in:st=0:d=${FADE_S}`, `fade=t=out:st=${(durMs / 1000 - FADE_S).toFixed(3)}:d=${FADE_S}`, `format=yuv420p`, `setsar=1`);
  return parts.join(",") + `[${label}]`;
}

export async function mux(opts: MuxOptions): Promise<MuxResult> {
  const log = opts.log ?? ((m) => console.log(m));
  const out = resolvePath(opts.out);
  const subs = opts.subtitles ?? "sidecar";
  const timing = readJson(path.join(out, "timing.json"));
  const durations: Record<string, number> = readJson(path.join(out, "audio", "durations.json"));
  const recipeF = path.join(out, "recipe.json");
  const recipe: any = fs.existsSync(recipeF) ? readJson(recipeF) : {};
  const rawCandidates = [timing.video_path && path.resolve(out, path.basename(timing.video_path)), timing.video_path && path.resolve(process.env.INIT_CWD || process.cwd(), timing.video_path), path.join(out, "raw.webm")].filter(Boolean) as string[];
  const raw = rawCandidates.find((p) => fs.existsSync(p));
  if (!raw) throw new Error(`raw video not found (tried ${rawCandidates.join(", ")})`);
  const totalMs: number = timing.total_ms;
  const warnings: string[] = [];

  // --- geometry: raw.webm may carry an extra beacon strip below the content (timing.beacon_strip_px) ---
  const rawSize = await probeVideoSize(raw);
  const strip = Math.max(0, Number(timing.beacon_strip_px) || 0);
  const W = rawSize.width, H = rawSize.height - strip;
  if (recipe.viewport && (recipe.viewport.width !== W || recipe.viewport.height !== H))
    warnings.push(`raw video content is ${W}x${H} (raw ${rawSize.width}x${rawSize.height} - ${strip}px strip) but recipe.viewport is ${recipe.viewport.width}x${recipe.viewport.height}`);

  // --- intro / outro ---
  const title: string = typeof recipe.title === "string" ? recipe.title.trim() : "";
  const intro = opts.intro ?? !!title;
  const outro = opts.outro ?? intro;
  if (intro && !title) warnings.push("intro requested but recipe.json has no title - using recipe id");
  const introMs = intro ? INTRO_MS : 0;
  const outroMs = outro ? OUTRO_MS : 0;
  const BG = ffColor(process.env.BRAND_BG, "#1f2a44");
  const FG = ffColor(process.env.BRAND_FG, "#ffffff");

  const items: { id: string; file: string; t: number; audioMs: number; status: string }[] = [];
  for (const s of timing.steps as any[]) {
    const audioMs = durations[s.id] ?? 0;
    const file = path.join(out, "audio", `${s.id}.mp3`);
    if (!audioMs || !fs.existsSync(file)) continue;
    if (s.status === "skipped") { warnings.push(`step ${s.id} skipped in recording -> audio dropped`); continue; }
    if (s.status === "failed") warnings.push(`step ${s.id} has status=failed in timing.json (audio still placed) - re-record before publishing`);
    const real = await probeDurationMs(file);
    if (Math.abs(real - audioMs) > 100) warnings.push(`step ${s.id}: durations.json says ${audioMs}ms but mp3 is ${real}ms - rerun tts`);
    if (s.audio_ms && Math.abs(s.audio_ms - real) > 100) warnings.push(`step ${s.id}: recorder paced against ${s.audio_ms}ms but mp3 is ${real}ms (stale durations.json at record time?)`);
    if (s.t_start_ms + real > totalMs + 200) warnings.push(`DRIFT step ${s.id}: t_start ${s.t_start_ms} + audio ${real} = ${s.t_start_ms + real}ms > video total ${totalMs}ms (+200 tolerance) - audio will be cut`);
    items.push({ id: s.id, file, t: s.t_start_ms, audioMs: real, status: s.status });
  }
  // overlap between consecutive narrations
  const sorted = [...items].sort((a, b) => a.t - b.t);
  for (let i = 0; i < sorted.length - 1; i++)
    if (sorted[i].t + sorted[i].audioMs > sorted[i + 1].t + 50)
      warnings.push(`OVERLAP: step ${sorted[i].id} audio ends ${sorted[i].t + sorted[i].audioMs}ms but ${sorted[i + 1].id} starts ${sorted[i + 1].t}ms`);

  // --- SRT (cues in FINAL time = recording time + intro) ---
  let srtPath: string | undefined;
  if (subs !== "none") {
    const cues: Cue[] = [];
    for (const it of items) {
      const txtF = path.join(out, "audio", `${it.id}.txt`);
      const text = fs.existsSync(txtF) ? fs.readFileSync(txtF, "utf8") : "";
      const alF = path.join(out, "audio", "alignment", `${it.id}.json`);
      if (!text || !fs.existsSync(alF)) { warnings.push(`no text/alignment for ${it.id}, no subtitle`); continue; }
      cues.push(...cuesForStep(it.t + introMs, text, readJson(alF)));
    }
    cues.sort((a, b) => a.startMs - b.startMs);
    srtPath = path.join(out, "final.srt");
    fs.writeFileSync(srtPath, toSrt(cues));
  }

  // --- ffmpeg ---
  const finalMsPlanned = introMs + totalMs + outroMs;
  const total = (finalMsPlanned / 1000).toFixed(3);
  const args: string[] = ["-y", "-v", "error", "-stats", "-i", raw];
  items.forEach((it) => args.push("-i", it.file));
  let bgmIdx = -1;
  if (opts.bgm) { bgmIdx = items.length + 1; args.push("-stream_loop", "-1", "-i", resolvePath(opts.bgm)); }

  const f: string[] = [];
  const labels: string[] = [];
  items.forEach((it, i) => {
    // adelay with both channels; mono mp3 -> upmix to stereo first so "t|t" is valid for any layout
    const t = it.t + introMs;
    f.push(`[${i + 1}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${t}|${t}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  if (bgmIdx >= 0) {
    f.push(`[${bgmIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${opts.bgmVolume ?? 0.08}[bgm]`);
    labels.push("[bgm]");
  }
  let audioOut: string;
  if (labels.length === 0) {
    f.push(`anullsrc=r=44100:cl=stereo,atrim=0:${total}[aout]`);
    audioOut = "[aout]";
  } else {
    // normalize=0: plain sum (no 1/N attenuation). Narration clips never overlap, so no clipping; alimiter is a safety net.
    f.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0,apad=whole_dur=${total},atrim=0:${total},alimiter=limit=0.95[aout]`);
    audioOut = "[aout]";
  }

  // video: crop the beacon strip, normalise fps/pixfmt, then (optionally) wrap in intro/outro cards
  const mainChain = [strip > 0 ? `crop=${W}:${H}:0:0` : null, `fps=${OUT_FPS}`, `format=yuv420p`, `setsar=1`,
    intro ? `fade=t=in:st=0:d=0.3` : null, outro ? `fade=t=out:st=${Math.max(0, totalMs / 1000 - 0.3).toFixed(3)}:d=0.3` : null].filter(Boolean).join(",");
  f.push(`[0:v]${mainChain}[vmain]`);
  const cardFiles: string[] = [];
  const segs: string[] = [];
  if (intro) {
    const tf = path.join(out, ".card-intro-title.txt"), sf = path.join(out, ".card-intro-sub.txt");
    fs.writeFileSync(tf, wrapTitle(title || String(recipe.id || timing.recipe_id || "Sloneek")));
    fs.writeFileSync(sf, "Sloneek · onboarding");
    cardFiles.push(tf, sf);
    f.push(cardFilter(W, H, introMs, BG, FG, tf, sf, "vintro"));
    segs.push("[vintro]");
  }
  segs.push("[vmain]");
  if (outro) {
    const tf = path.join(out, ".card-outro-title.txt");
    fs.writeFileSync(tf, "sloneek.com");
    cardFiles.push(tf);
    f.push(cardFilter(W, H, outroMs, BG, FG, tf, null, "voutro"));
    segs.push("[voutro]");
  }
  let vlabel = "[vmain]";
  if (segs.length > 1) { f.push(`${segs.join("")}concat=n=${segs.length}:v=1:a=0[vcat]`); vlabel = "[vcat]"; }
  if (subs === "burn" && srtPath) {
    // libass scales style sizes from the SRT's implicit 384x288 PlayRes, so FontSize 22 / MarginV 40 are resolution independent (~8% / ~14% of height).
    const style = "FontName=DejaVu Sans,FontSize=22,Outline=1,Shadow=0,MarginV=40,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Alignment=2";
    f.push(`${vlabel}subtitles=filename=final.srt:force_style='${style}'[vout]`);
    vlabel = "[vout]";
  }
  args.push("-filter_complex", f.join(";"), "-map", vlabel, "-map", audioOut,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(OUT_FPS),
    "-c:a", "aac", "-b:a", "160k", "-t", total, "-movflags", "+faststart", path.join(out, "final.mp4"));

  warnings.forEach((w) => log(`[mux] WARNING: ${w}`));
  log(`[mux] video ${W}x${H}${strip ? ` (cropped ${strip}px beacon strip)` : ""}, intro=${intro ? INTRO_MS + "ms" : "off"}, outro=${outro ? OUTRO_MS + "ms" : "off"}`);
  log(`[mux] ffmpeg: ${items.length} narration tracks${opts.bgm ? " + bgm" : ""} (offset +${introMs}ms), subtitles=${subs}`);
  // cwd=out so the subtitles/drawtext filters can use relative filenames (no path escaping issues)
  try {
    await run("ffmpeg", args, { cwd: out });
  } finally {
    cardFiles.forEach((c) => fs.rmSync(c, { force: true }));
  }

  const finalPath = path.join(out, "final.mp4");
  const finalMs = await probeDurationMs(finalPath);
  log(`[mux] done: ${finalPath}\n[mux] total ${(finalMs / 1000).toFixed(2)}s (${introMs} + ${totalMs} + ${outroMs} ms planned), steps with audio: ${items.length}, warnings: ${warnings.length}`);
  return { finalPath, srtPath, totalMs: finalMs, introMs, outroMs, stepsWithAudio: items.length, warnings, ffmpegArgs: args };
}
