// The e2e fixture needs a 34 s raw.webm (timing.json total_ms) and one mp3 per step
// (audio/durations.json), but *.webm / *.mp3 are gitignored. Generate deterministic
// synthetic media once; later runs reuse it.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const FIXTURE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "fixture");

function generate(out: string, args: string[]): void {
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return;
  const tmp = `${out}.${process.pid}.tmp${path.extname(out)}`;
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", ...args, tmp], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`could not generate test fixture ${out}: ${r.stderr}`);
  fs.renameSync(tmp, out);
}

export function ensureFixtureVideo(dir = FIXTURE_DIR): void {
  generate(path.join(dir, "raw.webm"), ["-i", "testsrc2=s=1920x1080:r=25:d=34",
    "-c:v", "libvpx", "-b:v", "400k", "-deadline", "realtime", "-cpu-used", "8", "-an"]);
  const durations: Record<string, number> = JSON.parse(fs.readFileSync(path.join(dir, "audio", "durations.json"), "utf8"));
  for (const [id, ms] of Object.entries(durations))
    generate(path.join(dir, "audio", `${id}.mp3`), ["-i", "sine=frequency=300:sample_rate=22050",
      "-t", (ms / 1000).toFixed(3), "-c:a", "libmp3lame"]);
}
