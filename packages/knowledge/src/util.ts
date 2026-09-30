import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { spawn } from "node:child_process";

export type Segment = { start_ms: number; end_ms: number; text: string };

export function log(...a: unknown[]) {
  console.error("[knowledge]", ...a);
}

export function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
}

export function writeJson(path: string, data: unknown) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function writeText(path: string, text: string) {
  ensureDir(dirname(path));
  writeFileSync(path, text);
}

export function readJsonIfExists<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readTextIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export const srcDir = (out: string) => join(out, "source");
export const recipeIdFromOut = (out: string) => basename(resolve(out));

export function fmtTs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** segments -> "[mm:ss] text" lines */
export function segmentsToText(segs: Segment[]): string {
  return segs.map((s) => `[${fmtTs(s.start_ms)}] ${s.text}`).join("\n") + "\n";
}

export function writeTranscript(out: string, segs: Segment[]) {
  writeJson(join(srcDir(out), "transcript.json"), segs);
  writeText(join(srcDir(out), "transcript.txt"), segmentsToText(segs));
}

export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const t = opts.timeoutMs ? setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs) : undefined;
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => {
      if (t) clearTimeout(t);
      res({ code: 127, stdout, stderr: stderr + String(e) });
    });
    p.on("close", (code) => {
      if (t) clearTimeout(t);
      res({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** minimal --flag value parser; bare --flag => true */
export function parseArgs(argv: string[]): { _: string[]; flags: Record<string, string | true> } {
  const _: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else _.push(a);
  }
  return { _, flags };
}
