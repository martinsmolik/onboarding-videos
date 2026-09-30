// normal: scenario.json -> recipe.json.   --heal <timing.json>: "repair" failed steps (records them in heal.json)
import fs from "node:fs";
import path from "node:path";
import { args, readJson, writeJson, defaultRecipe, sleep } from "./_lib.mjs";
const a = args();
await sleep(300);
const recipeP = path.join(a.out, "recipe.json");
if (a.heal) {
  const t = readJson(a.heal);
  const failed = t.steps.filter((s) => s.status === "failed").map((s) => s.id);
  const hp = path.join(a.out, "heal.json");
  const prev = fs.existsSync(hp) ? readJson(hp) : { healed: [] };
  writeJson(hp, { healed: [...new Set([...prev.healed, ...failed])] });
  const r = readJson(recipeP);
  for (const s of r.steps) if (failed.includes(s.id)) s.actions = [{ type: "click", selector: `[data-testid=healed-${s.id}]` }];
  writeJson(recipeP, r);
  console.log(`[stub explorer] healed steps: ${failed.join(", ")}`);
} else {
  const sc = path.join(a.out, "scenario.json");
  const r = defaultRecipe(a.id);
  if (fs.existsSync(sc)) r.title = readJson(sc).title;
  writeJson(recipeP, r);
  console.log("[stub explorer] recipe.json written");
}
