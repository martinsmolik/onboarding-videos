// Pronunciation lexicon: brand names, acronyms and loanwords the voice gets wrong, rewritten phonetically in the
// text that is SPOKEN (TTS / external manifest tts_text). Subtitles keep the original spelling.
// Rules live in config/pronunciation.json (per language, repo root) and recipe.pronunciation (per video, wins).
//   { "match": "HR", "say": "ejč ár" }                         whole word, case-sensitive
//   { "match": "absenc", "say": "apsenc", "stem": true, "case": "insensitive" }
//                                                            word starting with the stem, suffix kept: absencí -> apsencí
// Matching is on whole words (Unicode letters/digits), longest match first, applied once (no rule re-matches the
// output of another rule). Leading capital letters are preserved for case-insensitive rules.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ttsText, type StepTexts } from "./parts.js";

export interface PronRule { match: string; say: string; stem?: boolean; case?: "sensitive" | "insensitive"; note?: string }
export type Lexicon = PronRule[];

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/assembler/src
/** config/pronunciation.json of the repo (env SVP_PRONUNCIATION overrides the path). */
export function lexiconFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.SVP_PRONUNCIATION || path.join(here, "..", "..", "..", "config", "pronunciation.json");
}

function validRules(x: any, where: string): PronRule[] {
  if (!Array.isArray(x)) return [];
  return x.filter((r) => {
    const ok = r && typeof r.match === "string" && r.match.trim() && typeof r.say === "string";
    if (!ok) console.warn(`[pronunciation] ignoring invalid rule in ${where}: ${JSON.stringify(r)}`);
    return ok;
  });
}

/** Rules for a language: recipe.pronunciation first (it wins on equal matches), then the shared file. */
export function loadLexicon(lang: string | undefined, recipe: any = {}, file = lexiconFile()): Lexicon {
  let shared: any = {};
  try { if (fs.existsSync(file)) shared = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e: any) { console.warn(`[pronunciation] ${file}: ${e.message} - no shared lexicon`); }
  const own = Array.isArray(recipe?.pronunciation) ? recipe.pronunciation : recipe?.pronunciation?.[lang ?? ""];
  return [...validRules(own, "recipe.pronunciation"), ...validRules(shared[lang ?? "cs"], file)];
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const keepCase = (src: string, say: string) => (src[0] && src[0] !== src[0].toLowerCase() && say[0] ? say[0].toUpperCase() + say.slice(1) : say);

/** Apply the lexicon to spoken text. Pure; same input -> same output (it is part of the audio cache key). */
export function applyLexicon(text: string, lex: Lexicon): string {
  if (!lex.length || !text) return text;
  // one alternation, longest first, so "sick days" wins over "sick day" and nothing is rewritten twice
  const seen = new Set<string>();
  const rules = lex.filter((r) => { const k = `${r.case === "insensitive" ? r.match.toLowerCase() : r.match}|${!!r.stem}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.match.length - a.match.length);
  const B = "(?<![\\p{L}\\p{N}])", E = "(?![\\p{L}\\p{N}])";
  let res = "";
  let i = 0;
  const res0 = rules.map((r) => new RegExp(B + escRe(r.match) + (r.stem ? "(\\p{L}*)" : E), "uy" + (r.case === "insensitive" ? "i" : "")));
  while (i < text.length) {
    let hit = false;
    for (let k = 0; k < rules.length; k++) {
      const re = res0[k];
      re.lastIndex = i;
      const m = re.exec(text);
      if (!m) continue;
      const r = rules[k];
      const say = r.case === "insensitive" ? keepCase(m[0], r.say) : r.say;
      res += say + (r.stem ? m[1] ?? "" : "");
      i += m[0].length;
      hit = true;
      break;
    }
    if (!hit) { res += text[i]; i++; }
  }
  return res;
}

/** (step) => spoken text: narration_tts ?? narration, with the recipe's lexicon applied. */
export function spokenTextFor(recipe: any): (s: StepTexts) => string {
  const lex = loadLexicon(recipe?.lang, recipe);
  return (s) => applyLexicon(ttsText(s), lex);
}
