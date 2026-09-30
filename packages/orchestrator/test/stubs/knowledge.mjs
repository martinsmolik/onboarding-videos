import path from "node:path";
import { args, writeJson, sleep } from "./_lib.mjs";
const a = args();
console.log(`[stub knowledge] transcribing ${a.youtube}`); await sleep(300);
writeJson(path.join(a.out, "scenario.json"), {
  id: a.id, lang: "cs", title: `Stub ${a.id}`, audience: "employee",
  source: { old_video_url: a.youtube, changes_detected: ["stub change"] },
  steps: ["Úvod.", "Otevřete menu Absence.", "Klikněte na Nová absence.", "Vyplňte formulář.", "Odešlete žádost."].map((n, i) => ({ id: `n${i + 1}`, narration: n, intent: `stub intent ${i + 1}` })),
});
console.log("[stub knowledge] scenario.json written");
