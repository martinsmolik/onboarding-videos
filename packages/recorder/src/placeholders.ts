// Recipe placeholders, substituted right before replay (never written back to recipe.json):
//   {{RUN_ID}}               -> unique per recording, lowercase [a-z0-9] only, e.g. "20261001143005"
//                               (local time YYYYMMDDHHmmss; --run-id / env RUN_ID override, sanitized)
//   {{ENV:NAME}}             -> process.env.NAME (missing variable = hard error; values are never logged)
//   {{DAY:+Nd}}              -> day-of-month number (no leading zero) of today + N days; when that day is a
//                               Saturday/Sunday it moves forward to the next Monday   e.g. {{DAY:+14d}} -> "15"
//   {{DAY:+Nd+M}}            -> that (weekday-adjusted) start day + M calendar days  e.g. {{DAY:+14d+2}} -> "17"
//   {{DATE:+Nd:FMT}}         -> same date as {{DAY:+Nd}}, formatted with FMT tokens YYYY MM M DD D
//   {{DATE:+Nd+M:FMT}}          e.g. {{DATE:+14d+2:MM/DD/YYYY}} -> "10/17/2026"  (for expect strings)
//
// "today" is taken once per run, so every placeholder of one recording agrees. The start day only skips
// weekends (not public holidays); +M is plain calendar days (Mon + 2 = Wed). Pickers that open on the
// current month need the date to stay in the current month - the recorder logs a warning when it does not.
//
// Applied to every action's `value` and `selector`, to `expect.visible` / `expect.url_contains`
// and to `start.url`. Narration is NOT touched: it was synthesized before recording.
import type { Recipe } from './types.js';

const RE = /\{\{\s*(RUN_ID|ENV:([A-Za-z_][A-Za-z0-9_]*)|DAY:\+(\d{1,3})d(?:\+(\d{1,3}))?|DATE:\+(\d{1,3})d(?:\+(\d{1,3}))?:([^{}]+?))\s*\}\}/g;
/** Anything that looks like a placeholder – used to report typos that RE does not understand. */
const ANY = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** YYYYMMDDHHmmss in local time (only [0-9], so it is valid inside emails, slugs, ...). */
export function makeRunId(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Lowercase, keep [a-z0-9] only. Throws when nothing is left. */
export function sanitizeRunId(v: string): string {
  const s = String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) throw new Error(`run id "${v}" has no [a-z0-9] characters`);
  return s;
}

/** today + n days (local time, at noon so DST never shifts the day); Sat/Sun -> next Monday. */
export function startDate(today: Date, n: number): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, 12);
  const wd = d.getDay();
  if (wd === 6) d.setDate(d.getDate() + 2);
  else if (wd === 0) d.setDate(d.getDate() + 1);
  return d;
}

export function offsetDate(today: Date, n: number, m = 0): Date {
  const d = startDate(today, n);
  d.setDate(d.getDate() + m);
  return d;
}

/** Tokens: YYYY, MM (zero-padded month), M, DD (zero-padded day), D. Everything else is literal. */
export function formatDate(d: Date, fmt: string): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return fmt.replace(/YYYY|MM|DD|M|D/g, t =>
    t === 'YYYY' ? String(d.getFullYear()) : t === 'MM' ? p(d.getMonth() + 1) : t === 'M' ? String(d.getMonth() + 1)
      : t === 'DD' ? p(d.getDate()) : String(d.getDate()));
}

export interface SubstituteContext {
  runId: string;
  env?: NodeJS.ProcessEnv;
  /** "today" for DAY/DATE placeholders (default: now). */
  today?: Date;
}

/** Every DAY/DATE placeholder resolved in a recipe (for the log and the month warning). */
export interface ResolvedDate { token: string; value: string; date: string; otherMonth: boolean }

/** Names of all {{ENV:NAME}} placeholders used anywhere in the recipe's replayed fields. */
export function envPlaceholders(recipe: Recipe): string[] {
  const names = new Set<string>();
  for (const s of fieldStrings(recipe)) for (const m of s.matchAll(RE)) if (m[2]) names.add(m[2]);
  return [...names].sort();
}

