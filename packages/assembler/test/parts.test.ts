import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  mux, tts, writeManifest, cuesForStep, mapTextIndices, linearAlignment,
  ttsText, subtitleText, effectiveParts, partStarts, chaptersText, chapterProblems, ytTime, INTERSTITIAL_MS,
} from "../src/index.js";
import { FIXTURE_DIR, ensureFixtureVideo } from "./fixture-video.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const quiet = () => {};

test("text roles: tts = narration_tts ?? narration, subtitle = subtitle ?? narration", () => {
  const s = { narration: "Hlavní KPI.", narration_tts: "Hlavní kej pí áj." };
  assert.equal(ttsText(s), "Hlavní kej pí áj.");
  assert.equal(subtitleText(s), "Hlavní KPI.");
  assert.equal(subtitleText({ narration: "a", subtitle: "" }), "");
  assert.equal(ttsText({ narration: " x " }), "x");
});

test("partStarts: change of effective part, frame-snapped, skipped steps ignored", () => {
  const eff = effectiveParts([{ part: 1, part_title: "Úvod" }, {}, { part: 2, part_title: "Nastavení" }, { part: 3 }, {}]);
  const steps = [0, 10_010, 20_000, 30_000, 30_000].map((t, i) => ({ id: `s0${i + 1}`, t_start_ms: t, status: i === 4 ? "skipped" : "ok", ...eff[i] }));
  const ps = partStarts(steps, 30, 40_000, "cs");
  assert.deepEqual(ps.map((p) => [p.stepId, p.part, p.title, p.rawMs, p.frame]), [["s03", 2, "Nastavení", 20_000, 600], ["s04", 3, "Část 3", 30_000, 900]]);
  // no parts at all -> nothing
  assert.deepEqual(partStarts([{ id: "s01", t_start_ms: 0 }, { id: "s02", t_start_ms: 5000 }], 30, 9000), []);
});

test("chapters: YouTube format, first forced to 0:00, rule check", () => {
  assert.equal(ytTime(0), "0:00");
  assert.equal(ytTime(45_999), "0:45");
  assert.equal(ytTime(3_725_000), "1:02:05");
  const ch = [{ ms: 0, title: "Úvod" }, { ms: 45_400, title: "Nastavení" }, { ms: 135_000, title: "Ukázka využití" }];
  assert.equal(chaptersText(ch), "0:00 Úvod\n0:45 Nastavení\n2:15 Ukázka využití\n");
  assert.deepEqual(chapterProblems(ch, 200_000), []);
  assert.equal(chapterProblems([{ ms: 0, title: "a" }, { ms: 5000, title: "b" }], 9000).length, 3); // < 3 chapters, two too short
});

test("mapTextIndices / cuesForStep: subtitle text timed by the spoken text's alignment", () => {
  const spoken = "To je hlavní kej pí áj docházky.";
  const shown = "To je hlavní KPI docházky.";
  const idx = mapTextIndices([...shown], [...spoken]);
  assert.equal(idx[0], 0);
  assert.equal(idx[shown.indexOf("docházky")], spoken.indexOf("docházky")); // identical words map 1:1
  assert.ok(idx.every((v, i) => i === 0 || v >= idx[i - 1]), "monotonic");
  const al = linearAlignment(spoken, spoken.length / 10); // 100 ms per char
  const [cue] = cuesForStep(1000, shown, al);
  assert.equal(cue.text, shown);
  assert.equal(cue.startMs, 1000);
  assert.equal(cue.endMs, 1000 + spoken.length * 100); // ends where the SPOKEN text ends
});

test("manifest: tts_text + subtitle; a subtitle-only edit never makes the clip stale, a tts edit does", { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svp-parts-"));
  const out = path.join(dir, "out");
  const recipe: any = {
    id: "p", version: 1, lang: "cs", viewport: { width: 640, height: 360 }, start: { url: "http://x" }, voice: { provider: "external" },
    steps: [{ id: "s01", narration: "Hlavní KPI.", narration_tts: "Hlavní kej pí áj.", actions: [] }],
  };
  const rp = path.join(dir, "recipe.json");
  fs.writeFileSync(rp, JSON.stringify(recipe));
  const m = writeManifest(recipe, out).manifest;
  assert.equal(m.steps[0].tts_text, "Hlavní kej pí áj.");
  assert.equal(m.steps[0].narration, "Hlavní kej pí áj."); // alias = what to voice
  assert.equal(m.steps[0].subtitle, "Hlavní KPI.");
  assert.equal(m.total_chars, [..."Hlavní kej pí áj."].length);
  spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=22050", "-t", "1.2", "-c:a", "libmp3lame", path.join(out, "audio", "s01.mp3")]);
  await tts({ recipe: rp, out, log: quiet });
  assert.equal(fs.readFileSync(path.join(out, "audio", "s01.txt"), "utf8"), "Hlavní kej pí áj.");
  recipe.steps[0].subtitle = "Hlavní KPI (klíčový ukazatel).";
  assert.equal(writeManifest(recipe, out).manifest.steps[0].status, "present");
  recipe.steps[0].narration_tts = "Hlavní ká pé í.";
  assert.equal(writeManifest(recipe, out).manifest.steps[0].status, "stale");
});

