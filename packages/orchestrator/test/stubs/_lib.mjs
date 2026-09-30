// Shared helpers for dry-run stubs. They emulate the file contracts of the real packages.
import fs from "node:fs";
import path from "node:path";

export function args() {
  const a = process.argv.slice(2), f = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith("--")) { const n = a[i + 1]; if (n !== undefined && !n.startsWith("--")) { f[a[i].slice(2)] = n; i++; } else f[a[i].slice(2)] = true; }
  return f;
}
export const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
export const writeJson = (p, d) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(d, null, 2)); };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function counter(out, name) {
  const f = path.join(out, `.stub-${name}-count`);
  const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, "utf8")) : 0) + 1;
  fs.writeFileSync(f, String(n));
  return n;
}
export function defaultRecipe(id) {
  return {
    id, version: 1, title: `Stub video ${id}`, lang: "cs", app_version: "stub", viewport: { width: 1920, height: 1080 },
    start: { url: "http://localhost:4173/index.html" }, voice: { provider: "mock" },
    steps: ["Úvod.", "Otevřete menu Absence.", "Klikněte na Nová absence.", "Vyplňte formulář.", "Odešlete žádost."].map((n, i) => ({
      id: `s0${i + 1}`, narration: n, actions: [{ type: "click", selector: `[data-testid=stub-${i + 1}]` }],
    })),
  };
}
