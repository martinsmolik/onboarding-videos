import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { STAGES, type Stage, type State, acquireLock, loadState, planStages, saveState } from "./state.ts";
import { exec, output } from "./exec.ts";
import { knowledgeCommands, stageCommand, timeoutFor, type Cmd, type Ctx } from "./stages.ts";
import { hasYtCreds, uploadVideoStage } from "./upload.ts";
import { now, outDir, readJson, validId, writeJsonAtomic } from "./util.ts";

export interface RunOptions {
  id: string;
  from?: Stage;
  to?: Stage;
  recipe?: string;   // absolute
  scenario?: string; // absolute
  youtube?: string;
  maxHeal?: number;
  force?: boolean;
  upload?: boolean;
  replace?: string;
  dryRun?: boolean;
  quiet?: boolean;
  /** before the first recording, heal the steps that the existing timing.json lists as failed (runner POST /heal) */
  healFirst?: boolean;
  meta?: { lang?: string; audience?: string; title?: string; since?: string };
}

const hash = (p: string) => crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
const say = (m: string) => { if (!output.quiet) console.log(m); };

function readFailedSteps(timing: string): string[] {
  const t = readJson(timing);
  return (t.steps ?? []).filter((s: any) => s.status === "failed").map((s: any) => s.id);
}

export async function run(o: RunOptions): Promise<State> {
  if (!validId(o.id)) throw new Error(`invalid --id "${o.id}" (letters, digits, . _ - only)`);
  const out = outDir(o.id);
  fs.mkdirSync(path.join(out, "logs"), { recursive: true });
  const release = acquireLock(o.id);
  try { return await runLocked(o, out); } finally { release(); }
}

