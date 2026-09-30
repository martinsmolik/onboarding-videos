// Selector stability policy – enforced by code, not only by the prompt.

const RULES: [RegExp, string][] = [
  [/nth-child|nth-of-type|nth-last|:nth-match|>>\s*nth=|\bnth=/i, 'positional selectors (nth-child / nth-of-type / nth=) are forbidden'],
  [/^\s*(xpath=|\/\/|\.\.\/)/i, 'xpath is forbidden'],
  [/\.(css|sc|jss|emotion|styled|makeStyles|Mui[A-Za-z]+-root)-?[A-Za-z0-9_-]*/, 'generated/framework class names are forbidden'],
  [/\.[A-Za-z_-]*[0-9][A-Za-z0-9_-]*/, 'class names containing digits look generated – forbidden'],
  [/\.(_|__)[A-Za-z0-9]/, 'CSS-module style class names are forbidden'],
  [/^css=.*>.*>.*>/, 'deep absolute css paths are forbidden'],
];

/** Returns a list of violations (empty = selector is acceptable). */
export function policyViolations(selector: string): string[] {
  const out: string[] = [];
  // ignore everything inside quotes (names / text may legitimately contain dots and digits)
  const bare = selector
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/\[[^\]]*\]/g, '[]'); // attribute values (data-testid=v1.2) are not class names
  for (const [re, msg] of RULES) if (re.test(bare)) out.push(msg);
  return out;
}

/** Tier of a selector per policy (1 best). Used for logging / diffing only. */
export function selectorTier(selector: string): number {
  const s = selector.trim();
  if (/^\[data-(testid|test|cy|qa)=/.test(s)) return 1;
  if (/^role=/.test(s)) return 2;
  if (/^text=/.test(s)) return 3;
  if (/^\[data-(testid|test|cy|qa)=[^\]]+\]\s*>>/.test(s)) return 4;
  return 5;
}
