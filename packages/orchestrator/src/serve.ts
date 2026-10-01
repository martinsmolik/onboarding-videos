/**
 * Runner: a tiny HTTP control surface so n8n (Cloud or self-hosted) can drive the pipeline.
 *
 *   n8n ──HTTP──▶ runner (this file, node:http) ──spawn──▶ `cli.ts run ...` ──▶ stage CLIs (Playwright, ffmpeg, LLM)
 *   n8n ◀──callback POST── runner (when a job ends)
 *
 * Every job is a child process running the existing CLI state machine (same code path as a human typing
 * `pnpm pipeline run`), so a crash in a stage can never take the runner down, env (YT_PRIVACY) is per job,
 * and the pid lock in out/<id>/.lock keeps working against humans running the CLI by hand.
 * The runner itself only keeps a FIFO queue, writes out/<id>/runner.json + logs/runner.log, and serves files.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { STAGES, isStage, type Stage } from "./state.ts";
import { listAll } from "./pipeline.ts";
import { now, outDir, outRoot, pkgDir, readJson, repoRoot, sleep, validId, writeJsonAtomic } from "./util.ts";

export interface ServeOptions {
  port: number;
  host?: string;
  /** empty/undefined = no auth (local dev only) */
  token?: string;
  concurrency?: number;
  /** public base URL n8n/Slack should use for links (Cloudflare Tunnel / ngrok URL). Default: derived from the request Host. */
  publicUrl?: string;
  /** every job runs with --dry-run (test/stubs) */
  dryRun?: boolean;
  /** console logging (tests turn it off) */
  log?: boolean;
  callbackAttempts?: number;   // default 4 = first try + 3 retries
  callbackBackoffMs?: number;  // default 2000, doubles each retry
}
export interface RunnerServer { url: string; port: number; authEnabled: boolean; close(): Promise<void> }

type JobKind = "run" | "approve" | "heal";
type JobStatus = "queued" | "running" | "done" | "failed";
interface Job {
  id: string;
  kind: JobKind;
  args: string[];
  env: Record<string, string>;
  from: Stage;
  to: Stage;
  status: JobStatus;
  queued_at: string;
  started_at?: string;
  finished_at?: string;
  exit_code?: number | null;
  error?: string;
  child?: ChildProcess;
}
/** out/<id>/runner.json – what the runner remembers about an id across jobs and restarts */
interface RunnerRecord {
  id: string;
  callback_url?: string;
  meta?: Record<string, unknown>;
  base_url?: string;
  dry_run?: boolean;
  last_job?: Omit<Job, "child" | "args" | "env">;
  last_callback?: { event: string; ok: boolean; attempts: number; http_status?: number; error?: string; at: string };
  history?: { kind: JobKind; status: JobStatus; queued_at: string; finished_at?: string; error?: string }[];
}

const MAX_BODY = 1_000_000;
const FILE_TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".srt": "text/plain; charset=utf-8", ".vtt": "text/vtt; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".log": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
/** never served even with a valid token: login cookies, login replay, lock/tmp files */
const DENY = [/^storage-state.*\.json$/i, /^login-actions.*\.json$/i, /^\./, /\.tmp$/i];
const YT_RE = /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//;

class HttpError extends Error { constructor(public status: number, message: string, public extra?: object) { super(message); } }

