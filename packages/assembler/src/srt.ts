import type { Alignment } from "./tts.js";

export interface Cue { startMs: number; endMs: number; text: string }

const MAX = 42;

/** Split narration into pieces <= MAX chars on sentence / comma boundaries, then words. Returns [start,end) offsets into text. */
export function splitNarration(text: string): [number, number][] {
  // 1) clauses: end after . ! ? , ; : … (keeping trailing whitespace out)
  const clauses: { s: number; e: number; sentenceEnd: boolean }[] = [];
  const re = /[^.!?,;:…]+[.!?,;:…]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let s = m.index, e = m.index + m[0].length;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) clauses.push({ s, e, sentenceEnd: /[.!?…]$/.test(text.slice(s, e)) });
  }
  // 2) greedy merge of clauses within a sentence while <= MAX
  const merged: { s: number; e: number }[] = [];
  let cur: { s: number; e: number; sentenceEnd: boolean } | null = null;
  for (const c of clauses) {
    if (cur && !cur.sentenceEnd && c.e - cur.s <= MAX) cur = { s: cur.s, e: c.e, sentenceEnd: c.sentenceEnd };
    else { if (cur) merged.push(cur); cur = { ...c }; }
  }
  if (cur) merged.push(cur);
  // 3) word-wrap anything still too long
  const out: [number, number][] = [];
  for (const p of merged) {
    if (p.e - p.s <= MAX) { out.push([p.s, p.e]); continue; }
    const words = [...text.slice(p.s, p.e).matchAll(/\S+/g)].map((w) => [p.s + w.index!, p.s + w.index! + w[0].length] as const);
    const wrap = (limit: number) => {
      const res: [number, number][] = [];
      let ls = words[0][0], le = words[0][1];
      for (const [ws, we] of words.slice(1)) {
        if (we - ls <= limit) le = we;
        else { res.push([ls, le]); ls = ws; le = we; }
      }
      res.push([ls, le]);
      return res;
    };
    // balanced wrap: smallest limit that still yields the minimal number of lines
    const n = wrap(MAX).length;
    let best = wrap(MAX);
    for (let L = Math.ceil((p.e - p.s) / n); L <= MAX; L++) {
      const r = wrap(L);
      if (r.length === n) { best = r; break; }
    }
    out.push(...best);

  }
  return out;
}

/**
 * Map every code point of `shown` (subtitle) to an index into `spoken` (the text the alignment is for,
 * e.g. narration_tts). Identical runs map 1:1 via an LCS alignment (case-insensitive); differing runs
 * ("KPI" vs "kej pí áj") are interpolated linearly between their matched neighbours.
 * Falls back to a proportional map for very long texts.
 */
export function mapTextIndices(shown: string[], spoken: string[]): number[] {
  const n = shown.length, m = spoken.length;
  if (!n) return [];
  if (!m) return shown.map(() => 0);
  const prop = () => shown.map((_, i) => Math.min(m - 1, Math.round((i / Math.max(1, n - 1)) * (m - 1))));
  if (n * m > 4_000_000) return prop();
  const a = shown.map((c) => c.toLowerCase()), b = spoken.map((c) => c.toLowerCase());
  // LCS lengths of suffixes, row-major (n+1) x (m+1)
  const W = m + 1;
  const L = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i * W + j] = a[i] === b[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const match: number[] = new Array(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { match[i] = j; i++; j++; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++;
    else j++;
  }
  if (!match.some((x) => x >= 0)) return prop();
  // interpolate unmatched runs between the surrounding matched anchors
  const res = match.slice();
  let i = 0;
  while (i < n) {
    if (res[i] >= 0) { i++; continue; }
    let k = i;
    while (k < n && match[k] < 0) k++;
    const lo = i > 0 ? match[i - 1] + 1 : 0;   // first spoken index available to this run
    const hi = k < n ? match[k] - 1 : m - 1;  // last spoken index available
    const len = k - i;
    for (let r = 0; r < len; r++) res[i + r] = hi < lo ? Math.max(0, Math.min(m - 1, lo)) : Math.round(lo + ((hi - lo) * r) / Math.max(1, len - 1));
    i = k;
  }
  return res;
}

export function cuesForStep(tStartMs: number, text: string, al: Alignment): Cue[] {
  const n = al.characters.length;
  const tl = [...text].length;
  // alignment normally matches the input text 1:1 (subtitle == narration_tts); otherwise map via LCS
  const same = n === tl && al.characters.join("") === text;
  const idx = same ? null : mapTextIndices([...text], al.characters);
  const map = (i: number) => (idx ? idx[Math.min(tl - 1, Math.max(0, i))] : i);
  const chars = [...text]; // code-point indexing consistent with alignment characters
  const joined = chars.join("");
  const pieces = splitNarration(joined);
  // splitNarration works on UTF-16 offsets; convert to code-point indices (identical for BMP text)
  const cpIndex = (u16: number) => [...joined.slice(0, u16)].length;
  return pieces.map(([s, e]) => {
    const a = map(cpIndex(s)), b = map(Math.max(cpIndex(s), cpIndex(e) - 1));
    return {
      startMs: Math.round(tStartMs + al.character_start_times_seconds[a] * 1000),
      endMs: Math.round(tStartMs + al.character_end_times_seconds[b] * 1000),
      text: joined.slice(s, e),
    };
  });
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export function srtTime(ms: number): string {
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  // avoid overlap between consecutive cues
  const c = cues.map((x) => ({ ...x }));
  for (let i = 0; i < c.length - 1; i++) if (c[i].endMs > c[i + 1].startMs) c[i].endMs = c[i + 1].startMs;
  return c.map((x, i) => `${i + 1}\n${srtTime(x.startMs)} --> ${srtTime(Math.max(x.endMs, x.startMs + 300))}\n${x.text}\n`).join("\n");
}
