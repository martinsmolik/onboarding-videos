// ffmpeg without drawtext (Homebrew core ffmpeg): PNG brand cards via Chromium canvas, or cards off.
// Simulated with SVP_FORCE_NO_DRAWTEXT=1 so it runs on any ffmpeg.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mux, ffmpegBin, ffprobeBin, ffmpegCaps, cssColor, renderCardPngs, INTERSTITIAL_MS } from "../src/index.js";
import { FIXTURE_DIR, ensureFixtureVideo } from "./fixture-video.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const hasDrawtext = hasFfmpeg && / drawtext /.test(spawnSync(ffmpegBin(), ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout)
  && /\btext_align\b/.test(spawnSync(ffmpegBin(), ["-hide_banner", "-h", "filter=drawtext"], { encoding: "utf8" }).stdout); // cards need ffmpeg >= 6.1
const quiet = () => {};

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  return fn().finally(() => { for (const k of Object.keys(old)) if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; });
}

test("ffmpeg/ffprobe binaries: FFMPEG_PATH / FFPROBE_PATH, ffprobe next to FFMPEG_PATH", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svp-bin-"));
  const ff = path.join(dir, "ffmpeg"), fp = path.join(dir, "ffprobe");
  fs.writeFileSync(ff, "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(ffmpegBin({ FFMPEG_PATH: ff }), ff);
  assert.equal(ffprobeBin({ FFMPEG_PATH: ff }), "ffprobe"); // no sibling yet -> PATH
  fs.writeFileSync(fp, "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(ffprobeBin({ FFMPEG_PATH: ff }), fp);
  assert.equal(ffprobeBin({ FFMPEG_PATH: ff, FFPROBE_PATH: "/x/ffprobe" }), "/x/ffprobe");
});

test("cssColor: ffmpeg 0xRRGGBB(AA) -> #RRGGBB(AA), names unchanged", () => {
  assert.equal(cssColor("0x1f2a44"), "#1f2a44");
  assert.equal(cssColor("0x1f2a44cc"), "#1f2a44cc");
  assert.equal(cssColor("white"), "white");
});

test("ffmpegCaps: SVP_FORCE_NO_DRAWTEXT hides drawtext", { skip: !hasFfmpeg }, async () => {
  const real = await ffmpegCaps({ ...process.env, SVP_FORCE_NO_DRAWTEXT: "" });
  assert.equal(real.drawtext, hasDrawtext);
  const forced = await ffmpegCaps({ ...process.env, SVP_FORCE_NO_DRAWTEXT: "1" });
  assert.equal(forced.drawtext, false);
  assert.equal(forced.forcedNoDrawtext, true);
});

// --- e2e on the committed fixture (34 s raw.webm, 6 steps) with 3 parts -> 2 interstitials
function fixtureCopy(mutTiming?: (t: any) => void): string {
  const src = FIXTURE_DIR;
  ensureFixtureVideo(src);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svp-cards-"));
  fs.cpSync(src, dir, { recursive: true });
  for (const f of ["final.mp4", "final.srt"]) fs.rmSync(path.join(dir, f), { force: true });
  const r = JSON.parse(fs.readFileSync(path.join(dir, "recipe.json"), "utf8"));
  Object.assign(r.steps[0], { part: 1, part_title: "Úvod" });
  Object.assign(r.steps[2], { part: 2, part_title: "Nastavení" });
  Object.assign(r.steps[4], { part: 3, part_title: "Ukázka využití" });
  fs.writeFileSync(path.join(dir, "recipe.json"), JSON.stringify(r));
  if (mutTiming) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, "timing.json"), "utf8"));
    mutTiming(t);
    fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(t));
  }
  return dir;
}
const frame = (video: string, sec: number, png: string) =>
  spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(sec), "-i", video, "-frames:v", "1", png]).status === 0;
const psnr = (a: string, b: string) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", a, "-i", b, "-lavfi", "[0:v][1:v]psnr", "-f", "null", "-"], { encoding: "utf8" });
  const m = r.stderr.match(/average:([\d.]+|inf)/);
  return m ? (m[1] === "inf" ? 99 : Number(m[1])) : NaN;
};
const probeRenderer = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svp-cards-probe-"));
  const r = await renderCardPngs([{ key: "t", title: "Závěr", sub: null }], { width: 64, height: 36, bg: "#000", fg: "#fff", boldFont: null, regularFont: null, dir });
  return r.renderer;
};

