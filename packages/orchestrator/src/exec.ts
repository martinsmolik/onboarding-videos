import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./util.ts";

export const output = { quiet: false };

export interface ExecOpts {
  cmd: string;
  args: string[];
  shell?: boolean;
  logFile: string;
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}
export interface ExecResult { code: number | null; signal: string | null; timedOut: boolean }

/** Spawns a child, tees stdout/stderr to the console (what "inherited stdio" would show) AND to a log file. */
export function exec(o: ExecOpts): Promise<ExecResult> {
  fs.mkdirSync(path.dirname(o.logFile), { recursive: true });
  const log = fs.createWriteStream(o.logFile, { flags: "a" });
  const shown = [o.cmd, ...o.args].join(" ");
  log.write(`\n===== ${new Date().toISOString()} $ ${shown}\n`);
  if (!output.quiet) console.log(`  $ ${shown}`);
  return new Promise((resolve) => {
    const child = spawn(o.cmd, o.args, {
      cwd: o.cwd ?? repoRoot(),
      env: { ...process.env, ...o.env, FORCE_COLOR: "0" },
      shell: o.shell ?? false,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      log.write(`\n[orchestrator] timeout after ${o.timeoutMs}ms – SIGTERM\n`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, o.timeoutMs);
    const pipeTo = (src: NodeJS.ReadableStream, dst: NodeJS.WriteStream) =>
      src.on("data", (b: Buffer) => { if (!output.quiet) dst.write(b); log.write(b); });
    pipeTo(child.stdout!, process.stdout);
    pipeTo(child.stderr!, process.stderr);
    const done = (code: number | null, signal: string | null, extra = "") => {
      clearTimeout(timer);
      log.write(`\n[orchestrator] exit code=${code} signal=${signal}${extra}\n`);
      log.end(() => resolve({ code, signal, timedOut }));
    };
    child.on("error", (e) => done(127, null, ` spawn error: ${e.message}`));
    child.on("close", (code, signal) => done(code, signal));
  });
}
