import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVtt } from "../src/ingest.js";
import { wordsToSegments } from "../src/transcribe.js";
import { matchesKeywords, changes } from "../src/changes.js";
import { scenarize, validateScenario } from "../src/scenarize.js";

const fx = join(dirname(fileURLToPath(import.meta.url)), "fixture");

function setup() {
  const out = join(mkdtempSync(join(tmpdir(), "kn-")), "absence-request");
  mkdirSync(join(out, "source"), { recursive: true });
  cpSync(join(fx, "transcript.txt"), join(out, "source/transcript.txt"));
  cpSync(join(fx, "changes.json"), join(out, "source/changes.json"));
  return out;
}

test("parseVtt dedupes rolling auto-captions", () => {
  const vtt = `WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nahoj světe\n\n00:00:03.000 --> 00:00:05.000\nahoj světe\n<c>jak se máš</c>\n\n00:00:05.000 --> 00:00:07.000\njak se máš\ndobře\n`;
  const s = parseVtt(vtt);
  assert.deepEqual(s.map((x) => x.text), ["ahoj světe", "jak se máš", "dobře"]);
  assert.equal(s[0].start_ms, 1000);
});

test("wordsToSegments splits on sentence end", () => {
  const w = [
    { text: "Ahoj", start: 0, end: 0.4, type: "word" }, { text: " ", start: 0.4, end: 0.5, type: "spacing" },
    { text: "světe.", start: 0.5, end: 1, type: "word" }, { text: "Další", start: 1.2, end: 1.6, type: "word" },
  ];
  const s = wordsToSegments(w);
  assert.equal(s.length, 2);
  assert.equal(s[0].text, "Ahoj světe.");
});

test("keyword filter is accent-insensitive", () => {
  const c = { title: "Dochazka fix", description_excerpt: "", labels: [] as string[] };
  assert.ok(matchesKeywords(c, ["docházka"]));
  assert.ok(!matchesKeywords(c, ["payroll"]));
});

test("changes degrades gracefully without key", async () => {
  const out = setup();
  const saved = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  const r = await changes({ since: "2026-01-01", out });
  if (saved) process.env.LINEAR_API_KEY = saved;
  assert.deepEqual(r.changes, []);
  assert.equal(r.warnings.length, 1);
});

test("scenarize --fake-llm writes valid scenario + review using new name", async () => {
  const out = setup();
  const { scenario } = await scenarize({ out, lang: "cs", audience: "employee", fakeLlm: true });
  assert.deepEqual(validateScenario(scenario), []);
  const txt = JSON.stringify(scenario);
  assert.ok(txt.includes("Nová absence"));
  assert.ok(!scenario.steps.some((s) => s.narration.includes("Přidat nepřítomnost") || s.intent.includes("'Přidat nepřítomnost'")));
  assert.equal(scenario.id, "absence-request");
  assert.ok(existsSync(join(out, "scenario.review.md")));
  assert.match(readFileSync(join(out, "scenario.review.md"), "utf8"), /What changed vs old video/);
});

test("validation rejects bad scenarios", () => {
  assert.ok(validateScenario({ id: "x", lang: "de", title: "t", audience: "employee", steps: [] }).length >= 2);
});