test("no drawtext -> PNG cards: same timeline, chapters and look as drawtext", { skip: !hasFfmpeg, timeout: 240_000 }, async (t) => {
  const renderer = await probeRenderer();
  if (!renderer) { t.skip("no Chromium renderer available (playwright install chromium / Google Chrome)"); return; }
  const dir = fixtureCopy();
  const r = await withEnv({ SVP_FORCE_NO_DRAWTEXT: "1", SVP_CARD_RENDERER: undefined }, () => mux({ out: dir, log: quiet }));
  assert.match(r.cards, /^png:/);
  assert.equal(r.introMs, 2500);
  assert.equal(r.outroMs, 2000);
  assert.deepEqual(r.interstitials.map((c) => [c.stepId, c.finalMs]), [["s03", 12_500], ["s05", 25_000]]);
  assert.ok(Math.abs(r.totalMs - (2500 + 34_000 + 2 * INTERSTITIAL_MS + 2000)) < 60, `final ${r.totalMs}`);
  assert.equal(fs.readFileSync(path.join(dir, "chapters.txt"), "utf8"), "0:00 Úvod\n0:12 Nastavení\n0:25 Ukázka využití\n");
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith(".card-")), [], "temp card files removed");
  const v = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt,r_frame_rate", "-of", "csv=p=0", r.finalPath], { encoding: "utf8" }).stdout.trim();
  assert.equal(v, "1920,1080,yuv420p,30/1");
  if (!hasDrawtext) return;
  // compare with the real drawtext rendering: closer to it than a blank brand-colour card is
  const ref = fixtureCopy();
  await withEnv({ SVP_FORCE_NO_DRAWTEXT: undefined, SVP_CARD_RENDERER: undefined }, () => mux({ out: ref, cardRenderer: "drawtext", log: quiet }));
  const blank = path.join(dir, "blank.png");
  spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x1f2a44:s=1920x1080", "-frames:v", "1", blank]);
  for (const [name, sec] of [["intro", 1.2], ["card", 13.2], ["outro", 40.0]] as const) {
    const a = path.join(dir, `${name}-png.png`), b = path.join(dir, `${name}-dt.png`);
    assert.ok(frame(r.finalPath, sec, a) && frame(path.join(ref, "final.mp4"), sec, b));
    const same = psnr(a, b), vsBlank = psnr(blank, b);
    assert.ok(same > vsBlank + 3, `${name}: png vs drawtext ${same.toFixed(1)} dB should beat blank vs drawtext ${vsBlank.toFixed(1)} dB`);
  }
});

test("no drawtext and no renderer -> cards off with a warning, chapters on the shorter timeline, failed steps listed", { skip: !hasFfmpeg, timeout: 120_000 }, async () => {
  const dir = fixtureCopy((t) => { t.steps[3].status = "failed"; });
  const r = await withEnv({ SVP_FORCE_NO_DRAWTEXT: "1" }, () => mux({ out: dir, cardRenderer: "cdp", cdp: "http://127.0.0.1:1", log: quiet }));
  assert.equal(r.cards, "none");
  assert.equal(r.introMs, 0);
  assert.equal(r.outroMs, 0);
  assert.equal(r.interstitials.length, 0);
  assert.equal(r.stepOffsetMs.s06, 0);
  assert.ok(Math.abs(r.totalMs - 34_000) < 60, `final ${r.totalMs}`);
  assert.equal(fs.readFileSync(path.join(dir, "chapters.txt"), "utf8"), "0:00 Úvod\n0:10 Nastavení\n0:21 Ukázka využití\n");
  assert.ok(r.warnings.some((w) => /^CARDS DISABLED/.test(w) && /ffmpeg-full/.test(w)), r.warnings.join("\n"));
  assert.deepEqual(r.failedSteps, ["s04"]);
  assert.ok(r.warnings.some((w) => /FAILED in timing\.json: s04/.test(w)));
  assert.ok(fs.existsSync(r.finalPath));
  const srt = fs.readFileSync(path.join(dir, "final.srt"), "utf8");
  assert.equal(srt.split("\n")[1].slice(0, 12), "00:00:00,000"); // no intro shift
});

test("no drawtext: --intro-image / --outro-image stills still work (no text needed)", { skip: !hasFfmpeg, timeout: 120_000 }, async () => {
  const dir = fixtureCopy();
  const img = path.join(dir, "thumb.png");
  spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=1280x720", "-frames:v", "1", img]);
  const r = await withEnv({ SVP_FORCE_NO_DRAWTEXT: "1" }, () => mux({ out: dir, cardRenderer: "none", introImage: img, outroImage: img, log: quiet }));
  assert.equal(r.cards, "none");
  assert.equal(r.introMs, 3000);
  assert.equal(r.outroMs, 3000);
  assert.ok(Math.abs(r.totalMs - (3000 + 34_000 + 3000)) < 60, `final ${r.totalMs}`);
  assert.equal(fs.readFileSync(path.join(dir, "chapters.txt"), "utf8"), "0:00 Úvod\n0:13 Nastavení\n0:24 Ukázka využití\n");
});
