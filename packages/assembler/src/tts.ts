import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { probeDurationMs, readJson, resolvePath, run, which } from "./util.js";
import { acceptExternal } from "./external.js";
import { ttsText } from "./parts.js";

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}
export type Provider = "elevenlabs" | "external" | "say" | "espeak" | "mock";
export interface TtsOptions {
  recipe: string;            // path to recipe.json
  out: string;               // out/<id>
  provider?: Provider;
  log?: (m: string) => void;
}
export interface TtsResult {
  durations: Record<string, number>;
  provider: Provider;
  synthesized: string[];
  cached: string[];
  chars: number;             // characters actually sent to the provider
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function elevenlabs(text: string, voiceId: string, modelId: string, apiKey: string): Promise<{ mp3: Buffer; alignment: Alignment }> {
  // output_format is a QUERY parameter in the ElevenLabs API (not a body field).
  const url = `${process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io"}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s, 4s
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ text, model_id: modelId }),
      });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`ElevenLabs HTTP ${res.status}: ${await res.text()}`); continue; }
      if (!res.ok) throw Object.assign(new Error(`ElevenLabs HTTP ${res.status}: ${await res.text()}`), { fatal: true });
      const j: any = await res.json();
      if (!j.audio_base64) throw Object.assign(new Error("ElevenLabs response has no audio_base64"), { fatal: true });
      // prefer `alignment` (matches input text 1:1); fall back to normalized_alignment
      const alignment: Alignment = j.alignment ?? j.normalized_alignment;
      return { mp3: Buffer.from(j.audio_base64, "base64"), alignment };
    } catch (e: any) {
      if (e?.fatal) throw e;
      lastErr = e; // network error -> retry
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Quiet 220 Hz tone of the right length + linear char alignment. */
async function mock(text: string, mp3Path: string): Promise<Alignment> {
  const ms = Math.max(1500, Math.round((text.length / 14) * 1000));
  await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100", "-t", (ms / 1000).toFixed(3),
    "-af", "volume=0.25", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", mp3Path]);
  return linearAlignment(text, ms / 1000);
}

/** espeak-ng voice for a recipe language (all three ship with espeak-ng-data). */
export function espeakVoice(lang: string | undefined): string {
  const l = (lang || "cs").toLowerCase();
  if (l.startsWith("en")) return "en";
  if (l.startsWith("sk")) return "sk";
  return "cs";
}
export const ESPEAK_WPM = 150;

/**
 * Offline speech via espeak-ng (robotic but real, intelligible narration; no network, no billing).
 * Text goes through a file (`-f`), never through a shell, so narration cannot inject arguments.
 * espeak has no per-char timestamps, so the alignment is linear over the measured mp3 duration
 * (good enough for the <= 42-char subtitle cues).
 */
async function espeak(text: string, voice: string, mp3Path: string): Promise<Alignment> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svp-espeak-"));
  const txt = path.join(tmp, "text.txt");
  const wav = path.join(tmp, "out.wav");
  try {
    fs.writeFileSync(txt, text + "\n", "utf8");
    await run("espeak-ng", ["-v", voice, "-s", String(ESPEAK_WPM), "-f", txt, "-w", wav]);
    // 22.05 kHz mono wav -> 44.1 kHz mp3 (same container/rate as the other providers); the mild
    // high-shelf cut and normalisation take the edge off espeak's buzz without hiding the speech.
    await run("ffmpeg", ["-y", "-v", "error", "-i", wav, "-af", "highshelf=f=4000:g=-4,dynaudnorm=f=250:g=7,volume=0.9",
      "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", mp3Path]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const ms = await probeDurationMs(mp3Path);
  return linearAlignment(text, ms / 1000);
}

/** macOS `say` default voices per recipe language (all ship with macOS; "Enhanced"/"Premium" variants are optional downloads). */
export const SAY_DEFAULT_VOICE: Record<string, string> = { en: "Samantha", cs: "Zuzana", sk: "Laura" };
/** Words per minute. `say`'s own default is ~175-200; slightly slower reads better for tutorials. */
export const SAY_DEFAULT_RATE: Record<string, number> = { en: 180, cs: 170, sk: 170 };

const langKey = (lang: string | undefined) => {
  const l = (lang || "cs").toLowerCase();
  return l.startsWith("en") ? "en" : l.startsWith("sk") ? "sk" : "cs";
};

/**
 * Voice + rate for the `say` provider. Precedence: recipe.voice.voice_id (only when the recipe itself
 * asks for provider "say" – otherwise voice_id is an ElevenLabs id) > env SAY_VOICE > language default.
 * Rate: env SAY_RATE > language default.
 */
export function sayConfig(recipe: { lang?: string; voice?: { provider?: string; voice_id?: string } }, env: NodeJS.ProcessEnv = process.env): { voice: string; rate: number } {
  const k = langKey(recipe.lang);
  const recipeVoice = recipe.voice?.provider === "say" && recipe.voice.voice_id ? recipe.voice.voice_id : undefined;
  const voice = recipeVoice || env.SAY_VOICE || SAY_DEFAULT_VOICE[k];
  const r = Number(env.SAY_RATE);
  const rate = Number.isFinite(r) && r >= 80 && r <= 400 ? Math.round(r) : SAY_DEFAULT_RATE[k];
  return { voice, rate };
}

/** argv for `say` – text via file (`-f`), never via argv/shell, so narration cannot inject options. */
export function sayArgs(voice: string, rate: number, textFile: string, aiffFile: string): string[] {
  return ["-v", voice, "-r", String(rate), "-o", aiffFile, "-f", textFile];
}

/** Parse `say -v '?'` output ("Name (Variant)   en_US    # sample text") into voice names. */
export function parseSayVoices(out: string): { name: string; locale: string }[] {
  const res: { name: string; locale: string }[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]{2,})\s+#/);
    if (m) res.push({ name: m[1].trim(), locale: m[2] });
  }
  return res;
}

/**
 * macOS speech via `say` -> AIFF -> ffmpeg -> 44.1 kHz mono mp3. No per-char timestamps, so the
 * alignment is linear over the measured mp3 duration (same as espeak).
 */
async function sayTts(text: string, voice: string, rate: number, mp3Path: string): Promise<Alignment> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svp-say-"));
  const txt = path.join(tmp, "text.txt");
  const aiff = path.join(tmp, "out.aiff");
  try {
    fs.writeFileSync(txt, text + "\n", "utf8");
    await run("say", sayArgs(voice, rate, txt, aiff));
    await run("ffmpeg", ["-y", "-v", "error", "-i", aiff, "-af", "volume=1.0", "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", mp3Path]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const ms = await probeDurationMs(mp3Path);
  return linearAlignment(text, ms / 1000);
}

/** Voices installed for `say` (empty when `say` is missing or fails). */
async function sayVoices(): Promise<{ name: string; locale: string }[]> {
  try { return parseSayVoices((await run("say", ["-v", "?"])).stdout); } catch { return []; }
}

export interface ProviderEnv { hasElevenKey: boolean; hasSay: boolean; hasEspeak: boolean }

/**
 * Provider choice. Forced (--provider) wins and must be usable (throws otherwise).
 * recipe.voice.provider "external" is always honoured (no fallback: missing files are an error, never a robot voice).
 * Then recipe.voice.provider elevenlabs|say|espeak; if that one is not usable here (e.g. "say" in the
 * Linux cloud) we fall through to auto with a note. ("mock" in a recipe is not a request.)
 * Auto (no recipe provider): elevenlabs (key) -> say (macOS) -> espeak (espeak-ng) -> mock.
 */
export function chooseProvider(forced: Provider | undefined, recipeProvider: string | undefined, e: ProviderEnv): { provider: Provider; note?: string } {
  const usable = (p: Provider) => p === "mock" || p === "external" || (p === "elevenlabs" ? e.hasElevenKey : p === "say" ? e.hasSay : e.hasEspeak);
  if (forced) {
    if (!usable(forced)) throw new Error(forced === "elevenlabs" ? "provider elevenlabs requires ELEVENLABS_API_KEY" : forced === "say" ? "provider say requires the macOS `say` command" : "provider espeak requires espeak-ng on PATH");
    return { provider: forced };
  }
  if (recipeProvider === "external") return { provider: "external" };
  let note: string | undefined;
  if (recipeProvider === "elevenlabs" || recipeProvider === "say" || recipeProvider === "espeak") {
    if (usable(recipeProvider)) return { provider: recipeProvider };
    note = `recipe asks for provider=${recipeProvider} but it is not available here`;
  }
  const auto: Provider = e.hasElevenKey ? "elevenlabs" : e.hasSay ? "say" : e.hasEspeak ? "espeak" : "mock";
  return { provider: auto, note: note ? `${note} - using ${auto}` : auto === "mock" ? "espeak-ng not found on PATH - falling back to provider=mock (silent tone)" : undefined };
}

export function linearAlignment(text: string, durSec: number): Alignment {
  const chars = [...text];
  const per = durSec / Math.max(1, chars.length);
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => +(i * per).toFixed(4)),
    character_end_times_seconds: chars.map((_, i) => +((i + 1) * per).toFixed(4)),
  };
}

export async function tts(opts: TtsOptions): Promise<TtsResult> {
  const log = opts.log ?? ((m) => console.log(m));
  const recipePath = resolvePath(opts.recipe);
  const out = resolvePath(opts.out);
  const recipe = readJson(recipePath);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const chosen = chooseProvider(opts.provider, recipe.voice?.provider, { hasElevenKey: !!apiKey, hasSay: !!which("say"), hasEspeak: !!which("espeak-ng") });
  const provider: Provider = chosen.provider;
  if (chosen.note) log(`[tts] ${chosen.note}`);
  if (provider === "external") {
    const r = await acceptExternal(recipe, out, linearAlignment, log);
    fs.writeFileSync(path.join(out, "audio", "durations.json"), JSON.stringify(r.durations, null, 2));
    if (r.transcoded.length) log(`[tts] transcoded to 44.1 kHz mp3: ${r.transcoded.join(", ")}`);
    log(`[tts] external: ${r.accepted.length} file(s) measured, alignment ${r.alignedExternal.length} supplied / ${r.accepted.length - r.alignedExternal.length} linear -> ${path.join(out, "audio", "durations.json")}`);
    return { durations: r.durations, provider, synthesized: [], cached: r.accepted, chars: 0 };
  }
  const espeakVoiceId = espeakVoice(recipe.lang);
  let say = provider === "say" ? sayConfig(recipe) : null;
  if (say) {
    const voices = await sayVoices();
    if (voices.length && !voices.some((v) => v.name === say!.voice)) {
      const dflt = SAY_DEFAULT_VOICE[langKey(recipe.lang)];
      log(`[tts] say voice "${say.voice}" is not installed (say -v '?') - using ${dflt}`);
      say = { ...say, voice: dflt };
    }
  }
  // recipe.voice.voice_id is an ElevenLabs id unless the recipe itself asks for "say"
  const voiceId: string = (recipe.voice?.provider === "say" ? "" : recipe.voice?.voice_id) || process.env.ELEVENLABS_VOICE_ID || "";
  if (provider === "elevenlabs" && !voiceId) throw new Error("no voice id: set recipe.voice.voice_id or ELEVENLABS_VOICE_ID");
  const modelId: string = recipe.voice?.model_id || process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
  const meta = provider === "mock" ? { provider } : provider === "espeak" ? { provider, voice: espeakVoiceId, wpm: ESPEAK_WPM }
    : provider === "say" ? { provider, voice: say!.voice, rate: say!.rate } : { provider, voiceId, modelId };

  const audioDir = path.join(out, "audio");
  const alignDir = path.join(audioDir, "alignment");
  fs.mkdirSync(alignDir, { recursive: true });

  const durations: Record<string, number> = {};
  const synthesized: string[] = [], cached: string[] = [];
  let chars = 0;
  log(`[tts] provider=${provider}${provider === "elevenlabs" ? ` model=${modelId} voice=${voiceId}` : provider === "espeak" ? ` voice=${espeakVoiceId} wpm=${ESPEAK_WPM}` : provider === "say" ? ` voice=${say!.voice} rate=${say!.rate}` : ""}`);

  for (const step of recipe.steps as { id: string; narration: string; narration_tts?: string }[]) {
    const id = step.id;
    const text = ttsText(step); // narration_tts ?? narration – what is spoken (and the cache key in <id>.txt)
    const mp3 = path.join(audioDir, `${id}.mp3`);
    const txt = path.join(audioDir, `${id}.txt`);
    const metaF = path.join(audioDir, `${id}.meta.json`);
    const alF = path.join(alignDir, `${id}.json`);
    if (!text) {
      for (const f of [mp3, txt, metaF, alF]) fs.rmSync(f, { force: true });
      durations[id] = 0; // silent step
      continue;
    }
    const hit = fs.existsSync(mp3) && fs.existsSync(alF) && fs.existsSync(txt) && fs.readFileSync(txt, "utf8") === text &&
      fs.existsSync(metaF) && JSON.stringify(readJson(metaF)) === JSON.stringify(meta);
    if (hit) {
      cached.push(id);
    } else {
      let alignment: Alignment;
      if (provider === "mock") alignment = await mock(text, mp3);
      else if (provider === "espeak") alignment = await espeak(text, espeakVoiceId, mp3);
      else if (provider === "say") alignment = await sayTts(text, say!.voice, say!.rate, mp3);
      else {
        const r = await elevenlabs(text, voiceId, modelId, apiKey!);
        fs.writeFileSync(mp3, r.mp3);
        alignment = r.alignment;
        chars += text.length;
      }
      fs.writeFileSync(alF, JSON.stringify(alignment));
      fs.writeFileSync(txt, text);
      fs.writeFileSync(metaF, JSON.stringify(meta));
      synthesized.push(id);
    }
    durations[id] = await probeDurationMs(mp3); // ALWAYS measured from the real file
  }
  fs.writeFileSync(path.join(audioDir, "durations.json"), JSON.stringify(durations, null, 2));
  log(`[tts] ${synthesized.length} synthesized, ${cached.length} cached, ${Object.values(durations).filter((d) => d > 0).length} with audio -> ${path.join(audioDir, "durations.json")}`);
  if (provider === "elevenlabs") log(`[tts] ${chars} characters billed this run`);
  return { durations, provider, synthesized, cached, chars };
}
