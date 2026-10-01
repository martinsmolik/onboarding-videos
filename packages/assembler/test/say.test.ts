import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseProvider, parseSayVoices, sayArgs, sayConfig, tts } from "../src/tts.js";

test("sayArgs: text goes through -f, never argv", () => {
  assert.deepEqual(sayArgs("Samantha", 180, "/t/text.txt", "/t/out.aiff"), ["-v", "Samantha", "-r", "180", "-o", "/t/out.aiff", "-f", "/t/text.txt"]);
  assert.deepEqual(sayArgs("Zuzana (Enhanced)", 170, "a.txt", "b.aiff").slice(0, 2), ["-v", "Zuzana (Enhanced)"]);
});

test("sayConfig: language defaults", () => {
  assert.deepEqual(sayConfig({ lang: "en" }, {}), { voice: "Samantha", rate: 180 });
  assert.deepEqual(sayConfig({ lang: "cs" }, {}), { voice: "Zuzana", rate: 170 });
  assert.deepEqual(sayConfig({ lang: "sk" }, {}), { voice: "Laura", rate: 170 });
  assert.deepEqual(sayConfig({}, {}), { voice: "Zuzana", rate: 170 });
});

test("sayConfig: recipe voice_id (only with provider say) > SAY_VOICE > default; SAY_RATE", () => {
  assert.equal(sayConfig({ lang: "en", voice: { provider: "say", voice_id: "Daniel" } }, { SAY_VOICE: "Alex" }).voice, "Daniel");
  assert.equal(sayConfig({ lang: "en", voice: { provider: "elevenlabs", voice_id: "21m00Tcm4TlvDq8ikWAM" } }, { SAY_VOICE: "Alex" }).voice, "Alex");
  assert.equal(sayConfig({ lang: "en", voice: { provider: "elevenlabs", voice_id: "21m00Tcm4TlvDq8ikWAM" } }, {}).voice, "Samantha");
  assert.equal(sayConfig({ lang: "en" }, { SAY_RATE: "200" }).rate, 200);
  assert.equal(sayConfig({ lang: "en" }, { SAY_RATE: "fast" }).rate, 180);
});

test("parseSayVoices handles names with spaces/parentheses", () => {
  const out = [
    "Samantha            en_US    # Hello! My name is Samantha.",
    "Zuzana (Enhanced)   cs_CZ    # Dobrý den, jmenuji se Zuzana.",
    "Eddy (English (UK)) en_GB    # Hello! My name is Eddy.",
    "garbage line",
  ].join("\n");
  assert.deepEqual(parseSayVoices(out).map((v) => v.name), ["Samantha", "Zuzana (Enhanced)", "Eddy (English (UK))"]);
  assert.equal(parseSayVoices(out)[1].locale, "cs_CZ");
});

test("chooseProvider: forced > recipe > auto (elevenlabs > say > espeak > mock)", () => {
  const mac = { hasElevenKey: false, hasSay: true, hasEspeak: false };
  const cloud = { hasElevenKey: false, hasSay: false, hasEspeak: true };
  assert.equal(chooseProvider(undefined, undefined, mac).provider, "say");
  assert.equal(chooseProvider(undefined, undefined, cloud).provider, "espeak");
  assert.equal(chooseProvider(undefined, undefined, { ...mac, hasElevenKey: true }).provider, "elevenlabs");
  assert.equal(chooseProvider(undefined, undefined, { hasElevenKey: false, hasSay: false, hasEspeak: false }).provider, "mock");
  // recipe from the explorer asks for say: honoured on the Mac even with an ElevenLabs key ...
  assert.equal(chooseProvider(undefined, "say", { ...mac, hasElevenKey: true }).provider, "say");
  // ... and falls back to espeak in the cloud
  const c = chooseProvider(undefined, "say", cloud);
  assert.equal(c.provider, "espeak");
  assert.match(c.note!, /say.*not available.*espeak/);
  assert.equal(chooseProvider(undefined, "mock", mac).provider, "say"); // mock in recipe is not a request
  assert.equal(chooseProvider("mock", "say", mac).provider, "mock");
  assert.throws(() => chooseProvider("say", undefined, cloud), /macOS `say`/);
  assert.throws(() => chooseProvider("elevenlabs", undefined, cloud), /ELEVENLABS_API_KEY/);
});

test("tts provider=say end-to-end with a fake `say` on PATH (argv + files + cache)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svp-say-test-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const argLog = path.join(dir, "argv.log");
  // fake say: lists voices for -v '?', otherwise logs argv and writes a 1.2 s AIFF to -o
  fs.writeFileSync(path.join(bin, "say"), `#!/bin/sh
if [ "$2" = "?" ]; then printf 'Samantha            en_US    # Hello\\nZuzana              cs_CZ    # Ahoj\\n'; exit 0; fi
printf '%s\\n' "$@" >> "${argLog}"
out=""; txt=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; -f) txt="$2"; shift;; esac; shift; done
test -s "$txt" || exit 3
exec ffmpeg -v error -y -f lavfi -i sine=frequency=330:sample_rate=22050 -t 1.2 "$out"
`, { mode: 0o755 });
  const recipe = { id: "t", version: 1, lang: "en", viewport: { width: 640, height: 360 }, start: { url: "http://x" }, voice: { provider: "say", voice_id: "Nonexistent Voice" },
    steps: [{ id: "s01", narration: "Click New request; then --rm -rf $HOME.", actions: [] }, { id: "s02", narration: "", actions: [] }] };
  fs.writeFileSync(path.join(dir, "recipe.json"), JSON.stringify(recipe));
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  const logs: string[] = [];
  try {
    const r = await tts({ recipe: path.join(dir, "recipe.json"), out: path.join(dir, "out"), log: (m) => logs.push(m) });
    assert.equal(r.provider, "say");
    assert.ok(r.durations.s01 >= 1150 && r.durations.s01 <= 1300, `duration ${r.durations.s01}`);
    assert.equal(r.durations.s02, 0);
    const argv = fs.readFileSync(argLog, "utf8").trim().split("\n");
    assert.equal(argv[0], "-v");
    assert.equal(argv[1], "Samantha", "unknown voice falls back to the language default");
    assert.deepEqual(argv.slice(2, 4), ["-r", "180"]);
    assert.ok(!argv.some((a) => a.includes("rm -rf")), "narration never reaches argv");
    assert.ok(logs.some((l) => /not installed/.test(l)));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "out", "audio", "s01.meta.json"), "utf8"));
    assert.deepEqual(meta, { provider: "say", voice: "Samantha", rate: 180 });
    const al = JSON.parse(fs.readFileSync(path.join(dir, "out", "audio", "alignment", "s01.json"), "utf8"));
    assert.equal(al.characters.length, [...recipe.steps[0].narration].length);
    // second run is a cache hit
    const r2 = await tts({ recipe: path.join(dir, "recipe.json"), out: path.join(dir, "out"), log: () => {} });
    assert.deepEqual(r2.cached, ["s01"]);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