export async function startServer(o: ServeOptions): Promise<RunnerServer> {
  const token = o.token ?? "";
  const concurrency = Math.max(1, Math.floor(o.concurrency ?? 1));
  const attempts = o.callbackAttempts ?? 4;
  const backoff = o.callbackBackoffMs ?? 2000;
  const say = (m: string) => { if (o.log !== false) console.log(`${now()} [runner] ${m}`); };

  const active = new Map<string, Job>(); // queued or running, by id
  const queue: Job[] = [];
  let running = 0;
  let closing = false;
  const pendingCallbacks = new Set<Promise<unknown>>();

  // ---------- persistence ----------
  const recPath = (id: string) => path.join(outDir(id), "runner.json");
  const readRec = (id: string): RunnerRecord => { try { return readJson(recPath(id)); } catch { return { id }; } };
  const writeRec = (id: string, patch: Partial<RunnerRecord>) => {
    const r = { ...readRec(id), ...patch, id };
    writeJsonAtomic(recPath(id), r);
    return r;
  };
  const readState = (id: string): any => { try { return readJson(path.join(outDir(id), "state.json")); } catch { return null; } };
  const logPath = (id: string) => path.join(outDir(id), "logs", "runner.log");
  const appendLog = (id: string, m: string) => { fs.mkdirSync(path.dirname(logPath(id)), { recursive: true }); fs.appendFileSync(logPath(id), `${now()} [runner] ${m}\n`); };

  // a job that was queued/running when the runner died will never finish – say so instead of showing "running" forever
  for (const id of fs.existsSync(outRoot()) ? fs.readdirSync(outRoot()) : []) {
    if (!validId(id) || !fs.existsSync(recPath(id))) continue;
    const r = readRec(id);
    if (r.last_job && (r.last_job.status === "queued" || r.last_job.status === "running")) {
      writeRec(id, { last_job: { ...r.last_job, status: "failed", finished_at: now(), error: `runner restarted while job was ${r.last_job.status}` } });
    }
  }

  // ---------- auth ----------
  const sha = (s: string) => crypto.createHash("sha256").update(s).digest();
  const same = (a: string, b: string) => crypto.timingSafeEqual(sha(a), sha(b));
  /** per-id read-only token for /files links that end up in Slack: leaking one only exposes that video's files */
  const fileToken = (id: string) => crypto.createHmac("sha256", token).update(`files:${id}`).digest("base64url").slice(0, 32);
  const bearer = (req: http.IncomingMessage) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1]?.trim() ?? "";
  const requireAuth = (req: http.IncomingMessage) => {
    if (!token) return;
    if (!same(bearer(req), token)) throw new HttpError(401, "missing or wrong Authorization: Bearer <RUNNER_TOKEN>");
  };
  const requireFileAuth = (req: http.IncomingMessage, url: URL, id: string) => {
    if (!token) return;
    const q = url.searchParams.get("token") ?? "";
    if (same(bearer(req), token) || same(q, token) || same(q, fileToken(id))) return;
    throw new HttpError(401, "missing or wrong token (Authorization: Bearer or ?token=)");
  };

  // ---------- URLs ----------
  const baseFrom = (req: http.IncomingMessage) => {
    if (o.publicUrl) return o.publicUrl.replace(/\/+$/, "");
    const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() || "http";
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${o.port}`).split(",")[0].trim();
    return `${proto}://${host}`;
  };
  const fileUrl = (base: string, id: string, rel: string) =>
    `${base}/files/${encodeURIComponent(id)}/${rel.split("/").map(encodeURIComponent).join("/")}${token ? `?token=${fileToken(id)}` : ""}`;

  function filesOf(id: string, base: string) {
    const d = outDir(id);
    const has = (rel: string) => fs.existsSync(path.join(d, rel));
    const u = (rel: string) => (has(rel) ? fileUrl(base, id, rel) : null);
    const shotsDir = path.join(d, "shots");
    const shots = fs.existsSync(shotsDir)
      ? fs.readdirSync(shotsDir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => fileUrl(base, id, `shots/${f}`))
      : [];
    return {
      final_mp4: u("final.mp4"), srt: u("final.srt"), review_md: u("scenario.review.md"),
      timing: u("timing.json"), recipe: u("recipe.json"), log: u("logs/runner.log"), shots,
    };
  }

  // ---------- status ----------
  const rangeOf = (from: Stage, to: Stage) => STAGES.slice(STAGES.indexOf(from), STAGES.indexOf(to) + 1);
  function firstFailure(st: any, stages: readonly Stage[]): string | undefined {
    for (const s of stages) if (st?.stages?.[s]?.status === "failed") return `${s}: ${st.stages[s].error ?? "failed"}`;
    return undefined;
  }
  function statusOf(id: string, base: string) {
    const st = readState(id);
    const rec = readRec(id);
    const job = active.get(id);
    if (!st && !job && !fs.existsSync(recPath(id))) return null;
    let status: JobStatus | "pending";
    if (job) status = job.status;
    else if (rec.last_job) status = rec.last_job.status;
    else if (st && STAGES.some((s) => st.stages?.[s]?.status === "failed")) status = "failed";
    else if (st?.stages?.mux?.status === "done") status = "done";
    else status = "pending"; // state written by the CLI, not finished, never run through the runner
    const files = filesOf(id, base);
    const lastJob = job ? { ...job, child: undefined, args: undefined, env: undefined } : rec.last_job;
    const muxDone = st?.stages?.mux?.status === "done";
    const uploaded = st?.stages?.upload?.status === "done";
    const recipe = (() => { try { return readJson(path.join(outDir(id), "recipe.json")); } catch { return null; } })();
    return {
      id, status,
      job: lastJob ? { kind: lastJob.kind, status: lastJob.status, from: lastJob.from, to: lastJob.to, queued_at: lastJob.queued_at, started_at: lastJob.started_at ?? null, finished_at: lastJob.finished_at ?? null, error: lastJob.error ?? null } : null,
      stage: st ? (STAGES.find((s) => st.stages?.[s]?.status === "running") ?? null) : null,
      error: lastJob?.error ?? (st ? firstFailure(st, STAGES) ?? null : null),
      failed_steps: st?.failed_steps ?? [],
      title: recipe?.title ?? (rec.meta as any)?.title ?? null,
      lang: recipe?.lang ?? (rec.meta as any)?.lang ?? null,
      video_url: st?.video_url ?? null,
      video_id: st?.video_id ?? null,
      awaiting_approval: !job && muxDone && !uploaded && !st?.approval,
      approval: st?.approval ?? null,
      final_mp4_url: files.final_mp4, srt_url: files.srt, review_md_url: files.review_md, log_url: files.log,
      shots: files.shots,
      files,
      status_url: `${base}/status/${encodeURIComponent(id)}`,
      meta: rec.meta ?? {},
      state: st,
    };
  }

  // ---------- queue ----------
  const cliPath = path.join(pkgDir, "src", "cli.ts");
  function cliCommand(): { cmd: string; args: string[] } {
    try {
      // same tsx loader that `pnpm start` uses, without pnpm's ~1 s startup per job
      return { cmd: process.execPath, args: ["--import", import.meta.resolve("tsx"), cliPath] };
    } catch {
      return { cmd: "pnpm", args: ["--filter", "@svp/orchestrator", "start", "--"] };
    }
  }

  function enqueue(job: Job) {
    active.set(job.id, job);
    queue.push(job);
    writeRec(job.id, { last_job: strip(job) });
    appendLog(job.id, `queued ${job.kind}: ${job.args.join(" ")}`);
    say(`queued ${job.kind} ${job.id} (running ${running}/${concurrency}, queue ${queue.length})`);
    pump();
  }
  const strip = (j: Job) => { const { child, args, env, ...rest } = j; void child; void args; void env; return rest; };

  function pump() {
    while (!closing && running < concurrency && queue.length) start(queue.shift()!);
  }

  function start(job: Job) {
    running++;
    job.status = "running";
    job.started_at = now();
    writeRec(job.id, { last_job: strip(job) });
    const { cmd, args } = cliCommand();
    fs.mkdirSync(path.dirname(logPath(job.id)), { recursive: true });
    appendLog(job.id, `start ${job.kind}: ${cmd} ... ${job.args.join(" ")}`);
    const fd = fs.openSync(logPath(job.id), "a");
    let child: ChildProcess;
    try {
      child = spawn(cmd, [...args, ...job.args], {
        cwd: repoRoot(),
        env: { ...process.env, ...job.env, FORCE_COLOR: "0" },
        stdio: ["ignore", fd, fd],
      });
    } finally {
      fs.closeSync(fd);
    }
    job.child = child;
    say(`start ${job.kind} ${job.id} pid ${child.pid}`);
    let settled = false;
    const done = (code: number | null, err?: string) => {
      if (settled) return; settled = true;
      finish(job, code, err);
    };
    child.on("error", (e) => done(127, `spawn failed: ${e.message}`));
    child.on("exit", (code, signal) => done(code ?? (signal ? 128 : 1), signal ? `killed by ${signal}` : undefined));
  }

  function tail(id: string, n = 6): string {
    try { return fs.readFileSync(logPath(id), "utf8").trim().split("\n").slice(-n).join(" | ").slice(-600); } catch { return ""; }
  }

  function finish(job: Job, code: number | null, spawnErr?: string) {
    running--;
    active.delete(job.id);
    job.child = undefined;
    job.finished_at = now();
    job.exit_code = code;
    const st = readState(job.id);
    const range = rangeOf(job.from, job.to);
    const fail = firstFailure(st, range);
    if (spawnErr) { job.status = "failed"; job.error = spawnErr; }
    else if (fail) { job.status = "failed"; job.error = fail; }
    else if (code !== 0) {
      // the CLI exits 1 when ANY stage is failed, also one outside this job's range (e.g. an old upload failure)
      const startedMs = Date.parse(job.started_at!);
      const touched = st && range.some((s) => st.stages?.[s]?.finished_at && Date.parse(st.stages[s].finished_at) >= startedMs - 1000);
      const outside = st && STAGES.some((s) => !range.includes(s) && st.stages?.[s]?.status === "failed");
      if (touched && outside) job.status = "done";
      else { job.status = "failed"; job.error = `pipeline exited ${code}: ${tail(job.id)}`; }
    } else job.status = "done";
    if (job.status === "done") delete job.error;
    const rec = readRec(job.id);
    const history = [...(rec.history ?? []), { kind: job.kind, status: job.status, queued_at: job.queued_at, finished_at: job.finished_at, ...(job.error ? { error: job.error } : {}) }].slice(-20);
    writeRec(job.id, { last_job: strip(job), history });
    appendLog(job.id, `finished ${job.kind}: ${job.status}${job.error ? ` – ${job.error}` : ""} (exit ${code})`);
    say(`finished ${job.kind} ${job.id}: ${job.status}${job.error ? ` – ${job.error}` : ""}`);
    if (!closing) {
      const p = callback(job).catch(() => undefined).finally(() => pendingCallbacks.delete(p));
      pendingCallbacks.add(p);
    }
    pump();
  }

  async function callback(job: Job) {
    const rec = readRec(job.id);
    if (!rec.callback_url) return;
    const base = o.publicUrl?.replace(/\/+$/, "") ?? rec.base_url ?? `http://localhost:${o.port}`;
    const s = statusOf(job.id, base)!;
    const event = job.kind === "approve" ? "upload.finished" : "run.finished";
    const recordStage = s.state?.stages?.record;
    const durationMs = Date.parse(job.finished_at!) - Date.parse(job.started_at ?? job.queued_at);
    const body = {
      event, id: job.id, job: job.kind, status: job.status,
      error: job.error ?? null,
      failed_steps: s.failed_steps,
      title: s.title, lang: s.lang,
      video_url: s.video_url, video_id: s.video_id,
      files: { final_mp4: s.files.final_mp4, srt: s.files.srt, review_md: s.files.review_md, timing: s.files.timing, log: s.files.log, shots: s.files.shots },
      video_duration_s: videoDuration(job.id),
      heal_note: recordStage?.note ?? null,
      approval: s.approval,
      status_url: s.status_url,
      meta: rec.meta ?? {},
      duration_s: Math.round(durationMs / 100) / 10,
      finished_at: job.finished_at,
    };
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "svp-runner" };
    if (token) headers["x-runner-token"] = token;
    let last: { ok: boolean; http_status?: number; error?: string } = { ok: false };
    let i = 0;
    for (i = 1; i <= attempts; i++) {
      try {
        const r = await fetch(rec.callback_url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
        await r.text().catch(() => "");
        last = { ok: r.ok, http_status: r.status };
        if (r.ok) break;
        if (r.status < 500 && r.status !== 429 && r.status !== 404) break; // 404 = n8n workflow not active yet: worth a retry
        last.error = `HTTP ${r.status}`;
      } catch (e: any) {
        last = { ok: false, error: e?.message ?? String(e) };
      }
      if (i < attempts) await sleep(backoff * 2 ** (i - 1));
    }
    const lc = { event, ok: last.ok, attempts: Math.min(i, attempts), at: now(), ...(last.http_status ? { http_status: last.http_status } : {}), ...(last.error ? { error: last.error } : {}) };
    writeRec(job.id, { last_callback: lc });
    appendLog(job.id, `callback ${event} -> ${rec.callback_url}: ${last.ok ? "ok" : "FAILED"} after ${lc.attempts} attempt(s)${last.error ? ` (${last.error})` : ""}`);
    if (!last.ok) say(`callback ${event} ${job.id} FAILED: ${last.error ?? last.http_status}`);
  }

  function videoDuration(id: string): number | null {
    try {
      const t = readJson(path.join(outDir(id), "timing.json"));
      // final.mp4 = intro card + recording + outro card (assembler defaults 2.5 s + 2 s when the recipe has a title)
      return Math.round(((t.total_ms ?? 0) / 1000 + 4.5) * 10) / 10;
    } catch { return null; }
  }

  // ---------- request helpers ----------
  async function readBody(req: http.IncomingMessage): Promise<any> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, `body larger than ${MAX_BODY} bytes`);
      chunks.push(c as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) return {};
    try {
      const j = JSON.parse(text);
      if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error();
      return j;
    } catch { throw new HttpError(400, "body must be a JSON object"); }
  }
  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    const s = JSON.stringify(body, null, 2);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(s) });
    res.end(s);
  };
  const otherLock = (id: string) => {
    const f = path.join(outDir(id), ".lock");
    if (!fs.existsSync(f)) return null;
    const pid = Number(fs.readFileSync(f, "utf8").trim());
    try { process.kill(pid, 0); return pid; } catch { return null; }
  };
  const ensureIdle = (id: string) => {
    const j = active.get(id);
    if (j) throw new HttpError(409, `a ${j.kind} job for "${id}" is already ${j.status}`, { status_url: `/status/${id}` });
    const pid = otherLock(id);
    if (pid) throw new HttpError(409, `"${id}" is being run outside the runner (pid ${pid}, out/${id}/.lock)`);
  };
  const str = (v: unknown, name: string, max = 300): string | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string") throw new HttpError(400, `${name} must be a string`);
    if (v.length > max) throw new HttpError(400, `${name} longer than ${max} chars`);
    if (v.startsWith("--")) throw new HttpError(400, `${name} must not start with "--"`);
    return v;
  };
  const bool = (v: unknown, name: string) => {
    if (v === undefined || v === null) return false;
    if (typeof v !== "boolean") throw new HttpError(400, `${name} must be a boolean`);
    return v;
  };
  const stageOf = (v: unknown, name: string): Stage | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || !isStage(v)) throw new HttpError(400, `${name} must be one of ${STAGES.join("|")}`);
    return v;
  };
  const intOf = (v: unknown, name: string, min: number, max: number) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${name} must be an integer ${min}..${max}`);
    return v;
  };
  const httpUrl = (v: unknown, name: string) => {
    const s = str(v, name, 2000); if (!s) return undefined;
    try { const u = new URL(s); if (u.protocol === "http:" || u.protocol === "https:") return s; } catch { /* fallthrough */ }
    throw new HttpError(400, `${name} must be an http(s) URL`);
  };
  /** recipe/scenario: a path inside the repo (relative = repo root) or an inline JSON object */
  const inputFile = (v: unknown, name: "recipe" | "scenario", id: string): string | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v === "object" && !Array.isArray(v)) {
      const f = path.join(outRoot(), "_incoming", `${id}.${name}.json`);
      writeJsonAtomic(f, v);
      return f;
    }
    if (typeof v !== "string") throw new HttpError(400, `${name} must be a repo-relative path or a JSON object`);
    const root = fs.realpathSync(repoRoot());
    const abs = path.resolve(root, v);
    if (!fs.existsSync(abs)) throw new HttpError(400, `${name} not found: ${v}`);
    const real = fs.realpathSync(abs);
    if (!real.startsWith(root + path.sep) || !real.endsWith(".json")) throw new HttpError(400, `${name} must be a .json file inside the repo`);
    return real;
  };
  /** a new recording needs a new review: drop the current decision (history is kept) */
  const resetApproval = (id: string) => {
    const st = readState(id);
    if (st?.approval) { delete st.approval; writeJsonAtomic(path.join(outDir(id), "state.json"), st); }
  };
  const idOf = (v: unknown) => {
    if (typeof v !== "string" || !validId(v)) throw new HttpError(400, `invalid id "${String(v)}" (letters, digits, . _ - ; max 81 chars; must start with a letter or digit)`);
    return v;
  };

  // ---------- handlers ----------
  async function postRun(req: http.IncomingMessage, res: http.ServerResponse) {
    const b = await readBody(req);
    const id = idOf(b.id);
    const meta = b.meta === undefined ? {} : b.meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new HttpError(400, "meta must be an object");
    if (JSON.stringify(meta).length > 16_000) throw new HttpError(400, "meta larger than 16 kB");
    const from = stageOf(b.from, "from");
    const to = stageOf(b.to, "to") ?? "mux"; // default: stop before upload, the Slack approval gate publishes
    if (from && STAGES.indexOf(from) > STAGES.indexOf(to)) throw new HttpError(400, `from (${from}) is after to (${to})`);
    const youtube = str(b.youtube_url, "youtube_url", 500);
    if (youtube && !YT_RE.test(youtube)) throw new HttpError(400, "youtube_url must be a https YouTube URL");
    const pick = (k: string) => (b[k] ?? (meta as any)[k]);
    const lang = str(pick("lang"), "lang", 10);
    const audience = str(pick("audience"), "audience", 40);
    const title = str(pick("title"), "title", 200);
    const since = str(pick("since"), "since", 10);
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new HttpError(400, "since must be YYYY-MM-DD");
    const maxHeal = intOf(b.max_heal, "max_heal", 0, 10);
    const callbackUrl = httpUrl(b.callback_url, "callback_url");
    const force = bool(b.force, "force");
    const dry = !!o.dryRun || bool(b.dry_run, "dry_run");
    ensureIdle(id);
    const recipe = inputFile(b.recipe, "recipe", id);
    const scenario = inputFile(b.scenario, "scenario", id);
    const d = outDir(id);
    if (!recipe && !scenario && !youtube && !fs.existsSync(path.join(d, "recipe.json")) && !fs.existsSync(path.join(d, "scenario.json")))
      throw new HttpError(400, "give recipe, scenario or youtube_url (or re-run an id whose out/<id>/ already has recipe.json / scenario.json)");

    const args = ["run", "--id", id, "--to", to];
    if (from) args.push("--from", from);
    if (force) args.push("--force");
    if (maxHeal !== undefined) args.push("--max-heal", String(maxHeal));
    if (recipe) args.push("--recipe", recipe);
    if (scenario) args.push("--scenario", scenario);
    if (youtube) args.push("--youtube", youtube);
    if (lang) args.push("--lang", lang);
    if (audience) args.push("--audience", audience);
    if (title) args.push("--title", title);
    if (since) args.push("--since", since);
    if (to === "upload") args.push("--upload");
    if (dry) args.push("--dry-run");

    const base = baseFrom(req);
    fs.mkdirSync(d, { recursive: true });
    if (STAGES.indexOf(to) >= STAGES.indexOf("record")) resetApproval(id);
    writeRec(id, { callback_url: callbackUrl, meta: { ...meta, ...(lang ? { lang } : {}), ...(title ? { title } : {}) }, base_url: base, dry_run: dry });
    enqueue({ id, kind: "run", args, env: {}, from: from ?? "knowledge", to, status: "queued", queued_at: now() });
    send(res, 202, { id, status: active.get(id)?.status ?? "queued", status_url: `${base}/status/${encodeURIComponent(id)}` });
  }

  async function postApprove(req: http.IncomingMessage, res: http.ServerResponse, id: string) {
    const b = await readBody(req);
    if (typeof b.approved !== "boolean") throw new HttpError(400, "approved (boolean) is required");
    const privacy = str(b.privacy, "privacy", 10) ?? "unlisted";
    if (!["unlisted", "private", "public"].includes(privacy)) throw new HttpError(400, "privacy must be unlisted|private|public");
    const reviewer = str(b.reviewer, "reviewer", 200);
    const comment = str(b.comment, "comment", 4000);
    const replace = str(b.replace, "replace", 20);
    if (replace && !/^[A-Za-z0-9_-]{6,20}$/.test(replace)) throw new HttpError(400, "replace must be a YouTube video id");
    const callbackUrl = httpUrl(b.callback_url, "callback_url");
    const force = bool(b.force, "force");
    ensureIdle(id);
    const st = readState(id);
    if (!st) throw new HttpError(404, `no pipeline "${id}"`);
    const approval = { approved: b.approved, privacy, reviewer: reviewer ?? null, comment: comment ?? null, ...(replace ? { replace } : {}), decided_at: now() };
    if (b.approved) {
      if (st.stages?.mux?.status !== "done" || !fs.existsSync(path.join(outDir(id), "final.mp4")))
        throw new HttpError(409, `"${id}" has no finished final.mp4 yet (mux is ${st.stages?.mux?.status ?? "pending"})`);
      if (st.stages?.upload?.status === "done" && !force)
        throw new HttpError(409, `"${id}" is already uploaded (${st.video_url}); send force:true to upload a NEW video`, { video_url: st.video_url });
    }
    st.approval = approval;
    st.approval_history = [...(st.approval_history ?? []), approval].slice(-20);
    writeJsonAtomic(path.join(outDir(id), "state.json"), st);
    appendLog(id, `approval: ${JSON.stringify(approval)}`);
    if (!b.approved) { send(res, 200, { id, approved: false, status_url: `${baseFrom(req)}/status/${encodeURIComponent(id)}` }); return; }

    const rec = readRec(id);
    const dry = !!o.dryRun || !!rec.dry_run || bool(b.dry_run, "dry_run");
    const args = ["run", "--id", id, "--from", "upload", "--to", "upload", "--upload"];
    if (replace) args.push("--replace", replace);
    if (dry) args.push("--dry-run");
    const base = baseFrom(req);
    writeRec(id, { base_url: base, ...(callbackUrl ? { callback_url: callbackUrl } : {}) });
    enqueue({ id, kind: "approve", args, env: { YT_PRIVACY: privacy }, from: "upload", to: "upload", status: "queued", queued_at: now() });
    send(res, 202, { id, status: active.get(id)?.status ?? "queued", status_url: `${base}/status/${encodeURIComponent(id)}` });
  }

  async function postHeal(req: http.IncomingMessage, res: http.ServerResponse, id: string) {
    const b = await readBody(req);
    const maxHeal = intOf(b.max_heal, "max_heal", 0, 10) ?? 2;
    const callbackUrl = httpUrl(b.callback_url, "callback_url");
    ensureIdle(id);
    if (!readState(id) || !fs.existsSync(path.join(outDir(id), "recipe.json"))) throw new HttpError(404, `no pipeline "${id}" with a recipe.json to heal`);
    const rec = readRec(id);
    const dry = !!o.dryRun || !!rec.dry_run || bool(b.dry_run, "dry_run");
    resetApproval(id);
    const args = ["run", "--id", id, "--from", "record", "--to", "mux", "--heal-first", "--max-heal", String(maxHeal)];
    if (dry) args.push("--dry-run");
    const base = baseFrom(req);
    writeRec(id, { base_url: base, ...(callbackUrl ? { callback_url: callbackUrl } : {}) });
    enqueue({ id, kind: "heal", args, env: {}, from: "record", to: "mux", status: "queued", queued_at: now() });
    send(res, 202, { id, status: active.get(id)?.status ?? "queued", status_url: `${base}/status/${encodeURIComponent(id)}` });
  }

  function getRuns(req: http.IncomingMessage, res: http.ServerResponse) {
    const base = baseFrom(req);
    const ids = new Set([...listAll(outRoot()), ...active.keys()]);
    const runs = [...ids].map((id) => {
      const s = statusOf(id, base);
      return s && { id, status: s.status, stage: s.stage, job: s.job?.kind ?? null, failed_steps: s.failed_steps, awaiting_approval: s.awaiting_approval, video_url: s.video_url, updated_at: s.state?.updated_at ?? null, status_url: s.status_url };
    }).filter(Boolean).sort((a: any, b: any) => String(b.updated_at ?? "~").localeCompare(String(a.updated_at ?? "~")));
    const queued = queue.length;
    send(res, 200, { running, queued, concurrency, free_slots: Math.max(0, concurrency - running - queued), idle: running === 0 && queued === 0, queue: queue.map((j) => j.id), runs });
  }

  function serveFile(req: http.IncomingMessage, res: http.ServerResponse, url: URL, segs: string[]) {
    const [rawId, ...rest] = segs;
    let parts: string[];
    let id: string;
    try { id = decodeURIComponent(rawId ?? ""); parts = rest.map((p) => decodeURIComponent(p)); } catch { throw new HttpError(400, "bad path encoding"); }
    if (!validId(id)) throw new HttpError(400, "invalid id");
    requireFileAuth(req, url, id);
    if (!parts.length || parts.some((p) => !p || p === "." || p === ".." || /[\\/\0]/.test(p))) throw new HttpError(400, "invalid file path");
    if (parts.some((p) => DENY.some((re) => re.test(p)))) throw new HttpError(403, "this file is never served");
    const ext = path.extname(parts[parts.length - 1]).toLowerCase();
    const type = FILE_TYPES[ext];
    if (!type) throw new HttpError(403, `file type ${ext || "(none)"} is not served`);
    const dir = outDir(id);
    const abs = path.resolve(dir, ...parts);
    if (!abs.startsWith(dir + path.sep) || !fs.existsSync(abs)) throw new HttpError(404, "not found");
    const real = fs.realpathSync(abs);
    if (!real.startsWith(fs.realpathSync(dir) + path.sep)) throw new HttpError(403, "outside out/<id>");
    const stat = fs.statSync(real);
    if (!stat.isFile()) throw new HttpError(404, "not found");

    const size = stat.size;
    const headers: Record<string, string | number> = {
      "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache",
      "last-modified": stat.mtime.toUTCString(), etag: `W/"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
      "x-content-type-options": "nosniff",
    };
    if (ext === ".srt" || ext === ".vtt" || ext === ".md" || ext === ".log") headers["content-disposition"] = `inline; filename="${parts[parts.length - 1]}"`;
    const range = req.headers.range;
    let start = 0, end = size - 1, status = 200;
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (m && (m[1] !== "" || m[2] !== "")) {
      if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
      else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
      if (start > end || start >= size) {
        res.writeHead(416, { "content-range": `bytes */${size}`, "accept-ranges": "bytes" });
        res.end();
        return;
      }
      status = 206;
      headers["content-range"] = `bytes ${start}-${end}/${size}`;
    }
    headers["content-length"] = size === 0 ? 0 : end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD" || size === 0) { res.end(); return; }
    const stream = fs.createReadStream(real, { start, end });
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  }

  // ---------- router ----------
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://runner.local");
    const segs = url.pathname.split("/").filter((s, i) => i > 0 && s !== "");
    const method = req.method ?? "GET";
    const route = segs[0] ?? "";
    try {
      if (closing) throw new HttpError(503, "runner is shutting down");
      if (route === "healthz" && segs.length === 1) {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "GET only");
        return send(res, 200, { ok: true, running, queued: queue.length, concurrency, dry_run: !!o.dryRun, auth: !!token, time: now() });
      }
      if (route === "files") {
        if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "GET only");
        return serveFile(req, res, url, segs.slice(1));
      }
      requireAuth(req);
      if (route === "runs" && segs.length === 1) {
        if (method !== "GET") throw new HttpError(405, "GET only");
        return getRuns(req, res);
      }
      if (route === "run" && segs.length === 1) {
        if (method !== "POST") throw new HttpError(405, "POST only");
        return await postRun(req, res);
      }
      if ((route === "status" || route === "approve" || route === "heal") && segs.length === 2) {
        let id: string;
        try { id = decodeURIComponent(segs[1]); } catch { throw new HttpError(400, "bad id encoding"); }
        if (!validId(id)) throw new HttpError(400, "invalid id");
        if (route === "status") {
          if (method !== "GET") throw new HttpError(405, "GET only");
          const s = statusOf(id, baseFrom(req));
          if (!s) throw new HttpError(404, `no pipeline "${id}"`);
          return send(res, 200, s);
        }
        if (method !== "POST") throw new HttpError(405, "POST only");
        return route === "approve" ? await postApprove(req, res, id) : await postHeal(req, res, id);
      }
      throw new HttpError(404, `no route ${method} ${url.pathname}`);
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) say(`500 ${method} ${url.pathname}: ${e?.stack ?? e}`);
      if (!res.headersSent) send(res, status, { error: e?.message ?? String(e), ...(e?.extra ?? {}) });
      else res.destroy();
    }
  });
  server.requestTimeout = 60_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, o.host ?? "0.0.0.0", () => { server.off("error", reject); resolve(); });
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : o.port;
  const shownHost = !o.host || o.host === "0.0.0.0" || o.host === "::" ? "localhost" : o.host;

  return {
    url: `http://${shownHost}:${port}`,
    port,
    authEnabled: !!token,
    async close() {
      closing = true;
      queue.length = 0;
      for (const j of active.values()) j.child?.kill("SIGTERM");
      await Promise.allSettled([...pendingCallbacks]);
      await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.(); });
    },
  };
}
