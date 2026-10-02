// provider "external": narration audio is produced OUTSIDE this pipeline (Claude via the ElevenLabs
// connector, a human with a mic, ...). The assembler never synthesizes; it
//   1. writes audio/manifest.json = the to-do list (step id, narration, expected file name),
//   2. accepts audio/<stepId>.mp3 (or .wav / .m4a -> transcoded to 44.1 kHz mp3),
//   3. measures every file with ffprobe -> audio/durations.json,
//   4. keeps a supplied audio/alignment/<stepId>.json (ElevenLabs with-timestamps format) or writes a
//      linear one over the measured duration (for SRT cues).
//
// The text to voice is step.narration_tts ?? step.narration ("tts text"); step.subtitle ?? narration is
// only listed for orientation (it goes to the SRT, never to the voice).
//
// Bookkeeping per accepted step: audio/<id>.txt (tts text the file was accepted for) and
// audio/<id>.meta.json ({provider:"external", source, alignment:"external"|"linear"}).
// A file is STALE (= treated as missing) when the narration changed and the audio file is not newer
// than the .txt written when it was accepted. An mp3 that another provider synthesized
// (<id>.meta.json provider != external, not replaced since) is never accepted as external audio.
import fs from "node:fs";
import path from "node:path";
import type { Alignment } from "./tts.js";
import { probeDurationMs, readJson, run } from "./util.js";
import { subtitleText } from "./parts.js";
import { spokenTextFor } from "./pronunciation.js";

export const EXTERNAL_EXTS = [".mp3", ".wav", ".m4a"] as const;

export type ManifestStatus = "present" | "missing" | "stale" | "foreign";
export interface ManifestStep {
  id: string;
  /** EXACT text to synthesize (step.narration_tts ?? step.narration) */
  tts_text: string;
  /** text the viewer reads in final.srt (step.subtitle ?? step.narration) – never sent to the voice */
  subtitle: string;
  /** deprecated alias of tts_text (older prompts say "generate speech for narration") */
  narration: string;
  /** file name Claude must write, relative to audio/ (always .mp3; .wav/.m4a are accepted too) */
  file: string;
  /** absolute path of that file */
  path: string;
  /** optional ElevenLabs with-timestamps alignment, relative to audio/ */
  alignment_file: string;
  chars: number;
  status: ManifestStatus;
  /** why it is not usable (stale/foreign) */
  reason?: string;
  duration_ms?: number;
}
export interface Manifest {
  recipe_id: string;
  title?: string;
  lang?: string;
  provider: "external";
  audio_dir: string;
  format: string;
  voice: { voice_id?: string; model_id?: string; language_code?: string };
  generated_at: string;
  instructions: string;
  steps: ManifestStep[];
  silent_steps: string[];
  missing: string[];
  total_chars: number;
}

const mtime = (f: string) => fs.statSync(f).mtimeMs;

/** Pick the newest existing audio/<id>.{mp3,wav,m4a}. */
export function findExternalAudio(audioDir: string, id: string): string | null {
  const found = EXTERNAL_EXTS.map((e) => path.join(audioDir, id + e)).filter((f) => fs.existsSync(f) && fs.statSync(f).size > 0);
  if (!found.length) return null;
  return found.sort((a, b) => mtime(b) - mtime(a))[0];
}

/** Classify one step's supplied audio without touching anything. */
export function classifyStep(audioDir: string, id: string, text: string): { status: ManifestStatus; file: string | null; reason?: string } {
  const file = findExternalAudio(audioDir, id);
  if (!file) return { status: "missing", file: null };
  const txtF = path.join(audioDir, `${id}.txt`);
  const metaF = path.join(audioDir, `${id}.meta.json`);
  let meta: any = null;
  try { meta = fs.existsSync(metaF) ? readJson(metaF) : null; } catch { meta = null; }
  if (meta && meta.provider && meta.provider !== "external" && mtime(file) <= mtime(metaF) + 1) {
    return { status: "foreign", file, reason: `${path.basename(file)} was synthesized by provider "${meta.provider}", not supplied externally - delete it or overwrite it with the real voiceover` };
  }
  if (fs.existsSync(txtF) && fs.readFileSync(txtF, "utf8") !== text && mtime(file) <= mtime(txtF) + 1) {
    return { status: "stale", file, reason: `tts text (narration_tts ?? narration) changed since ${path.basename(file)} was accepted - regenerate it` };
  }
  return { status: "present", file };
}

