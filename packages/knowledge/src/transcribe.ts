import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Segment, log, run, srcDir, writeTranscript } from "./util.js";

export type Provider = "elevenlabs" | "openai" | "local";
export type TranscribeOptions = { out: string; provider?: Provider; language?: string; force?: boolean };

/** Group word-level timestamps (seconds) into sentence-ish segments. */
export function wordsToSegments(words: { text: string; start: number; end: number; type?: string }[]): Segment[] {
  const segs: Segment[] = [];
  let cur: { start: number; end: number; text: string } | undefined;
  const flush = () => {
    if (cur && cur.text.trim()) segs.push({ start_ms: Math.round(cur.start * 1000), end_ms: Math.round(cur.end * 1000), text: cur.text.replace(/\s+/g, " ").trim() });
    cur = undefined;
  };
  for (const w of words) {
    if (w.type === "audio_event") continue;
    if (cur && w.start - cur.end > 0.8) flush();
    if (!cur) cur = { start: w.start, end: w.end, text: "" };
    cur.text += w.text; // Scribe words include spacing tokens as type "spacing"
    if (w.type !== "spacing") cur.end = w.end;
    if (/[.!?…]$/.test(w.text.trim()) || (cur.end - cur.start > 12 && w.type !== "spacing")) flush();
  }
  flush();
  return segs;
}

async function elevenlabs(file: string, language?: string): Promise<Segment[]> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY missing (use --provider openai|local)");
  const form = new FormData();
  form.set("model_id", "scribe_v1");
  if (language) form.set("language_code", language);
  form.set("timestamps_granularity", "word");
  form.set("tag_audio_events", "false");
  form.set("file", new Blob([readFileSync(file)]), "audio.m4a");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { words?: { text: string; start: number; end: number; type?: string }[]; text?: string };
  if (j.words?.length) return wordsToSegments(j.words);
  return j.text ? [{ start_ms: 0, end_ms: 0, text: j.text }] : [];
}

async function openai(file: string, language?: string): Promise<Segment[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const form = new FormData();
  form.set("model", "whisper-1");
  form.set("response_format", "verbose_json");
  if (language) form.set("language", language);
  form.set("file", new Blob([readFileSync(file)]), "audio.m4a");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!res.ok) throw new Error(`OpenAI STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { segments?: { start: number; end: number; text: string }[]; text?: string };
  if (j.segments?.length) return j.segments.map((s) => ({ start_ms: Math.round(s.start * 1000), end_ms: Math.round(s.end * 1000), text: s.text.trim() }));
  return j.text ? [{ start_ms: 0, end_ms: 0, text: j.text }] : [];
}

async function local(file: string, language?: string): Promise<Segment[]> {
  const probe = await run("python3", ["-c", "import faster_whisper"]);
  if (probe.code !== 0) throw new Error("faster-whisper not installed (pip install faster-whisper; downloads a model on first use - not done automatically)");
  const code = `
import sys, json
from faster_whisper import WhisperModel
m = WhisperModel(sys.argv[3] if len(sys.argv) > 3 else "small", compute_type="int8")
segs, _ = m.transcribe(sys.argv[1], language=(sys.argv[2] or None))
print(json.dumps([{"start_ms": int(s.start*1000), "end_ms": int(s.end*1000), "text": s.text.strip()} for s in segs]))`;
  const r = await run("python3", ["-c", code, file, language ?? "", process.env.WHISPER_MODEL ?? "small"], { timeoutMs: 1800000 });
  if (r.code !== 0) throw new Error(`faster-whisper failed: ${r.stderr.slice(-300)}`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

export async function transcribe(opts: TranscribeOptions): Promise<Segment[]> {
  const dir = srcDir(opts.out);
  if (!opts.force && existsSync(join(dir, "transcript.json"))) {
    log("transcript.json already exists (e.g. from YouTube subtitles) - skipping STT; use --force to redo");
    return JSON.parse(readFileSync(join(dir, "transcript.json"), "utf8"));
  }
  const audio = join(dir, "audio.m4a");
  if (!existsSync(audio)) throw new Error(`${audio} not found - run ingest first`);
  const provider = opts.provider ?? "elevenlabs";
  const segs = provider === "elevenlabs" ? await elevenlabs(audio, opts.language) : provider === "openai" ? await openai(audio, opts.language) : await local(audio, opts.language);
  writeTranscript(opts.out, segs);
  log(`transcribed with ${provider}: ${segs.length} segments`);
  return segs;
}
