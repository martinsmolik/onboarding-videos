import path from "node:path";
import { pkgDir } from "./util.ts";
import type { Stage } from "./state.ts";

export interface Ctx {
  id: string;
  out: string;          // absolute out/<id>
  recipe: string;       // out/<id>/recipe.json
  scenario: string;     // out/<id>/scenario.json
  timing: string;       // out/<id>/timing.json
  youtube?: string;
  meta: { lang?: string; audience?: string; title?: string; since?: string };
  dryRun: boolean;
}
export interface Cmd { cmd: string; args: string[]; shell?: boolean }

const pnpm = (pkg: string, ...a: string[]): Cmd => ({ cmd: "pnpm", args: ["--filter", `@svp/${pkg}`, "start", "--", ...a] });

export const DEFAULT_TIMEOUT_MS: Record<Stage, number> = {
  knowledge: 10 * 60_000,
  explore: 20 * 60_000,
  tts: 5 * 60_000,
  record: 10 * 60_000,
  mux: 10 * 60_000,
  upload: 15 * 60_000,
};
export const timeoutFor = (s: Stage) => Number(process.env[`SVP_TIMEOUT_${s.toUpperCase()}_MS`]) || DEFAULT_TIMEOUT_MS[s];

/**
 * Escape hatch: SVP_CMD_<STAGE> (e.g. SVP_CMD_RECORD) replaces the command with a shell template.
 * Placeholders: {id} {out} {recipe} {scenario} {timing} {youtube}. Lets people fix CLI drift on stage day without a code change.
 */
function template(t: string, c: Ctx): Cmd {
  const map: Record<string, string> = { id: c.id, out: c.out, recipe: c.recipe, scenario: c.scenario, timing: c.timing, youtube: c.youtube ?? "" };
  return { cmd: t.replace(/\{(\w+)\}/g, (_, k) => JSON.stringify(map[k] ?? "")), args: [], shell: true };
}

export function stageCommand(stage: Stage | "heal", c: Ctx): Cmd {
  const key = `SVP_CMD_${stage.toUpperCase()}`;
  if (c.dryRun) {
    const stub = path.join(pkgDir, "test/stubs", `${stage === "heal" ? "explore" : stage}.mjs`);
    const args = [stub, "--id", c.id, "--out", c.out];
    if (stage === "heal") args.push("--heal", c.timing);
    if (stage === "knowledge") args.push("--youtube", c.youtube ?? "");
    return { cmd: process.execPath, args };
  }
  if (process.env[key]) return template(process.env[key]!, c);
  switch (stage) {
    case "knowledge":
      return knowledgeCommands(c)[0]; // only used for the dry-run/override path; real runs use knowledgeCommands()
    case "explore":
      return pnpm("explorer", "--scenario", c.scenario, "--out", c.out);
    case "heal":
      return pnpm("explorer", "--heal", c.timing, "--recipe", c.recipe, "--scenario", c.scenario, "--out", c.out);
    case "tts":
      return pnpm("assembler", "tts", "--recipe", c.recipe, "--out", c.out);
    case "record":
      return pnpm("recorder", "--recipe", c.recipe, "--out", c.out);
    case "mux":
      return pnpm("assembler", "mux", "--out", c.out);
    default:
      throw new Error(`no external command for stage ${stage}`);
  }
}

/** knowledge is a multi-command CLI: ingest (download+captions) > transcribe > [changes] > scenarize */
export function knowledgeCommands(c: Ctx): Cmd[] {
  if (c.dryRun || process.env.SVP_CMD_KNOWLEDGE) return [stageCommand("knowledge", c)];
  const cmds = [
    pnpm("knowledge", "ingest", "--youtube", c.youtube ?? "", "--out", c.out),
    pnpm("knowledge", "transcribe", "--out", c.out, ...(c.meta.lang ? ["--language", c.meta.lang] : [])),
  ];
  if (c.meta.since) cmds.push(pnpm("knowledge", "changes", "--since", c.meta.since, "--out", c.out));
  const sc = ["scenarize", "--out", c.out, "--lang", c.meta.lang ?? "cs", "--audience", c.meta.audience ?? "employee"];
  if (c.meta.title) sc.push("--title", c.meta.title);
  if (c.meta.since) sc.push("--since", c.meta.since);
  cmds.push(pnpm("knowledge", ...sc));
  return cmds;
}