/** ElevenLabs with-timestamps response or bare alignment -> Alignment, or null when unusable. */
export function parseAlignment(j: any): Alignment | null {
  const a = j?.alignment ?? j?.normalized_alignment ?? j;
  if (!a || !Array.isArray(a.characters) || !Array.isArray(a.character_start_times_seconds) || !Array.isArray(a.character_end_times_seconds)) return null;
  const n = a.characters.length;
  if (!n || a.character_start_times_seconds.length !== n || a.character_end_times_seconds.length !== n) return null;
  return { characters: a.characters, character_start_times_seconds: a.character_start_times_seconds, character_end_times_seconds: a.character_end_times_seconds };
}

const INSTRUCTIONS =
  "For every entry in steps[] with status != present: generate speech for `tts_text` (exact text - numbers/acronyms are already spelled out; " +
  "`subtitle` is only what the viewer reads, never voice it) with the ElevenLabs connector " +
  "(voice/model below if set, mp3_44100_128) and save it as audio/<file>. Optionally save the with-timestamps alignment " +
  "({characters, character_start_times_seconds, character_end_times_seconds}) as audio/<alignment_file> for exact subtitles. " +
  "Then re-run `assembler tts` (or `pnpm local`); it only measures the files.";

export function buildManifest(recipe: any, out: string): Manifest {
  const audioDir = path.join(out, "audio");
  const steps: ManifestStep[] = [];
  const silent: string[] = [];
  const ttsText = spokenTextFor(recipe); // narration_tts ?? narration + config/pronunciation.json
  for (const s of recipe.steps as { id: string; narration: string; narration_tts?: string; subtitle?: string }[]) {
    const text = ttsText(s);
    if (!text) { silent.push(s.id); continue; }
    const c = classifyStep(audioDir, s.id, text);
    steps.push({
      id: s.id, tts_text: text, subtitle: subtitleText(s), narration: text, file: `${s.id}.mp3`, path: path.join(audioDir, `${s.id}.mp3`), alignment_file: `alignment/${s.id}.json`,
      chars: [...text].length, status: c.status, ...(c.reason ? { reason: c.reason } : {}),
    });
  }
  return {
    recipe_id: recipe.id, title: recipe.title, lang: recipe.lang, provider: "external", audio_dir: audioDir,
    format: "mp3, 44.1 kHz (ElevenLabs output_format mp3_44100_128); .wav/.m4a accepted and transcoded",
    voice: { voice_id: recipe.voice?.voice_id, model_id: recipe.voice?.model_id, language_code: recipe.voice?.language_code ?? recipe.lang },
    generated_at: new Date().toISOString(), instructions: INSTRUCTIONS,
    steps, silent_steps: silent, missing: steps.filter((s) => s.status !== "present").map((s) => s.id),
    total_chars: steps.reduce((n, s) => n + s.chars, 0),
  };
}

export function writeManifest(recipe: any, out: string): { manifest: Manifest; file: string } {
  const audioDir = path.join(out, "audio");
  fs.mkdirSync(path.join(audioDir, "alignment"), { recursive: true });
  const manifest = buildManifest(recipe, out);
  const file = path.join(audioDir, "manifest.json");
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return { manifest, file };
}

export function missingReport(m: Manifest): string {
  const bad = m.steps.filter((s) => s.status !== "present");
  return [
    `provider=external: ${bad.length} of ${m.steps.length} narrated step(s) have no usable audio in ${m.audio_dir}:`,
    ...bad.map((s) => `  - ${s.file}  [${s.status}]${s.reason ? ` ${s.reason}` : ""}\n      "${s.tts_text.length > 90 ? s.tts_text.slice(0, 87) + "..." : s.tts_text}"`),
    `to-do list: ${path.join(m.audio_dir, "manifest.json")} (generate the voiceover, save as above, re-run)`,
  ].join("\n");
}

