// Runner HTTP service, end to end in --dry-run (test/stubs): /run -> poll /status -> /files (Range) -> /approve -> callbacks.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svp-serve-"));
process.env.SVP_OUT_DIR = tmp; // inherited by the spawned CLI children
delete process.env.YT_CLIENT_ID;
delete process.env.STUB_ALWAYS_FAIL;
delete process.env.STUB_FAIL_STEP;
const { startServer } = await import("../src/serve.ts");

const TOKEN = "test-secret";
let srv: Awaited<ReturnType<typeof startServer>>;
let cbSrv: http.Server;
let cbUrl = "";
const callbacks: { headers: http.IncomingHttpHeaders; body: any }[] = [];
let failNextCallbacks = 0; // the callback receiver answers 500 this many times first (exercises retries)

before(async () => {
  cbSrv = http.createServer(async (req, res) => {
    let s = ""; for await (const c of req) s += c;
    if (failNextCallbacks > 0) { failNextCallbacks--; res.writeHead(500).end("boom"); return; }
    callbacks.push({ headers: req.headers, body: JSON.parse(s) });
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>((r) => cbSrv.listen(0, "127.0.0.1", () => r()));
  cbUrl = `http://127.0.0.1:${(cbSrv.address() as any).port}/webhook/video-callback`;
  srv = await startServer({ port: 0, host: "127.0.0.1", token: TOKEN, concurrency: 1, dryRun: true, log: false, callbackBackoffMs: 50 });
});
after(async () => {
  await srv.close();
  await new Promise<void>((r) => cbSrv.close(() => r()));
});

const api = async (method: string, p: string, body?: unknown, auth = true) => {
  const r = await fetch(srv.url + p, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, headers: r.headers };
};
async function waitFor(id: string, pred: (s: any) => boolean, ms = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const s = await api("GET", `/status/${id}`);
    if (s.status === 200 && pred(s.json)) return s.json;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${id}: ${JSON.stringify(s.json).slice(0, 600)}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const finished = (s: any) => s.status === "done" || s.status === "failed";
async function waitCallback(pred: (b: any) => boolean, ms = 10_000) {
  const t0 = Date.now();
  for (;;) {
    const c = callbacks.find((x) => pred(x.body));
    if (c) return c;
    if (Date.now() - t0 > ms) throw new Error("callback not received; got " + JSON.stringify(callbacks.map((x) => [x.body.event, x.body.id])));
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("healthz is open, everything else needs the bearer token", async () => {
  const h = await api("GET", "/healthz", undefined, false);
  assert.equal(h.status, 200);
  assert.equal(h.json.ok, true);
  assert.equal(h.json.dry_run, true);
  assert.equal((await api("GET", "/runs", undefined, false)).status, 401);
  const wrong = await fetch(srv.url + "/runs", { headers: { authorization: "Bearer nope" } });
  assert.equal(wrong.status, 401);
  assert.equal((await api("GET", "/runs")).status, 200);
  assert.equal((await api("GET", "/nope")).status, 404);
  assert.equal((await api("GET", "/run")).status, 405);
});

test("POST /run validates input", async () => {
  assert.equal((await api("POST", "/run", { id: "../etc" })).status, 400);
  assert.equal((await api("POST", "/run", { id: "x1" })).status, 400, "no source");
  assert.equal((await api("POST", "/run", { id: "x1", youtube_url: "https://evil.example/v" })).status, 400);
  assert.equal((await api("POST", "/run", { id: "x1", recipe: "/etc/passwd" })).status, 400);
  assert.equal((await api("POST", "/run", { id: "x1", recipe: "../../../etc/hostname" })).status, 400);
  assert.equal((await api("POST", "/run", { id: "x1", youtube_url: "https://youtu.be/a", to: "fly" })).status, 400);
  assert.equal((await api("POST", "/run", { id: "x1", youtube_url: "https://youtu.be/a", from: "mux", to: "tts" })).status, 400);
  assert.equal((await api("POST", "/run", { id: "x1", youtube_url: "https://youtu.be/a", title: "--force" })).status, 400);
  assert.equal((await api("POST", "/run", { id: "x1", youtube_url: "https://youtu.be/a", callback_url: "ftp://x" })).status, 400);
  const bad = await fetch(srv.url + "/run", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{not json" });
  assert.equal(bad.status, 400);
});

test("run -> queue -> status -> files -> approve -> upload callback", async () => {
  const r1 = await api("POST", "/run", { id: "v1", youtube_url: "https://youtu.be/abc", lang: "cs", title: "Testovací video", callback_url: cbUrl, meta: { requested_by: "martin" } });
  assert.equal(r1.status, 202, JSON.stringify(r1.json));
  assert.match(r1.json.status_url, /\/status\/v1$/);
  assert.equal((await api("POST", "/run", { id: "v1", youtube_url: "https://youtu.be/abc" })).status, 409, "same id while active");

  // concurrency 1 -> the second id waits FIFO
  const recipe = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../../samples/recipe.absence-request.json"), "utf8"));
  const r2 = await api("POST", "/run", { id: "v2", recipe, callback_url: cbUrl });
  assert.equal(r2.status, 202);
  assert.equal(r2.json.status, "queued");
  const runs = await api("GET", "/runs");
  assert.equal(runs.json.running, 1);
  assert.equal(runs.json.queued, 1);
  assert.equal(runs.json.free_slots, 0);
  assert.equal(runs.json.idle, false);

  failNextCallbacks = 1; // first callback attempt for v1 gets a 500 -> runner must retry
  const s1 = await waitFor("v1", finished);
  assert.equal(s1.status, "done", JSON.stringify(s1.error));
  assert.equal(s1.state.stages.record.note, "healed 1x");
  assert.equal(s1.state.stages.upload.status, "pending", "default to=mux stops before upload");
  assert.equal(s1.awaiting_approval, true);
  assert.equal(s1.title, "Stub v1");
  assert.ok(s1.final_mp4_url.includes("/files/v1/final.mp4?token="));
  assert.ok(!s1.final_mp4_url.includes(TOKEN), "Slack links carry a per-id token, not the master token");
  assert.equal(s1.review_md_url, null);

  const cb = await waitCallback((b) => b.id === "v1" && b.event === "run.finished");
  assert.equal(cb.body.status, "done");
  assert.equal(cb.headers["x-runner-token"], TOKEN);
  assert.deepEqual(cb.body.meta, { requested_by: "martin", lang: "cs", title: "Testovací video" });
  assert.equal(cb.body.files.final_mp4, s1.final_mp4_url);
  assert.ok(cb.body.files.srt.includes("final.srt"));
  assert.equal(typeof cb.body.duration_s, "number");
  const rec = JSON.parse(fs.readFileSync(path.join(tmp, "v1", "runner.json"), "utf8"));
  assert.equal(rec.last_callback.attempts, 2, "one retry after the 500");
  assert.ok(fs.readFileSync(path.join(tmp, "v1", "logs", "runner.log"), "utf8").includes("[stub recorder]"), "CLI output goes to runner.log");

  // files: Range for video players, per-id token in the query, guards
  const full = await fetch(s1.final_mp4_url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(await full.text(), "stub-mp4");
  const part = await fetch(s1.final_mp4_url, { headers: { range: "bytes=0-3" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 0-3/8");
  assert.equal(await part.text(), "stub");
  const suffix = await fetch(s1.final_mp4_url, { headers: { range: "bytes=-3" } });
  assert.equal(await suffix.text(), "mp4");
  assert.equal((await fetch(s1.final_mp4_url, { headers: { range: "bytes=50-" } })).status, 416);
  assert.equal((await fetch(s1.final_mp4_url, { method: "HEAD" })).headers.get("content-length"), "8");
  assert.equal((await fetch(`${srv.url}/files/v1/final.srt?token=${TOKEN}`)).status, 200, "master token in query works too");
  assert.equal((await fetch(`${srv.url}/files/v1/final.mp4`)).status, 401);
  const tok = new URL(s1.final_mp4_url).searchParams.get("token");
  assert.equal((await fetch(`${srv.url}/files/v2/final.mp4?token=${tok}`)).status, 401, "v1's file token does not open v2");
  assert.equal((await fetch(`${srv.url}/files/v1/%2e%2e/v2/state.json?token=${tok}`)).status, 401, "dot segments normalise to /files/v2/..., where v1's token is useless");
  assert.equal((await fetch(`${srv.url}/files/v1/..%2Fv2%2Fstate.json?token=${tok}`)).status, 400);
  fs.writeFileSync(path.join(tmp, "v1", "storage-state.json"), "{}");
  assert.equal((await fetch(`${srv.url}/files/v1/storage-state.json?token=${tok}`)).status, 403, "login cookies never served");
  assert.equal((await fetch(`${srv.url}/files/v1/.lock?token=${tok}`)).status, 403);
  fs.mkdirSync(path.join(tmp, "v1", "shots"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "v1", "shots", "s01.png"), "png");
  const s1b = (await api("GET", "/status/v1")).json;
  assert.equal(s1b.shots.length, 1);
  assert.equal((await fetch(s1b.shots[0])).headers.get("content-type"), "image/png");

  // approve before mux is refused, approve after mux uploads (stub) and calls back
  const s2 = await waitFor("v2", finished);
  assert.equal(s2.status, "done");
  assert.equal(s2.state.stages.explore.note, "recipe provided");
  assert.equal((await api("POST", "/approve/v1", { approved: "yes" })).status, 400);
  assert.equal((await api("POST", "/approve/nope", { approved: true })).status, 404);
  const ap = await api("POST", "/approve/v1", { approved: true, privacy: "unlisted", reviewer: "martin", comment: "ok" });
  assert.equal(ap.status, 202, JSON.stringify(ap.json));
  const up = await waitFor("v1", (s) => s.job?.kind === "approve" && finished(s));
  assert.equal(up.status, "done", JSON.stringify(up.error));
  assert.match(up.video_url, /^https:\/\/youtu\.be\/STUB/);
  assert.equal(up.approval.reviewer, "martin");
  assert.equal(up.awaiting_approval, false);
  const ucb = await waitCallback((b) => b.id === "v1" && b.event === "upload.finished");
  assert.equal(ucb.body.video_url, up.video_url);
  assert.equal(ucb.body.approval.approved, true);
  const raw = JSON.parse(fs.readFileSync(path.join(tmp, "v1", "state.json"), "utf8"));
  assert.equal(raw.approval.privacy, "unlisted", "approval persisted in state.json");
  assert.equal((await api("POST", "/approve/v1", { approved: true })).status, 409, "no accidental second upload");

  // reject: stored, nothing runs
  const rj = await api("POST", "/approve/v2", { approved: false, reviewer: "martin", comment: "krok 3 je špatně" });
  assert.equal(rj.status, 200);
  const s2b = (await api("GET", "/status/v2")).json;
  assert.equal(s2b.approval.approved, false);
  assert.equal(s2b.state.stages.upload.status, "pending");

  const list = (await api("GET", "/runs")).json;
  assert.equal(list.idle, true);
  assert.deepEqual(list.runs.map((r: any) => r.id).sort(), ["v1", "v2"]);
});

test("heal: a run that exhausted its heal budget is repaired by POST /heal", async () => {
  const r = await api("POST", "/run", { id: "v3", youtube_url: "https://youtu.be/xyz", max_heal: 0, callback_url: cbUrl });
  assert.equal(r.status, 202);
  const s = await waitFor("v3", finished);
  assert.equal(s.status, "failed");
  assert.deepEqual(s.failed_steps, ["s03"]);
  assert.match(s.error, /^record: steps still failing/);
  const cb = await waitCallback((b) => b.id === "v3" && b.event === "run.finished");
  assert.equal(cb.body.status, "failed");
  assert.deepEqual(cb.body.failed_steps, ["s03"]);
  assert.ok(cb.body.files.log.includes("logs/runner.log"));
  assert.equal((await api("POST", "/approve/v3", { approved: true })).status, 409, "nothing to approve without final.mp4");

  const h = await api("POST", "/heal/v3", { max_heal: 0 });
  assert.equal(h.status, 202);
  const healed = await waitFor("v3", (x) => x.job?.kind === "heal" && finished(x));
  assert.equal(healed.status, "done", JSON.stringify(healed.error));
  assert.deepEqual(healed.failed_steps, []);
  assert.equal(healed.state.stages.mux.status, "done");
  assert.ok(fs.readFileSync(path.join(tmp, "v3", "logs", "runner.log"), "utf8").includes("heal-first"));
  assert.equal((await api("POST", "/heal/unknown")).status, 404);
});
