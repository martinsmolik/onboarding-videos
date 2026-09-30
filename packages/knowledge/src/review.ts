import type { Change } from "./changes.js";
import type { Scenario } from "./scenarize.js";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderReview(p: {
  scenario: Scenario;
  changes: Change[];
  meta?: { url?: string; title?: string; upload_date?: string };
  transcript?: string;
  warnings: string[];
  fake?: boolean;
}): string {
  const s = p.scenario;
  const L: string[] = [];
  L.push(`# Review: ${s.title}`, "");
  L.push(`- id: \`${s.id}\` | lang: ${s.lang} | audience: ${s.audience} | steps: ${s.steps.length}`);
  if (p.fake) L.push(`- **FIXTURE OUTPUT (--fake-llm) - not generated from real inputs**`);
  if (p.meta?.url) L.push(`- Old video: ${p.meta.title ?? ""} ${p.meta.url}${p.meta.upload_date ? ` (uploaded ${p.meta.upload_date})` : ""}`);
  if (s.source?.release_notes_since) L.push(`- Release notes since: ${s.source.release_notes_since}`);
  L.push("", "## Steps", "", "| # | Narration | Intent (what the browser agent does) | Must show |", "|---|---|---|---|");
  s.steps.forEach((st) => L.push(`| ${st.id} | ${cell(st.narration)} | ${cell(st.intent)} | ${cell(st.must_show ?? "")} |`));
  L.push("", "## What changed vs old video", "");
  const cd = s.source?.changes_detected ?? [];
  if (cd.length) cd.forEach((c) => L.push(`- ${c}`));
  else L.push("- No renamed/moved features detected.");
  if (p.changes.length) {
    L.push("", "### Source changes considered", "");
    p.changes.forEach((c) => L.push(`- ${c.identifier ? `${c.identifier}: ` : ""}${c.title} (${c.completedAt?.slice(0, 10)}${c.project ? `, ${c.project}` : ""})${c.url ? ` ${c.url}` : ""}`));
  } else L.push("", "_No Linear changes provided (empty changes.json or missing LINEAR_API_KEY)._");
  if (!p.transcript) L.push("", "_No old transcript available - scenario based on changes/notes only._");
  if (p.warnings.length) {
    L.push("", "## Warnings", "");
    p.warnings.forEach((w) => L.push(`- ${w}`));
  }
  L.push("", "## Approve?", "", "- [ ] Narration reads naturally aloud", "- [ ] Every intent names a concrete control/location", "- [ ] New names used everywhere (check list above)", "");
  return L.join("\n");
}