/** Transcode wav/m4a (or any non-mp3) to 44.1 kHz mp3 next to it. */
async function toMp3(src: string, mp3: string): Promise<void> {
  const tmp = mp3 + ".tmp.mp3";
  await run("ffmpeg", ["-y", "-v", "error", "-i", src, "-vn", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", tmp]);
  fs.renameSync(tmp, mp3);
}

export interface ExternalResult { durations: Record<string, number>; accepted: string[]; transcoded: string[]; alignedExternal: string[] }

/**
 * Accept the externally supplied files. Throws with the full missing list (after writing the manifest)
 * when any narrated step has no usable audio.
 */
export async function acceptExternal(recipe: any, out: string, linear: (text: string, durSec: number) => Alignment, log: (m: string) => void): Promise<ExternalResult> {
  const audioDir = path.join(out, "audio");
  const alignDir = path.join(audioDir, "alignment");
  const { manifest, file } = writeManifest(recipe, out);
  log(`[tts] provider=external - manifest ${file} (${manifest.steps.length} narrated, ${manifest.silent_steps.length} silent, ${manifest.total_chars} chars)`);
  if (manifest.missing.length) throw new Error(missingReport(manifest));

  const durations: Record<string, number> = {};
  const accepted: string[] = [], transcoded: string[] = [], alignedExternal: string[] = [];
  const byId = new Map(manifest.steps.map((s) => [s.id, s]));
  const ttsText = spokenTextFor(recipe);
  for (const step of recipe.steps as { id: string; narration: string; narration_tts?: string }[]) {
    const id = step.id;
    const text = ttsText(step);
    const mp3 = path.join(audioDir, `${id}.mp3`);
    const txtF = path.join(audioDir, `${id}.txt`);
    const metaF = path.join(audioDir, `${id}.meta.json`);
    const alF = path.join(alignDir, `${id}.json`);
    if (!text) {
      for (const f of [mp3, txtF, metaF, alF, ...EXTERNAL_EXTS.map((e) => path.join(audioDir, id + e))]) fs.rmSync(f, { force: true });
      durations[id] = 0;
      continue;
    }
    const src = findExternalAudio(audioDir, id)!;
    if (path.extname(src).toLowerCase() !== ".mp3") { await toMp3(src, mp3); transcoded.push(`${path.basename(src)} -> ${id}.mp3`); }
    const ms = await probeDurationMs(mp3);
    if (ms < 200) throw new Error(`${mp3} is only ${ms} ms long - not a voiceover`);
    durations[id] = ms;
    byId.get(id)!.duration_ms = ms;

    // alignment: a supplied one (newer than our last bookkeeping) wins; ours is always re-derived (cheap)
    let prevMeta: any = null;
    try { prevMeta = fs.existsSync(metaF) ? readJson(metaF) : null; } catch { prevMeta = null; }
    let alignKind: "external" | "linear" = "linear";
    if (fs.existsSync(alF)) {
      // supplied = written by someone else after our last bookkeeping (or there is no bookkeeping yet)
      const supplied = !prevMeta || mtime(alF) > mtime(metaF);
      let parsed: Alignment | null = null;
      try { parsed = parseAlignment(readJson(alF)); } catch { parsed = null; }
      if (supplied && parsed) {
        alignKind = "external";
        fs.writeFileSync(alF, JSON.stringify(parsed)); // normalise a full with-timestamps response to the bare alignment
        alignedExternal.push(id);
        const end = parsed.character_end_times_seconds[parsed.character_end_times_seconds.length - 1] * 1000;
        if (Math.abs(end - ms) > 1500) log(`[tts] ${id}: alignment ends at ${Math.round(end)} ms but audio is ${ms} ms - is it the alignment of this file?`);
        if (parsed.characters.join("") !== text) log(`[tts] ${id}: alignment characters differ from the tts text - SRT maps them proportionally`);
      } else if (supplied && !parsed) log(`[tts] ${id}: ${alF} is not an ElevenLabs alignment - using linear alignment`);
    }
    if (alignKind === "linear") fs.writeFileSync(alF, JSON.stringify(linear(text, ms / 1000)));
    fs.writeFileSync(txtF, text);
    fs.writeFileSync(metaF, JSON.stringify({ provider: "external", source: path.basename(src), alignment: alignKind }));
    accepted.push(id);
  }
  // refresh the manifest with durations
  fs.writeFileSync(file, JSON.stringify({ ...manifest, steps: [...byId.values()] }, null, 2));
  return { durations, accepted, transcoded, alignedExternal };
}
