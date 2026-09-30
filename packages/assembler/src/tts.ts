import fs from "node:fs";
import path from "node:path";
import { probeDurationMs, readJson, resolvePath, run } from "./util.js";

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}
export type Provider = "elevenlabs" | "mock";
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
  const provider: Provider = opts.provider ?? (apiKey ? "elevenlabs" : "mock");
  if (provider === "elevenlabs" && !apiKey) throw new Error("provider elevenlabs requires ELEVENLABS_API_KEY");
  const voiceId: string = recipe.voice?.voice_id || process.env.ELEVENLABS_VOICE_ID || "";
  if (provider === "elevenlabs" && !voiceId) throw new Error("no voice id: set recipe.voice.voice_id or ELEVENLABS_VOICE_ID");
  const modelId: string = recipe.voice?.model_id || process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
  const meta = provider === "mock" ? { provider } : { provider, voiceId, modelId };

  const audioDir = path.join(out, "audio");
  const alignDir = path.join(audioDir, "alignment");
  fs.mkdirSync(alignDir, { recursive: true });

  const durations: Record<string, number> = {};
  const synthesized: string[] = [], cached: string[] = [];
  let chars = 0;
  log(`[tts] provider=${provider}${provider === "elevenlabs" ? ` model=${modelId} voice=${voiceId}` : ""}`);

  for (const step of recipe.steps as { id: string; narration: string }[]) {
    const id = step.id;
    const text = (step.narration ?? "").trim();
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
