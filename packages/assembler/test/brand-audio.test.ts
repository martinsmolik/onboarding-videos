// Brand cards (HTML template), pronunciation lexicon, per-clip loudness normalisation.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyLexicon, loadLexicon, spokenTextFor, type Lexicon } from "../src/pronunciation.js";
import { cardHtml, brandStrings, LOGO_SVG } from "../src/brand.js";
import { gainFor, gainFilter, measureLoudness, normalizeClips } from "../src/loudness.js";
import { partsLabel, thumbnailShot } from "../src/mux.js";
import { buildManifest } from "../src/external.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("lexicon: whole words, stems keep endings and capitals, longest match first, no double rewrite", () => {
  const lex: Lexicon = [
    { match: "HR", say: "ejč ár" },
    { match: "absenc", say: "apsenc", stem: true, case: "insensitive" },
    { match: "Sloneek", say: "Sloník", stem: true },
    { match: "sick day", say: "sik dej", case: "insensitive" },
    { match: "sick days", say: "sik dejs", case: "insensitive" },
    { match: "ejč", say: "WRONG" },
  ];
  assert.equal(applyLexicon("HR oddělení schválí absenci.", lex), "ejč ár oddělení schválí apsenci.");
  assert.equal(applyLexicon("Absence v Sloneeku, typy absencí", lex), "Apsence v Sloníku, typy apsencí");
  assert.equal(applyLexicon("Sick days i sick day", lex), "Sik dejs i sik dej");
  assert.equal(applyLexicon("HRM, CHR, hr a HR.", lex), "HRM, CHR, hr a ejč ár."); // case-sensitive whole word only
  assert.equal(applyLexicon("", lex), "");
});

test("lexicon: shared config/pronunciation.json + recipe overrides; spoken text feeds the manifest, subtitle unchanged", () => {
  const cs = loadLexicon("cs");
  assert.ok(cs.some((r) => r.match === "HR"), "config/pronunciation.json has cs rules");
  const recipe = { id: "x", lang: "cs", pronunciation: [{ match: "HR", say: "há er" }], steps: [{ id: "s01", narration: "HR a absence." }] };
  assert.equal(spokenTextFor(recipe)(recipe.steps[0]), "há er a apsentse.");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "svp-lex-"));
  const m = buildManifest({ ...recipe, pronunciation: undefined }, out);
  assert.equal(m.steps[0].tts_text, "ejč ár a apsentse.");
  assert.equal(m.steps[0].subtitle, "HR a absence.");
  assert.equal(m.voice.language_code, "cs");
});

test("brand cards: html per kind, escaped text, localized strings, Czech plurals", () => {
  const S = brandStrings("cs");
  const intro = cardHtml({ kind: "intro", title: "A <b> & \"c\"", eyebrow: S.eyebrow, meta: "4 části · 7 min" }, 1920, 1080);
  assert.match(intro, /A &lt;b&gt; &amp; &quot;c&quot;/);
  assert.ok(intro.includes(LOGO_SVG));
  assert.match(cardHtml({ kind: "part", index: 2, count: 4, label: S.part(2, 4), title: "Nastavení" }, 1920, 1080), /Část 2 z 4/);
  assert.match(cardHtml({ kind: "thumb", title: "T", eyebrow: "E" }, 1280, 720), /font-size:6\.6667px/);
  assert.deepEqual([1, 2, 4, 5].map((n) => partsLabel(n, "cs")), ["1 část", "2 části", "4 části", "5 částí"]);
  assert.equal(partsLabel(3, "en"), "3 parts");
});

test("thumbnail shot: explicit, else first step of the 2nd part", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "svp-thumb-"));
  fs.mkdirSync(path.join(out, "shots"));
  for (const id of ["s01", "s02", "s03"]) fs.writeFileSync(path.join(out, "shots", `${id}.png`), "x");
  const steps = [{ id: "s01", part: 1 }, { id: "s02", part: 1 }, { id: "s03", part: 2 }];
  assert.equal(path.basename(thumbnailShot(out, steps)!), "s03.png");
  assert.equal(path.basename(thumbnailShot(out, steps, "s02")!), "s02.png");
  assert.equal(thumbnailShot(out, steps, "s09"), null);
});

test("loudness: gain math", () => {
  assert.equal(gainFor(-22, -16), 6);
  assert.equal(gainFor(-10, -16), -6);
  assert.equal(gainFor(-60, -16), 20); // capped
  assert.equal(gainFor(-Infinity, -16), 0);
  assert.equal(gainFilter(0), "");
  assert.match(gainFilter(6), /volume=6\.00dB,alimiter/);
  assert.equal(gainFilter(-3), ",volume=-3.00dB");
});

test("loudness: two tones 12 dB apart end up within 1 LU of the target", { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svp-lufs-"));
  const mk = (id: string, vol: number) => {
    const f = path.join(dir, `${id}.mp3`);
    spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-af", `volume=${vol}dB`, "-c:a", "libmp3lame", f]);
    return { id, file: f };
  };
  const clips = [mk("s01", 10), mk("s02", -2)];
  const gains = await normalizeClips(dir, clips, -16, (m) => assert.fail(m));
  assert.ok(Math.abs(gains[0].gainDb - gains[1].gainDb + 12) < 1, JSON.stringify(gains));
  assert.ok(fs.existsSync(path.join(dir, "loudness.json")), "cache written");
  for (const [i, c] of clips.entries()) {
    const o = path.join(dir, `n${i}.wav`);
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", c.file, "-af", gainFilter(gains[i].gainDb).slice(1), o]);
    const m = await measureLoudness(o);
    assert.ok(Math.abs(m.lufs + 16) < 1, `${c.id}: ${m.lufs} LUFS`);
  }
});
