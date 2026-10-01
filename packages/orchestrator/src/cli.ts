import fs from "node:fs";
import path from "node:path";
import { isStage, loadState, STAGES } from "./state.ts";
import { listAll, oneLine, run, statusTable } from "./pipeline.ts";
import { loadDotEnv, outDir, outRoot, parseArgs, userPath } from "./util.ts";
import { uploadVideoStage } from "./upload.ts";
import { startServer } from "./serve.ts";

loadDotEnv();
const { cmd, flags } = parseArgs(process.argv.slice(2));
const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
const usage = `usage: pipeline <run|status|ls|upload|serve> [flags]
  run    --id <id> [--from <stage>] [--to <stage>] [--recipe <path>] [--scenario <path>] [--youtube <url>]
         [--max-heal 2] [--force] [--upload] [--replace <videoId>] [--dry-run] [--heal-first] [--lang cs --audience employee --title "..." --since YYYY-MM-DD]
  status --id <id> [--json]
  ls
  upload --id <id> [--replace <videoId>]      (upload final.mp4 only)
  serve  [--port 8790] [--host 0.0.0.0] [--token <secret>] [--concurrency 1] [--public-url https://...] [--dry-run]
         HTTP runner for n8n (env RUNNER_PORT, RUNNER_HOST, RUNNER_TOKEN, RUNNER_CONCURRENCY, RUNNER_PUBLIC_URL)
stages: ${STAGES.join(" > ")}`;

async function main() {
  switch (cmd) {
    case "run": {
      const id = str("id"); if (!id) throw new Error(usage);
      const stageFlag = (k: string) => { const v = str(k); if (v && !isStage(v)) throw new Error(`--${k} must be one of ${STAGES.join("|")}`); return v as any; };
      const st = await run({
        id, from: stageFlag("from"), to: stageFlag("to"),
        recipe: str("recipe") && userPath(str("recipe")!), scenario: str("scenario") && userPath(str("scenario")!),
        youtube: str("youtube"), maxHeal: str("max-heal") !== undefined ? Number(str("max-heal")) : 2,
        force: !!flags.force, upload: !!flags.upload, replace: str("replace"), dryRun: !!flags["dry-run"], healFirst: !!flags["heal-first"],
        meta: { lang: str("lang"), audience: str("audience"), title: str("title"), since: str("since") },
      });
      const bad = STAGES.some((s) => st.stages[s].status === "failed");
      process.exit(bad ? 1 : 0);
    }
    case "status": {
      const id = str("id"); if (!id) throw new Error(usage);
      const st = loadState(id);
      console.log(flags.json ? JSON.stringify(st, null, 2) : statusTable(st));
      return;
    }
    case "ls": {
      const ids = listAll(outRoot());
      if (!ids.length) console.log(`(no pipelines in ${outRoot()})`);
      for (const id of ids) console.log(oneLine(loadState(id)));
      return;
    }
    case "upload": {
      const id = str("id"); if (!id) throw new Error(usage);
      const r = await uploadVideoStage(id, outDir(id), { replace: str("replace") });
      console.log(JSON.stringify(r));
      return;
    }
    case "serve": {
      const num = (v: string | undefined) => (v !== undefined && v !== "" ? Number(v) : undefined);
      const srv = await startServer({
        port: num(str("port")) ?? num(process.env.RUNNER_PORT) ?? 8790,
        host: str("host") ?? process.env.RUNNER_HOST ?? "0.0.0.0",
        token: str("token") ?? process.env.RUNNER_TOKEN ?? "",
        concurrency: num(str("concurrency")) ?? num(process.env.RUNNER_CONCURRENCY) ?? 1,
        publicUrl: str("public-url") ?? process.env.RUNNER_PUBLIC_URL,
        dryRun: !!flags["dry-run"],
      });
      console.log(`runner listening on ${srv.url}  out=${outRoot()}  auth=${srv.authEnabled ? "bearer token" : "OFF (set RUNNER_TOKEN before exposing it)"}${flags["dry-run"] ? "  [DRY RUN]" : ""}`);
      const stop = () => { console.log("runner: shutting down"); srv.close().then(() => process.exit(0)); };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      return;
    }
    default:
      console.log(usage);
      process.exit(cmd ? 2 : 0);
  }
}
main().catch((e) => { console.error("pipeline error:", e.message ?? e); process.exit(1); });
void fs; void path;