/** {{...}} tokens in replayed fields that are not a known placeholder (typos would otherwise be typed literally). */
export function unknownPlaceholders(recipe: Recipe): string[] {
  const bad = new Set<string>();
  for (const s of fieldStrings(recipe)) {
    for (const m of s.matchAll(ANY)) {
      const whole = m[0];
      if (!new RegExp(RE.source).test(whole)) bad.add(whole);
    }
  }
  return [...bad].sort();
}

function resolveOne(ctx: Required<SubstituteContext>, missing: Set<string>, dates: Map<string, ResolvedDate>,
  all: string, envName?: string, dN?: string, dM?: string, fN?: string, fM?: string, fmt?: string): string {
  if (all.replace(/\s/g, '') === '{{RUN_ID}}') return ctx.runId;
  if (envName) {
    const v = ctx.env[envName];
    if (v === undefined) { missing.add(envName); return ''; }
    return v;
  }
  const isDay = dN !== undefined;
  const n = Number(isDay ? dN : fN);
  const m = Number((isDay ? dM : fM) ?? 0);
  const d = offsetDate(ctx.today, n, m);
  const value = isDay ? String(d.getDate()) : formatDate(d, fmt!.trim());
  const token = all.replace(/\s/g, '');
  dates.set(token, {
    token, value, date: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${formatDate(d, 'YYYY-MM-DD')}`,
    otherMonth: d.getMonth() !== ctx.today.getMonth() || d.getFullYear() !== ctx.today.getFullYear()
  });
  return value;
}

/**
 * Returns a deep copy of the recipe with placeholders replaced.
 * Throws (listing variable NAMES only) when an {{ENV:X}} variable is not set or a {{...}} token is unknown.
 */
export function substituteRecipe(recipe: Recipe, runIdOrCtx: string | SubstituteContext, env: NodeJS.ProcessEnv = process.env):
  { recipe: Recipe; replaced: number; dates: ResolvedDate[] } {
  const c = typeof runIdOrCtx === 'string' ? { runId: runIdOrCtx } : runIdOrCtx;
  const ctx: Required<SubstituteContext> = { runId: c.runId, env: c.env ?? env, today: c.today ?? new Date() };
  const unknown = unknownPlaceholders(recipe);
  if (unknown.length) throw new Error(`recipe uses unknown placeholders: ${unknown.join(', ')} (known: {{RUN_ID}}, {{ENV:NAME}}, {{DAY:+Nd}}, {{DAY:+Nd+M}}, {{DATE:+Nd[+M]:MM/DD/YYYY}})`);
  const r: Recipe = JSON.parse(JSON.stringify(recipe));
  const missing = new Set<string>();
  const dates = new Map<string, ResolvedDate>();
  let replaced = 0;
  const sub = (s: string | undefined): string | undefined => {
    if (typeof s !== 'string') return s;
    const n = [...s.matchAll(RE)].length;
    if (!n) return s;
    replaced += n;
    return s.replace(RE, (all, _tok, envName, dN, dM, fN, fM, fmt) => resolveOne(ctx, missing, dates, all, envName, dN, dM, fN, fM, fmt));
  };
  r.start.url = sub(r.start.url)!;
  for (const st of r.steps) {
    for (const a of st.actions) {
      a.value = sub(a.value);
      a.selector = sub(a.selector);
    }
    if (st.expect) {
      st.expect.visible = sub(st.expect.visible);
      st.expect.url_contains = sub(st.expect.url_contains);
    }
  }
  if (missing.size) throw new Error(`recipe uses {{ENV:...}} placeholders for unset variables: ${[...missing].sort().join(', ')}`);
  return { recipe: r, replaced, dates: [...dates.values()] };
}

function fieldStrings(r: Recipe): string[] {
  const out: string[] = [r.start?.url ?? ''];
  for (const st of r.steps ?? []) {
    for (const a of st.actions ?? []) out.push(a.value ?? '', a.selector ?? '');
    out.push(st.expect?.visible ?? '', st.expect?.url_contains ?? '');
  }
  return out;
}
