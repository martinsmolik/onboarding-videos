#!/usr/bin/env node
// Sequential batch: node packages/orchestrator/scripts/batch.mjs [videos.csv] [--dry-run] [--upload] [--force] [--max-heal N]
// CSV columns: id,youtube_url,lang,audience,title   (quotes and commas inside quotes are supported)
// Writes out/batch-report.md (markdown table). Never stops on a failing video.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const argv = process.argv.slice(2);
const csvPath = path.resolve(process.env.INIT_CWD || process.cwd(), argv.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)) ?? path.join(root, "videos.csv"));
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  if (["--dry-run", "--upload", "--force"].includes(argv[i])) passthrough.push(argv[i]);
  if (argv[i] === "--max-heal" && argv[i + 1]) { passthrough.push("--max-heal", argv[++i]); }
}
const outRoot = path.resolve(process.env.SVP_OUT_DIR || path.join(root, "out"));

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  const [head, ...body] = rows; const cols = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? "").trim()])));
}

if (!fs.existsSync(csvPath)) { console.error(`CSV not found: ${csvPath}\ncolumns: id,youtube_url,lang,audience,title`); process.exit(1); }
const rows = parseCsv(fs.readFileSync(csvPath, "utf8")).filter((r) => r.id);
console.log(`batch: ${rows.length} video(s) from ${csvPath} ${passthrough.join(" ")}`);

const results = [];
for (const [i, r] of rows.entries()) {
  console.log(`\n######## [${i + 1}/${rows.length}] ${r.id} ########`);
  const a = ["pipeline", "run", "--id", r.id, ...passthrough];
  if (r.youtube_url) a.push("--youtube", r.youtube_url);
  if (r.lang) a.push("--lang", r.lang);
  if (r.audience) a.push("--audience", r.audience);
  if (r.title) a.push("--title", r.title);
  const t0 = Date.now();
  const p = spawnSync("pnpm", a, { cwd: root, stdio: "inherit", env: process.env });
  let st = null; try { st = JSON.parse(fs.readFileSync(path.join(outRoot, r.id, "state.json"), "utf8")); } catch {}
  const stages = st ? Object.entries(st.stages) : [];
  const failed = stages.find(([, s]) => s.status === "failed");
  results.push({
    ...r, exit: p.status, secs: Math.round((Date.now() - t0) / 1000),
    ok: p.status === 0 && !failed,
    failedStage: failed?.[0], error: failed?.[1].error,
    heals: st?.stages?.record?.note ?? "", url: st?.video_url ?? "",
    mp4: fs.existsSync(path.join(outRoot, r.id, "final.mp4")),
  });
}

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const md = [
  `# Batch report`, ``, `Generated ${new Date().toISOString()} from \`${path.relative(root, csvPath)}\`  `,
  `${results.filter((r) => r.ok).length}/${results.length} succeeded`, ``,
  `| id | result | failed stage | heal | final.mp4 | video | time | error |`, `|---|---|---|---|---|---|---|---|`,
  ...results.map((r) => `| ${esc(r.id)} | ${r.ok ? "OK" : "FAILED"} | ${esc(r.failedStage ?? "")} | ${esc(r.heals)} | ${r.mp4 ? "yes" : "no"} | ${r.url ? esc(r.url) : ""} | ${r.secs}s | ${esc(r.error ?? "")} |`), ``,
].join("\n");
fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(path.join(outRoot, "batch-report.md"), md);
console.log("\n" + md + `\nwritten to ${path.join(outRoot, "batch-report.md")}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
