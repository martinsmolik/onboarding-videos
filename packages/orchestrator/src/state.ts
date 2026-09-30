import fs from "node:fs";
import path from "node:path";
import { outDir, now, readJson, writeJsonAtomic } from "./util.ts";

export const STAGES = ["knowledge", "explore", "tts", "record", "mux", "upload"] as const;
export type Stage = (typeof STAGES)[number];
export type Status = "pending" | "running" | "done" | "failed";

export interface StageState {
  status: Status;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  attempts: number;
  /** free text: "skipped: no YT credentials", "recipe provided", "healed 1x" ... */
  note?: string;
}
export interface State {
  id: string;
  stages: Record<Stage, StageState>;
  video_url: string | null;
  video_id?: string | null;
  failed_steps?: string[];
  updated_at?: string;
}

export const isStage = (s: string): s is Stage => (STAGES as readonly string[]).includes(s);
const blank = (): StageState => ({ status: "pending", started_at: null, finished_at: null, error: null, attempts: 0 });

export function newState(id: string): State {
  return { id, stages: Object.fromEntries(STAGES.map((s) => [s, blank()])) as Record<Stage, StageState>, video_url: null };
}
export const statePath = (id: string) => path.join(outDir(id), "state.json");

export function loadState(id: string): State {
  const p = statePath(id);
  if (!fs.existsSync(p)) return newState(id);
  const raw = readJson<State>(p);
  const st = newState(id);
  Object.assign(st, raw, { id });
  for (const s of STAGES) {
    st.stages[s] = { ...blank(), ...(raw.stages?.[s] ?? {}) };
    // a crashed previous run leaves "running" behind – the lock check guarantees nobody else is running
    if (st.stages[s].status === "running") {
      st.stages[s].status = "failed";
      st.stages[s].error = "interrupted (process died while running)";
    }
  }
  return st;
}
export function saveState(st: State): void {
  st.updated_at = now();
  writeJsonAtomic(statePath(st.id), st);
}

/** simple pid lock so two runs on the same id can't interleave (n8n double-fire, impatient human) */
export function acquireLock(id: string): () => void {
  const f = path.join(outDir(id), ".lock");
  fs.mkdirSync(outDir(id), { recursive: true });
  if (fs.existsSync(f)) {
    const pid = Number(fs.readFileSync(f, "utf8").trim());
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    if (alive) throw new Error(`pipeline for "${id}" is already running (pid ${pid}); remove ${f} if that is wrong`);
  }
  fs.writeFileSync(f, String(process.pid));
  const release = () => { try { fs.unlinkSync(f); } catch { /* ignore */ } };
  process.once("exit", release);
  return release;
}

/** Pure decision helper (unit-tested): which stages will actually execute? */
export function planStages(
  st: State,
  o: { from?: Stage; to?: Stage; force?: boolean },
): { stage: Stage; action: "run" | "skip-done" | "out-of-range" }[] {
  const fi = o.from ? STAGES.indexOf(o.from) : 0;
  const ti = o.to ? STAGES.indexOf(o.to) : STAGES.length - 1;
  return STAGES.map((stage, i) => {
    if (i < fi || i > ti) return { stage, action: "out-of-range" as const };
    // --from X means "redo X and everything after it"; --force means "redo everything in range"
    const forced = !!o.force || (o.from !== undefined && i >= fi);
    if (st.stages[stage].status === "done" && !forced) return { stage, action: "skip-done" as const };
    return { stage, action: "run" as const };
  });
}
