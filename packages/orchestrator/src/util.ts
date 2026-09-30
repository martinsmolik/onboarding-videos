import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function repoRoot(): string {
  let d = here;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, "pnpm-workspace.yaml"))) return d;
    d = path.dirname(d);
  }
  return path.resolve(here, "../../..");
}
export const pkgDir = path.resolve(here, "..");
export const outRoot = () => path.resolve(process.env.SVP_OUT_DIR || path.join(repoRoot(), "out"));
export const outDir = (id: string) => path.join(outRoot(), id);
/** user-typed relative paths resolve against where the command was typed (pnpm sets INIT_CWD) */
export const userPath = (p: string) => path.resolve(process.env.INIT_CWD || process.cwd(), p);

export function loadDotEnv(file = path.join(repoRoot(), ".env")): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, ""); // inline comment
    v = v.replace(/^(["'])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined && v !== "") process.env[m[1]] = v;
  }
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

export const now = () => new Date().toISOString();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function readJson<T = any>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}
export function writeJsonAtomic(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, p);
}
export function validId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(id);
}
