import fs from "node:fs";
import path from "node:path";
import { cuesForStep, toSrt, type Cue } from "./srt.js";
import { probeDurationMs, readJson, resolvePath, run } from "./util.js";

export interface MuxOptions {
  out: string;
  subtitles?: "burn" | "sidecar" | "none";
  bgm?: string;
  bgmVolume?: number;
  log?: (m: string) => void;
}
export interface MuxResult {
  finalPath: string;
  srtPath?: string;
  totalMs: number;
  stepsWithAudio: number;
  warnings: string[];
  ffmpegArgs: string[];
}

export async function mux(opts: MuxOptions): Promise<MuxResult> {
  const log = opts.log ?? ((m) => console.log(m));
  const out = resolvePath(opts.out);
  const subs = opts.subtitles ?? "sidecar";
  const timing = readJson(path.join(out, "timing.json"));
  const durations: Record<string, number> = readJson(path.join(out, "audio", "durations.json"));
  const rawCandidates = [timing.video_path && path.resolve(out, path.basename(timing.video_path)), timing.video_path && path.resolve(process.env.INIT_CWD || process.cwd(), timing.video_path), path.join(out, "raw.webm")].filter(Boolean) as string[];
  const raw = rawCandidates.find((p) => fs.existsSync(p));
  if (!raw) throw new Error(`raw video not found (tried ${rawCandidates.join(", ")})`);
  const totalMs: number = timing.total_ms;
  const warnings: string[] = [];

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

  // --- SRT ---
  let srtPath: string | undefined;
  if (subs !== "none") {
    const recipeF = [path.join(out, "recipe.json")].find((f) => fs.existsSync(f));
    const cues: Cue[] = [];
    const texts: Record<string, string> = {};
    for (const it of items) {
      const txtF = path.join(out, "audio", `${it.id}.txt`);
      texts[it.id] = fs.existsSync(txtF) ? fs.readFileSync(txtF, "utf8") : "";
      const alF = path.join(out, "audio", "alignment", `${it.id}.json`);
      if (!texts[it.id] || !fs.existsSync(alF)) { warnings.push(`no text/alignment for ${it.id}, no subtitle`); continue; }
      cues.push(...cuesForStep(it.t, texts[it.id], readJson(alF)));
    }
    void recipeF;
    cues.sort((a, b) => a.startMs - b.startMs);
    srtPath = path.join(out, "final.srt");
    fs.writeFileSync(srtPath, toSrt(cues));
  }

  // --- ffmpeg ---
  const total = (totalMs / 1000).toFixed(3);
  const args: string[] = ["-y", "-v", "error", "-stats", "-i", raw];
  items.forEach((it) => args.push("-i", it.file));
  let bgmIdx = -1;
  if (opts.bgm) { bgmIdx = items.length + 1; args.push("-stream_loop", "-1", "-i", resolvePath(opts.bgm)); }

  const f: string[] = [];
  const labels: string[] = [];
  items.forEach((it, i) => {
    // adelay with both channels; mono mp3 -> upmix to stereo first so "t|t" is valid for any layout
    f.push(`[${i + 1}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${it.t}|${it.t}[a${i}]`);
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
  let vf = "";
  if (subs === "burn" && srtPath) {
    // libass scales style sizes from the SRT's implicit 384x288 PlayRes, so FontSize 22 / MarginV 40 are resolution independent (~8% / ~14% of height).
    const style = "FontName=DejaVu Sans,FontSize=22,Outline=1,Shadow=0,MarginV=40,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Alignment=2";
    vf = `[0:v]subtitles=filename=final.srt:force_style='${style}'[vout]`;
    f.push(vf);
  }
  const videoMap = vf ? "[vout]" : "0:v";
  args.push("-filter_complex", f.join(";"), "-map", videoMap, "-map", audioOut,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-t", total, "-movflags", "+faststart", path.join(out, "final.mp4"));

  warnings.forEach((w) => log(`[mux] WARNING: ${w}`));
  log(`[mux] ffmpeg: ${items.length} narration tracks${opts.bgm ? " + bgm" : ""}, subtitles=${subs}`);
  // cwd=out so the subtitles filter can use a relative filename (no path escaping issues)
  await run("ffmpeg", args, { cwd: out });

  const finalPath = path.join(out, "final.mp4");
  const finalMs = await probeDurationMs(finalPath);
  log(`[mux] done: ${finalPath}\n[mux] total ${(finalMs / 1000).toFixed(2)}s, steps with audio: ${items.length}, warnings: ${warnings.length}`);
  return { finalPath, srtPath, totalMs: finalMs, stepsWithAudio: items.length, warnings, ffmpegArgs: args };
}
