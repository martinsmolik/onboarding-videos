import fs from "node:fs";
import path from "node:path";
import { isStage, loadState, STAGES } from "./state.ts";
import { listAll, oneLine, run, statusTable } from "./pipeline.ts";
import { loadDotEnv, outDir, outRoot, parseArgs, userPath } from "./util.ts";
import { uploadVideoStage } from "./upload.ts";

loadDotEnv();
const { cmd, flags } = parseArgs(process.argv.slice(2));
const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
const usage = `usage: pipeline <run|status|ls|upload> [flags]
  run    --id <id> [--from <stage>] [--to <stage>] [--recipe <path>] [--scenario <path>] [--youtube <url>]
         [--max-heal 2] [--force] [--upload] [--replace <videoId>] [--dry-run] [--lang cs --audience employee --title "..." --since YYYY-MM-DD]
  status --id <id> [--json]
  ls
  upload --id <id> [--replace <videoId>]      (upload final.mp4 only)
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
        force: !!flags.force, upload: !!flags.upload, replace: str("replace"), dryRun: !!flags["dry-run"],
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
    default:
      console.log(usage);
      process.exit(cmd ? 2 : 0);
  }
}
main().catch((e) => { console.error("pipeline error:", e.message ?? e); process.exit(1); });
void fs; void path;