async function runLocked(o: RunOptions, out: string): Promise<State> {
  output.quiet = !!o.quiet;
  const st = loadState(o.id);
  const ctx: Ctx = {
    id: o.id, out,
    recipe: path.join(out, "recipe.json"),
    scenario: path.join(out, "scenario.json"),
    timing: path.join(out, "timing.json"),
    youtube: o.youtube, meta: o.meta ?? {}, dryRun: !!o.dryRun,
  };
  const maxHeal = o.maxHeal ?? 2;
  const logFor = (s: string) => path.join(out, "logs", `${s}.log`);

  // A different --recipe than what's in out/ invalidates explore and everything downstream.
  let force = !!o.force;
  let from = o.from;
  if (o.recipe) {
    if (!fs.existsSync(o.recipe)) throw new Error(`--recipe not found: ${o.recipe}`);
    if (!fs.existsSync(ctx.recipe) || hash(o.recipe) !== hash(ctx.recipe)) {
      say("recipe changed vs out/ -> invalidating explore and downstream stages");
      st.stages.explore.status = "pending";
      if (!from || STAGES.indexOf(from) > STAGES.indexOf("explore")) from = "explore";
    }
  }
  if (o.scenario) {
    if (!fs.existsSync(o.scenario)) throw new Error(`--scenario not found: ${o.scenario}`);
    fs.copyFileSync(o.scenario, ctx.scenario);
  }

  const plan = planStages(st, { from, to: o.to, force });
  say(`pipeline ${o.id}  plan: ${plan.map((p) => `${p.stage}:${p.action}`).join("  ")}${o.dryRun ? "  [DRY RUN]" : ""}`);

  const begin = (s: Stage) => {
    const x = st.stages[s];
    Object.assign(x, { status: "running", started_at: now(), finished_at: null, error: null, attempts: x.attempts + 1 });
    delete x.note;
    saveState(st);
    say(`\n>> ${s} (attempt ${x.attempts})`);
  };
  const finish = (s: Stage, status: "done" | "failed" | "pending", error?: string, note?: string) => {
    const x = st.stages[s];
    x.status = status; x.finished_at = now(); x.error = error ?? null;
    if (note) x.note = note; 
    saveState(st);
    say(`<< ${s}: ${status}${note ? ` (${note})` : ""}${error ? ` – ${error}` : ""}`);
  };
  const runCmd = (stage: Stage | "heal", logStage: Stage) => runRaw(stageCommand(stage, ctx), logStage, stage === "heal" ? "explore" : stage);
  const runRaw = (cmd: Cmd, logStage: Stage, timeoutStage: Stage) => exec({ ...cmd, logFile: logFor(logStage), timeoutMs: timeoutFor(timeoutStage) });
  const fail = (s: Stage, msg: string): State => { finish(s, "failed", msg); summary(st); return st; };

  for (const { stage, action } of plan) {
    if (action === "out-of-range") continue;
    if (action === "skip-done") { say(`-- ${stage}: already done, skipping (use --force)`); continue; }

    try {
      switch (stage) {
        case "knowledge": {
          if (!o.youtube) { say("-- knowledge: no --youtube, skipped"); st.stages.knowledge.note = "skipped: no --youtube"; saveState(st); continue; }
          begin(stage);
          let r = { code: 0 as number | null, timedOut: false };
          for (const c of knowledgeCommands(ctx)) { r = await runRaw(c, stage, stage); if (r.code !== 0) break; }
          if (r.code !== 0 || !fs.existsSync(ctx.scenario)) return fail(stage, r.timedOut ? "timeout" : `exit ${r.code}${fs.existsSync(ctx.scenario) ? "" : ", no scenario.json"}`);
          finish(stage, "done");
          break;
        }
        case "explore": {
          if (o.recipe) {
            begin(stage);
            fs.copyFileSync(o.recipe, ctx.recipe);
            finish(stage, "done", undefined, "recipe provided");
            break;
          }
          if (!fs.existsSync(ctx.scenario)) {
            if (fs.existsSync(ctx.recipe)) { say("-- explore: recipe.json already present, no scenario -> skipped"); st.stages.explore.status = "done"; st.stages.explore.note = "existing recipe"; saveState(st); continue; }
            return fail(stage, "no scenario.json and no --recipe: give --youtube, --scenario or --recipe");
          }
          begin(stage);
          const r = await runCmd(stage, stage);
          if (r.code !== 0 || !fs.existsSync(ctx.recipe)) return fail(stage, r.timedOut ? "timeout" : `exit ${r.code}${fs.existsSync(ctx.recipe) ? "" : ", no recipe.json"}`);
          finish(stage, "done");
          break;
        }
        case "tts": {
          if (!fs.existsSync(ctx.recipe)) return fail(stage, "recipe.json missing");
          begin(stage);
          const r = await runCmd(stage, stage);
          if (r.code !== 0) return fail(stage, r.timedOut ? "timeout" : `exit ${r.code}`);
          finish(stage, "done");
          break;
        }
        case "record": {
          if (!fs.existsSync(ctx.recipe)) return fail(stage, "recipe.json missing");
          begin(stage);
          const res = await recordWithHeal(maxHeal);
          if (!res.ok) return fail(stage, res.error);
          finish(stage, "done", undefined, res.heals ? `healed ${res.heals}x` : undefined);
          st.failed_steps = [];
          break;
        }
        case "mux": {
          begin(stage);
          const r = await runCmd(stage, stage);
          if (r.code !== 0 || !fs.existsSync(path.join(out, "final.mp4"))) return fail(stage, r.timedOut ? "timeout" : `exit ${r.code}${fs.existsSync(path.join(out, "final.mp4")) ? "" : ", no final.mp4"}`);
          finish(stage, "done");
          break;
        }
        case "upload": {
          if (!o.upload && !hasYtCreds() && !o.dryRun) {
            say("-- upload: no YT credentials (and no --upload), skipped");
            st.stages.upload.note = "skipped: no YT credentials"; saveState(st); continue;
          }
          begin(stage);
          const logf = logFor("upload");
          let videoId: string, url: string;
          if (o.dryRun) {
            const r = await runCmd(stage, stage);
            if (r.code !== 0) return fail(stage, `exit ${r.code}`);
            ({ videoId, url } = readJson(path.join(out, "upload.json")));
          } else {
            const lines: string[] = [];
            const res = await uploadVideoStage(o.id, out, { replace: o.replace }, (m) => { say("  " + m); lines.push(`${now()} ${m}`); });
            fs.appendFileSync(logf, lines.join("\n") + "\n");
            ({ videoId, url } = res);
          }
          st.video_url = url; st.video_id = videoId;
          finish(stage, "done");
          break;
        }
      }
    } catch (e: any) {
      return fail(stage, e?.message ?? String(e));
    }
  }
  summary(st);
  return st;

  // ---- record + self-heal loop ----
  async function recordWithHeal(max: number): Promise<{ ok: true; heals: number } | { ok: false; error: string }> {
    let heals = 0;
    if (o.healFirst && fs.existsSync(ctx.timing)) {
      const pre = readFailedSteps(ctx.timing);
      if (pre.length) {
        say(`~~ heal-first: explorer --heal for ${pre.join(", ")} from the previous timing.json, then tts (cached)`);
        const h = await runCmd("heal", "explore");
        if (h.code !== 0) return { ok: false, error: `explorer --heal exit ${h.code} (failed steps: ${pre.join(", ")})` };
        const t = await runCmd("tts", "tts");
        st.stages.tts.attempts++; saveState(st);
        if (t.code !== 0) return { ok: false, error: `tts after heal exit ${t.code}` };
      } else say("-- heal-first: previous timing.json has no failed steps, re-recording as is");
    }
    for (;;) {
      // stale timing from an earlier attempt must not be mistaken for this attempt's result
      if (fs.existsSync(ctx.timing)) fs.renameSync(ctx.timing, path.join(out, "logs", `timing.prev.json`));
      const r = await runCmd("record", "record");
      const hasTiming = fs.existsSync(ctx.timing);
      if (!hasTiming) return { ok: false, error: r.timedOut ? "record timeout, no timing.json" : `record exit ${r.code}, no timing.json` };
      fs.copyFileSync(ctx.timing, path.join(out, "logs", `timing.run${heals + 1}.json`));
      const failed = readFailedSteps(ctx.timing);
      if (r.code !== 0 && failed.length === 0) return { ok: false, error: `record exit ${r.code} (timing.json has no failed steps)` };
      if (failed.length === 0) return { ok: true, heals };
      st.failed_steps = failed;
      saveState(st);
      say(`!! record: failed steps ${failed.join(", ")}  (heals used ${heals}/${max})`);
      if (heals >= max) return { ok: false, error: `steps still failing after ${heals} heal(s): ${failed.join(", ")}` };
      heals++;
      st.stages.record.attempts++;
      say(`~~ heal ${heals}/${max}: explorer --heal, then tts (cached), then re-record`);
      const h = await runCmd("heal", "explore");
      if (h.code !== 0) return { ok: false, error: `explorer --heal exit ${h.code} (failed steps: ${failed.join(", ")})` };
      const t = await runCmd("tts", "tts");
      st.stages.tts.attempts++; saveState(st);
      if (t.code !== 0) return { ok: false, error: `tts after heal exit ${t.code}` };
    }
  }
}

