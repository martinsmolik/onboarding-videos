import { parseArgs } from "./util.js";
import { ingest } from "./ingest.js";
import { transcribe, Provider } from "./transcribe.js";
import { changes } from "./changes.js";
import { readFileSync } from "node:fs";
import { scenarize, validateScenario, lintScenario, Lang, Audience, Scenario } from "./scenarize.js";

const USAGE = `usage:
  ingest      --youtube <url> --out out/<id>
  transcribe  --out out/<id> [--provider elevenlabs|openai|local] [--language cs] [--force]
  changes     --since YYYY-MM-DD --out out/<id> [--keywords "docházka,attendance,absence"]
  scenarize   --out out/<id> --lang cs --audience employee [--title ...] [--product-notes file.md] [--since YYYY-MM-DD] [--fake-llm]
  validate    --scenario out/<id>/scenario.json      (schema + editorial rules; exit 1 on errors)`;

const need = (f: Record<string, string | true>, k: string): string => {
  const v = f[k];
  if (typeof v !== "string") {
    console.error(`missing --${k}\n${USAGE}`);
    process.exit(2);
  }
  return v;
};

const { _, flags } = parseArgs(process.argv.slice(2).filter((a) => a !== "--" ));
const cmd = _[0];
try {
  switch (cmd) {
    case "ingest": {
      const r = await ingest({ youtube: need(flags, "youtube"), out: need(flags, "out") });
      console.log(JSON.stringify({ title: r.meta.title, audio: r.audioPath, transcriptFrom: r.transcriptFrom, warnings: r.warnings }, null, 2));
      break;
    }
    case "transcribe": {
      const segs = await transcribe({ out: need(flags, "out"), provider: (flags.provider as Provider) ?? "elevenlabs", language: flags.language as string | undefined, force: !!flags.force });
      console.log(`${segs.length} segments`);
      break;
    }
    case "changes": {
      const r = await changes({ since: need(flags, "since"), out: need(flags, "out"), keywords: typeof flags.keywords === "string" ? flags.keywords.split(",") : [] });
      console.log(`${r.changes.length} changes${r.warnings.length ? " (with warnings)" : ""}`);
      break;
    }
    case "scenarize": {
      const r = await scenarize({
        out: need(flags, "out"),
        lang: need(flags, "lang") as Lang,
        audience: need(flags, "audience") as Audience,
        title: flags.title as string | undefined,
        productNotes: flags["product-notes"] as string | undefined,
        since: flags.since as string | undefined,
        fakeLlm: !!flags["fake-llm"],
      });
      console.log(`scenario.json: ${r.scenario.steps.length} steps, ${r.warnings.length} warnings`);
      break;
    }
    case "validate": {
      const sc = JSON.parse(readFileSync(need(flags, "scenario"), "utf8"));
      const errors = validateScenario(sc);
      for (const e of errors) console.log(`error: ${e}`);
      if (!errors.length) for (const w of lintScenario(sc as Scenario)) console.log(`warning: ${w}`);
      console.log(errors.length ? `INVALID (${errors.length} errors)` : `OK: ${(sc as Scenario).steps.length} steps`);
      process.exit(errors.length ? 1 : 0);
    }
    default:
      console.error(USAGE);
      process.exit(2);
  }
} catch (e) {
  console.error("ERROR:", (e as Error).message);
  process.exit(1);
}
