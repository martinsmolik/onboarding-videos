// Step STUB_FAIL_STEP (default s03) fails until explorer has healed it (heal.json) -> exercises the heal loop.
// STUB_ALWAYS_FAIL=1 makes it fail forever (exercises max-heal exhaustion).
import fs from "node:fs";
import path from "node:path";
import { args, readJson, writeJson, sleep, counter } from "./_lib.mjs";
const a = args();
const n = counter(a.out, "record");
const r = readJson(path.join(a.out, "recipe.json"));
const dur = readJson(path.join(a.out, "audio", "durations.json"));
const failId = process.env.STUB_FAIL_STEP || "s03";
const healed = fs.existsSync(path.join(a.out, "heal.json")) ? readJson(path.join(a.out, "heal.json")).healed : [];
let t = 0; const steps = [];
console.log(`[stub recorder] run #${n}`);
for (const s of r.steps) {
  const audio = dur[s.id] ?? 0;
  const bad = s.id === failId && (process.env.STUB_ALWAYS_FAIL === "1" || !healed.includes(s.id));
  const end = t + Math.max(audio, 1200) + 800;
  steps.push({ id: s.id, t_start_ms: t, t_actions_end_ms: t + 600, t_end_ms: end, audio_ms: audio, status: bad ? "failed" : "ok",
    ...(bad ? { error: `locator.click: Timeout 5000ms exceeded for ${s.actions?.[0]?.selector}` } : {}), screenshot: `shots/${s.id}.png` });
  console.log(`[stub recorder] ${s.id} ${bad ? "FAILED" : "ok"}`);
  t = end; await sleep(60);
}
fs.mkdirSync(path.join(a.out, "shots"), { recursive: true });
fs.writeFileSync(path.join(a.out, "raw.webm"), "stub-webm");
writeJson(path.join(a.out, "timing.json"), { recipe_id: r.id, video_path: path.join(a.out, "raw.webm"), fps: 25, total_ms: t, recorded_at: new Date().toISOString(), steps });
process.exit(steps.some((s) => s.status === "failed") ? 1 : 0);
