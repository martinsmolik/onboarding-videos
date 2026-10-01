import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tts, chooseProvider, writeManifest, parseAlignment } from "../src/index.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svp-ext-"));
  const out = path.join(dir, "out");
  const recipe = {
    id: "ext", version: 1, lang: "en", viewport: { width: 640, height: 360 }, start: { url: "http://x" },
    voice: { provider: "external", voice_id: "abc", model_id: "eleven_multilingual_v2" },
    steps: [
      { id: "s01", narration: "Hello there.", actions: [] },
      { id: "s02", narration: "", actions: [] },
      { id: "s03", narration: "Second sentence here.", actions: [] },
    ],
  };
  const rp = path.join(dir, "recipe.json");
  fs.writeFileSync(rp, JSON.stringify(recipe));
  return { dir, out, rp, recipe };
}
const tone = (file: string, sec: number, codec: string[] = ["-c:a", "libmp3lame"]) =>
  spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=300:sample_rate=22050`, "-t", String(sec), ...codec, file]).status === 0 || assert.fail("ffmpeg tone");
const quiet = () => {};

test("chooseProvider: recipe external is honoured, no fallback; --provider external allowed", () => {
  const cloud = { hasElevenKey: true, hasSay: false, hasEspeak: true };
  assert.equal(chooseProvider(undefined, "external", cloud).provider, "external");
  assert.equal(chooseProvider("external", undefined, cloud).provider, "external");
  assert.equal(chooseProvider("espeak", "external", cloud).provider, "espeak"); // forced wins
  assert.equal(chooseProvider(undefined, undefined, { hasElevenKey: false, hasSay: false, hasEspeak: true }).provider, "espeak");
});

test("manifest lists narrated steps with expected file names, silent steps separately", () => {
  const { out, recipe } = setup();
  const { manifest, file } = writeManifest(recipe, out);
  assert.ok(fs.existsSync(file));
  assert.ok(fs.existsSync(path.join(out, "audio", "alignment")));
  assert.deepEqual(manifest.steps.map((s) => [s.id, s.file, s.status]), [["s01", "s01.mp3", "missing"], ["s03", "s03.mp3", "missing"]]);
  assert.deepEqual(manifest.silent_steps, ["s02"]);
  assert.deepEqual(manifest.missing, ["s01", "s03"]);
  assert.equal(manifest.steps[0].narration, "Hello there.");
  assert.equal(manifest.voice.voice_id, "abc");
});

test("parseAlignment accepts a full with-timestamps response or the bare alignment", () => {
  const a = { characters: ["a", "b"], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2] };
  assert.deepEqual(parseAlignment(a), a);
  assert.deepEqual(parseAlignment({ audio_base64: "x", alignment: a, normalized_alignment: a }), a);
  assert.equal(parseAlignment({ characters: ["a"], character_start_times_seconds: [], character_end_times_seconds: [] }), null);
  assert.equal(parseAlignment(null), null);
});

test("tts external: missing files -> clear error listing every file; manifest written", { skip: !hasFfmpeg }, async () => {
  const { out, rp } = setup();
  await assert.rejects(tts({ recipe: rp, out, log: quiet }), (e: Error) => /s01\.mp3/.test(e.message) && /s03\.mp3/.test(e.message) && /manifest\.json/.test(e.message));
  assert.ok(fs.existsSync(path.join(out, "audio", "manifest.json")));
});

test("tts external: measures mp3, transcodes wav, keeps supplied alignment, detects stale + foreign", { skip: !hasFfmpeg }, async () => {
  const { out, rp, recipe } = setup();
  const audio = path.join(out, "audio");
  fs.mkdirSync(path.join(audio, "alignment"), { recursive: true });
  tone(path.join(audio, "s01.mp3"), 1.2);
  tone(path.join(audio, "s03.wav"), 2.0, ["-c:a", "pcm_s16le"]);
  const al = { characters: [..."Hello there."], character_start_times_seconds: [...Array(12)].map((_, i) => i * 0.1), character_end_times_seconds: [...Array(12)].map((_, i) => i * 0.1 + 0.1) };
  fs.writeFileSync(path.join(audio, "alignment", "s01.json"), JSON.stringify({ audio_base64: "", alignment: al }));

  const r = await tts({ recipe: rp, out, log: quiet });
  assert.equal(r.provider, "external");
  const d = JSON.parse(fs.readFileSync(path.join(audio, "durations.json"), "utf8"));
  assert.equal(d.s02, 0);
  assert.ok(Math.abs(d.s01 - 1200) < 80, `s01 ${d.s01}`);
  assert.ok(Math.abs(d.s03 - 2000) < 80, `s03 ${d.s03}`);
  assert.ok(fs.existsSync(path.join(audio, "s03.mp3")), "wav transcoded to mp3");
  const rate = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", path.join(audio, "s03.mp3")], { encoding: "utf8" }).stdout.trim();
  assert.equal(rate, "44100");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(audio, "alignment", "s01.json"), "utf8")), al, "supplied alignment kept (unwrapped)");
  const lin = JSON.parse(fs.readFileSync(path.join(audio, "alignment", "s03.json"), "utf8"));
  assert.equal(lin.characters.join(""), "Second sentence here.");
  assert.ok(Math.abs(lin.character_end_times_seconds.at(-1) * 1000 - d.s03) < 5, "linear alignment spans the measured duration");
  const m = JSON.parse(fs.readFileSync(path.join(audio, "manifest.json"), "utf8"));
  assert.deepEqual(m.missing, []);
  assert.ok(m.steps.every((s: any) => s.status === "present" && s.duration_ms > 0));

  // second run: cached, same result
  await tts({ recipe: rp, out, log: quiet });

  // narration changed, file not regenerated -> stale
  const changed = { ...recipe, steps: recipe.steps.map((s) => (s.id === "s03" ? { ...s, narration: "A different sentence." } : s)) };
  fs.writeFileSync(rp, JSON.stringify(changed));
  await assert.rejects(tts({ recipe: rp, out, log: quiet }), (e: Error) => /s03\.mp3\s+\[stale\]/.test(e.message) && !/s01\.mp3/.test(e.message));
  // regenerated (newer than the bookkeeping) -> accepted again
  await new Promise((res) => setTimeout(res, 20));
  tone(path.join(audio, "s03.mp3"), 1.5);
  await tts({ recipe: rp, out, log: quiet });
  assert.ok(Math.abs(JSON.parse(fs.readFileSync(path.join(audio, "durations.json"), "utf8")).s03 - 1500) < 80);

  // an mp3 synthesized by another provider is never accepted as external
  await tts({ recipe: rp, out, provider: "mock", log: quiet });
  await assert.rejects(tts({ recipe: rp, out, log: quiet }), (e: Error) => /\[foreign\].*mock/.test(e.message));
});