// mux end-to-end on the committed fixture (6 steps, 34 s raw.webm, mock audio): 3 parts -> 2 cards
function fixtureCopy(): string {
  const src = FIXTURE_DIR;
  ensureFixtureVideo(src);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svp-mux-parts-"));
  fs.cpSync(src, dir, { recursive: true });
  for (const f of ["final.mp4", "final.srt"]) fs.rmSync(path.join(dir, f), { force: true });
  const r = JSON.parse(fs.readFileSync(path.join(dir, "recipe.json"), "utf8"));
  Object.assign(r.steps[0], { part: 1, part_title: "Úvod" });
  Object.assign(r.steps[1], { subtitle: "V menu zvolte Absence." });
  Object.assign(r.steps[2], { part: 2, part_title: "Nastavení" });
  Object.assign(r.steps[4], { part: 3, part_title: "Ukázka využití" });
  fs.writeFileSync(path.join(dir, "recipe.json"), JSON.stringify(r));
  return dir;
}
const meanDb = (file: string, fromMs: number, toMs: number) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-ss", (fromMs / 1000).toFixed(3), "-t", ((toMs - fromMs) / 1000).toFixed(3), "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const m = r.stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/);
  return m ? (m[1] === "-inf" ? -200 : Number(m[1])) : NaN;
};

test("mux with parts: interstitial cards shift audio/SRT, chapters.txt in final time, subtitle text in SRT", { skip: !hasFfmpeg }, async () => {
  const dir = fixtureCopy();
  const r = await mux({ out: dir, log: quiet });
  assert.deepEqual(r.interstitials.map((c) => [c.stepId, c.part, c.title, c.finalMs]), [["s03", 2, "Nastavení", 12_500], ["s05", 3, "Ukázka využití", 25_000]]);
  assert.deepEqual(r.stepOffsetMs, { s01: 2500, s02: 2500, s03: 4000, s04: 4000, s05: 5500, s06: 5500 });
  assert.ok(Math.abs(r.totalMs - (2500 + 34_000 + 2 * INTERSTITIAL_MS + 2000)) < 60, `final ${r.totalMs}`);
  assert.equal(fs.readFileSync(path.join(dir, "chapters.txt"), "utf8"), "0:00 Úvod\n0:12 Nastavení\n0:25 Ukázka využití\n");
  const srt = fs.readFileSync(path.join(dir, "final.srt"), "utf8");
  assert.match(srt, /V menu zvolte Absence\./);
  assert.doesNotMatch(srt, /V levém menu klikněte/);
  const first = srt.split("\n")[1];
  assert.equal(first.slice(0, 12), "00:00:02,500"); // s01 audio starts at intro end
  // card windows are silent, narration right after the card is there
  const f = r.finalPath;
  assert.ok(meanDb(f, 12_550, 13_950) < -80, "card 1 silent");
  assert.ok(meanDb(f, 25_050, 26_450) < -80, "card 2 silent");
  assert.ok(meanDb(f, 14_050, 14_600) > -40, "s03 narration starts after card 1");
  assert.ok(meanDb(f, 26_550, 27_100) > -40, "s05 narration starts after card 2");
});

test("mux --no-interstitials: no cards, chapters still written (intro-shifted only)", { skip: !hasFfmpeg }, async () => {
  const dir = fixtureCopy();
  const r = await mux({ out: dir, interstitials: false, log: quiet });
  assert.equal(r.interstitials.length, 0);
  assert.equal(r.stepOffsetMs.s06, 2500);
  assert.equal(fs.readFileSync(path.join(dir, "chapters.txt"), "utf8"), "0:00 Úvod\n0:12 Nastavení\n0:23 Ukázka využití\n");
  assert.ok(Math.abs(r.totalMs - (2500 + 34_000 + 2000)) < 60);
});
