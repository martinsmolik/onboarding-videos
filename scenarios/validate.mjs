#!/usr/bin/env node
// Validates every scenarios/*.json against contracts/scenario.schema.json (ajv, draft 2020-12)
// plus the batch editorial rules. Exits 1 on any hard error.
// Usage: node scenarios/validate.mjs [file.json ...]
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
// ajv lives in packages/knowledge (not a root dependency); borrow it from there.
const req = createRequire(join(root, "packages/knowledge/package.json"));
const { Ajv2020 } = req("ajv/dist/2020.js");
const addFormats = req("ajv-formats").default ?? req("ajv-formats");

const schema = JSON.parse(readFileSync(join(root, "contracts/scenario.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const catalog = JSON.parse(readFileSync(join(root, "catalog/videos.json"), "utf8"));
const catalogById = new Map(catalog.sections.flatMap((s) => s.videos).map((v) => [v.id, v]));

const wc = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((f) => resolve(f))
  : readdirSync(here).filter((f) => f.endsWith(".json")).sort().map((f) => join(here, f));

let failed = 0;
for (const file of files) {
  const errors = [];
  const warnings = [];
  let sc;
  try {
    sc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    errors.push(`invalid JSON: ${e.message}`);
  }
  if (sc) {
    if (!validate(sc)) for (const e of validate.errors ?? []) errors.push(`schema: ${e.instancePath || "/"} ${e.message}`);
    const steps = Array.isArray(sc.steps) ? sc.steps : [];
    if (sc.id !== basename(file, ".json")) errors.push(`rule: id "${sc.id}" != file name`);
    const cat = catalogById.get(sc.id);
    if (!cat) errors.push(`rule: id "${sc.id}" not in catalog/videos.json`);
    else if (cat.cs && sc.source?.old_video_url !== `https://www.youtube.com/watch?v=${cat.cs}`)
      errors.push(`rule: source.old_video_url must be https://www.youtube.com/watch?v=${cat.cs}`);
    if (sc.lang !== "cs") errors.push(`rule: lang must be "cs"`);
    const wantAudience = sc.id === "absences" ? "employee" : "admin";
    if (sc.audience !== wantAudience) errors.push(`rule: audience must be "${wantAudience}"`);
    if (steps.length < 7 || steps.length > 11) errors.push(`rule: need 7-11 steps, got ${steps.length}`);
    if (!Array.isArray(sc.source?.references) || !sc.source.references.length) errors.push("rule: source.references must list help articles");
    steps.forEach((st, i) => {
      const want = `s${String(i + 1).padStart(2, "0")}`;
      if (st.id !== want) errors.push(`rule: step ${i + 1} id "${st.id}" should be "${want}"`);
      const n = wc(st.narration ?? "");
      if (n < 8 || n > 25) errors.push(`rule: ${st.id} narration has ${n} words (8-25)`);
      if (!st.must_show) errors.push(`rule: ${st.id} missing must_show`);
      if (/pravděpodobně/i.test(st.intent ?? "")) errors.push(`rule: ${st.id} "pravděpodobně" belongs in notes, not intent`);
      if (/\d/.test(st.narration ?? "")) warnings.push(`${st.id}: narration contains digits (TTS)`);
      if (/[&"'„“]/.test(st.narration ?? "")) warnings.push(`${st.id}: narration contains quotes or & (TTS)`);
      if (/\b(jednoduše|snadno|revoluční)\b/i.test(st.narration ?? "")) warnings.push(`${st.id}: marketing word in narration`);
    });
    const first = steps[0], last = steps[steps.length - 1];
    if (first && !/^No action/.test(first.intent)) errors.push("rule: s01 must be an intro with 'No action' intent");
    if (last && !/^(No action|Close )/.test(last.intent)) warnings.push(`${last.id}: last step should not teach a new action`);
  }
  const name = basename(file);
  if (errors.length) {
    failed++;
    console.error(`FAIL ${name}\n  - ${errors.join("\n  - ")}`);
  } else console.log(`ok   ${name} (${sc.steps.length} steps)`);
  for (const w of warnings) console.log(`     warn ${w}`);
}
if (failed) {
  console.error(`\n${failed} of ${files.length} scenario(s) invalid`);
  process.exit(1);
}
console.log(`\nall ${files.length} scenario(s) valid`);
