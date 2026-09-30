import fs from "node:fs";
import path from "node:path";
import { args, readJson, writeJson, sleep } from "./_lib.mjs";
const a = args();
const r = readJson(path.join(a.out, "recipe.json"));
const dir = path.join(a.out, "audio"); fs.mkdirSync(dir, { recursive: true });
const dur = {}; let cached = 0;
for (const s of r.steps) {
  const f = path.join(dir, `${s.id}.mp3`);
  const key = path.join(dir, `${s.id}.txt`);
  if (fs.existsSync(f) && fs.existsSync(key) && fs.readFileSync(key, "utf8") === s.narration) cached++;
  else { fs.writeFileSync(f, "stub-mp3"); fs.writeFileSync(key, s.narration); await sleep(40); }
  dur[s.id] = Math.round((s.narration.length / 14) * 1000);
}
writeJson(path.join(dir, "durations.json"), dur);
console.log(`[stub tts] ${r.steps.length} steps, ${cached} from cache`);
