import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// isolate out/ BEFORE importing modules that read the env lazily
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svp-orch-"));
process.env.SVP_OUT_DIR = tmp;
delete process.env.YT_CLIENT_ID;
const { run } = await import("../src/pipeline.ts");
const { loadState, planStages, newState } = await import("../src/state.ts");

const base = { dryRun: true, quiet: true, youtube: "https://youtu.be/x" } as const;
const counts = (id: string) => Number(fs.readFileSync(path.join(tmp, id, ".stub-record-count"), "utf8"));
const quiet = async <T>(f: () => Promise<T>) => f();

test("planStages: --from implies redo of that stage and later, earlier stay untouched", () => {
  const st = newState("x"); for (const s of Object.values(st.stages)) s.status = "done";
  const p = Object.fromEntries(planStages(st, { from: "record" }).map((x) => [x.stage, x.action]));
  assert.deepEqual(p, { knowledge: "out-of-range", explore: "out-of-range", tts: "out-of-range", record: "run", mux: "run", upload: "run" });
  const q = Object.fromEntries(planStages(st, {}).map((x) => [x.stage, x.action]));
  assert.ok(Object.values(q).every((a) => a === "skip-done"));
  const f = planStages(st, { force: true, to: "tts" }).map((x) => x.action);
  assert.deepEqual(f, ["run", "run", "run", "out-of-range", "out-of-range", "out-of-range"]);
});

test("full dry run heals s03 and finishes", async () => {
  const st = await quiet(() => run({ id: "t1", ...base }));
  for (const s of ["knowledge", "explore", "tts", "record", "mux", "upload"] as const) assert.equal(st.stages[s].status, "done", s);
  assert.equal(counts("t1"), 2, "record ran twice (fail then heal)");
  assert.equal(st.stages.record.attempts, 2);
  assert.ok(st.video_url?.startsWith("https://youtu.be/"));
  assert.deepEqual(loadState("t1").stages.record.note, "healed 1x");
});

test("rerun is idempotent, --from record redoes record+, --force redoes all", async () => {
  await quiet(() => run({ id: "t1", ...base }));
  assert.equal(counts("t1"), 2, "nothing re-ran");
  await quiet(() => run({ id: "t1", ...base, from: "mux" }));
  assert.equal(counts("t1"), 2, "record untouched by --from mux");
  assert.equal(loadState("t1").stages.mux.attempts, 2);
  await quiet(() => run({ id: "t1", ...base, from: "record", to: "record" }));
  assert.equal(counts("t1"), 3, "record re-ran once (already healed => no failure)");
  assert.equal(loadState("t1").stages.mux.attempts, 2, "--to record stopped before mux");
  await quiet(() => run({ id: "t1", ...base, force: true, to: "tts" }));
  assert.equal(loadState("t1").stages.tts.attempts > 2, true);
  assert.equal(loadState("t1").stages.record.attempts >= 2, true);
});

test("heal exhausted -> record failed with step ids; resume after fix", async () => {
  process.env.STUB_ALWAYS_FAIL = "1";
  const st = await quiet(() => run({ id: "t2", ...base, maxHeal: 2, to: "record" }));
  delete process.env.STUB_ALWAYS_FAIL;
  assert.equal(st.stages.record.status, "failed");
  assert.match(st.stages.record.error!, /s03/);
  assert.match(st.stages.record.error!, /2 heal/);
  assert.equal(counts("t2"), 3);
  // the failed stage is retried on rerun, done stages are not
  const again = await quiet(() => run({ id: "t2", ...base, maxHeal: 2 }));
  assert.equal(again.stages.record.status, "done");
  assert.equal(again.stages.explore.attempts, 1);
  assert.equal(again.stages.mux.status, "done");
});

test("--recipe skips explore, and a changed recipe invalidates downstream", async () => {
  const r1 = path.join(tmp, "r1.json");
  fs.writeFileSync(r1, JSON.stringify({ id: "t3", version: 1, lang: "cs", viewport: { width: 1, height: 1 }, start: { url: "x" }, steps: [{ id: "s01", narration: "Ahoj svete.", actions: [] }] }));
  const st = await quiet(() => run({ id: "t3", dryRun: true, quiet: true, recipe: r1 }));
  assert.equal(st.stages.explore.note, "recipe provided");
  assert.equal(st.stages.knowledge.status, "pending");
  assert.equal(st.stages.record.status, "done");
  const tts1 = st.stages.tts.attempts;
  fs.writeFileSync(r1, fs.readFileSync(r1, "utf8").replace("Ahoj", "Nazdar"));
  const st2 = await quiet(() => run({ id: "t3", dryRun: true, quiet: true, recipe: r1 }));
  assert.equal(st2.stages.tts.attempts, tts1 + 1);
});

test("a second concurrent run is refused by the lock", async () => {
  const p = run({ id: "t4", ...base });
  await assert.rejects(() => run({ id: "t4", ...base }), /already running/);
  await quiet(() => p);
});