const SYM: Record<string, string> = { pending: "·", running: "…", done: "✓", failed: "✗" };
const dur = (s: { started_at: string | null; finished_at: string | null }) =>
  s.started_at && s.finished_at ? `${((Date.parse(s.finished_at) - Date.parse(s.started_at)) / 1000).toFixed(1)}s` : "";

export function statusTable(st: State): string {
  const rows = STAGES.map((s) => {
    const x = st.stages[s];
    return `  ${s.padEnd(10)} ${`${SYM[x.status]} ${x.status}`.padEnd(11)} ${String(x.attempts).padStart(2)}x  ${dur(x).padEnd(8)} ${x.error ? "ERR " + x.error : x.note ?? ""}`;
  });
  return [`${st.id}  ${st.video_url ?? ""}`, `  ${"stage".padEnd(10)} ${"status".padEnd(11)} tries  time     note`, ...rows].join("\n");
}
export function summary(st: State): void { if (!output.quiet) console.log("\n" + statusTable(st)); }

export function listAll(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "state.json"))).map((d) => d.name);
}
export function oneLine(st: State): string {
  const cells = STAGES.map((s) => `${s.slice(0, 4)}${SYM[st.stages[s].status]}`).join(" ");
  return `${st.id.padEnd(28)} ${cells}  ${st.video_url ?? ""}`;
}
void writeJsonAtomic;
