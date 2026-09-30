import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** pnpm --filter runs scripts with cwd = package dir; INIT_CWD is where the user typed the command. */
export function resolvePath(p: string): string {
  return path.resolve(process.env.INIT_CWD || process.cwd(), p);
}

export function loadEnv(): void {
  const bases = new Set([process.env.INIT_CWD, process.cwd(), path.resolve(process.cwd(), "../..")]);
  for (const b of bases) {
    if (!b) continue;
    const f = path.join(b, ".env");
    if (fs.existsSync(f)) {
      try { (process as any).loadEnvFile(f); } catch { /* ignore */ }
    }
  }
}

export function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`)),
    );
  });
}

/** Real duration of a media file in integer ms, via ffprobe. */
export async function probeDurationMs(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const s = parseFloat(stdout.trim());
  if (!Number.isFinite(s)) throw new Error(`ffprobe could not read duration of ${file}`);
  return Math.round(s * 1000);
}

export async function probeVideoSize(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [w, h] = stdout.trim().split(",").map(Number);
  return { width: w, height: h };
}

/** First PATH entry containing an executable `name`, or null. */
export function which(name: string): string | null {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, name);
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch { /* next */ }
  }
  return null;
}

export function readJson<T = any>(f: string): T {
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

export function parseArgs(argv: string[]): { cmd?: string; flags: Record<string, string | true> } {
  const a = argv.filter((x, i) => !(x === "--" && i < 2));
  const cmd = a[0] && !a[0].startsWith("--") ? a[0] : undefined;
  const flags: Record<string, string | true> = {};
  for (let i = cmd ? 1 : 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const k = a[i].slice(2);
    const nxt = a[i + 1];
    if (nxt !== undefined && !nxt.startsWith("--")) { flags[k] = nxt; i++; } else flags[k] = true;
  }
  return { cmd, flags };
}
