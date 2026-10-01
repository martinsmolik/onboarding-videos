// Recipe text roles + video parts (brief "Kostra videonávodů": 5 parts, interstitial cards, YouTube chapters).
// Duplicated from the recorder on purpose (packages share no code).

export interface StepTexts { narration?: string; narration_tts?: string; subtitle?: string; part?: number; part_title?: string }

/** Text sent to TTS / the external voiceover: narration_tts, default narration. Also the audio cache key. */
export function ttsText(s: StepTexts): string {
  return (s.narration_tts ?? s.narration ?? "").trim();
}

/** Text for final.srt: subtitle, default narration. "" = no subtitle for the step. */
export function subtitleText(s: StepTexts): string {
  return (s.subtitle ?? s.narration ?? "").trim();
}

/** Effective part per step: step.part, else inherited; part_title from the step that opened (or last renamed) the part. */
export function effectiveParts(steps: StepTexts[]): { part?: number; part_title?: string }[] {
  let part: number | undefined, title: string | undefined;
  return steps.map((s) => {
    if (s.part !== undefined && s.part !== part) { part = s.part; title = undefined; }
    if (s.part_title !== undefined && part !== undefined) title = s.part_title;
    return part === undefined ? {} : { part, ...(title ? { part_title: title } : {}) };
  });
}

export function partLabel(part: number | undefined, title: string | undefined, lang?: string): string {
  if (title) return title;
  if (part === undefined) return lang === "en" ? "Introduction" : "Úvod";
  return `${lang === "en" ? "Part" : lang === "sk" ? "Časť" : "Část"} ${part}`;
}

export interface PartStart {
  /** index into the timing steps */
  index: number;
  stepId: string;
  part?: number;
  title: string;
  /** recording time (ms) where the part starts = t_start_ms of its first step, snapped to the output frame grid */
  rawMs: number;
  /** frame number (output fps) of rawMs */
  frame: number;
}

/**
 * Where the part changes: every step (after the first) whose effective part differs from the previous step's.
 * Skipped steps are ignored. Cut points are snapped to the output frame grid so splitting the video is exact.
 */
export function partStarts(steps: { id: string; t_start_ms: number; status?: string; part?: number; part_title?: string }[], fps: number, totalMs: number, lang?: string): PartStart[] {
  const res: PartStart[] = [];
  let prev: number | undefined | null = null; // null = no step seen yet
  steps.forEach((s, index) => {
    if (s.status === "skipped") return;
    if (prev !== null && s.part !== undefined && s.part !== prev) {
      const frame = Math.round((s.t_start_ms * fps) / 1000);
      const rawMs = Math.round((frame * 1000) / fps);
      const last = res[res.length - 1];
      if (frame > 0 && rawMs < totalMs && (!last || frame > last.frame))
        res.push({ index, stepId: s.id, part: s.part, title: partLabel(s.part, s.part_title, lang), rawMs, frame });
    }
    prev = s.part;
  });
  return res;
}

/** YouTube chapter timestamp: M:SS below one hour, H:MM:SS above (floored to whole seconds). */
export function ytTime(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export interface Chapter { ms: number; title: string }

/** "0:00 Úvod\n0:45 Nastavení\n…" – first chapter forced to 0:00. */
export function chaptersText(ch: Chapter[]): string {
  return ch.map((c, i) => `${i === 0 ? "0:00" : ytTime(c.ms)} ${c.title}`).join("\n") + "\n";
}

/** YouTube only shows chapters when: first at 0:00, >= 3 chapters, each >= 10 s. Returns the violated rules. */
export function chapterProblems(ch: Chapter[], totalMs: number): string[] {
  const p: string[] = [];
  if (ch.length < 3) p.push(`only ${ch.length} chapter(s) – YouTube needs at least 3`);
  for (let i = 0; i < ch.length; i++) {
    const end = i + 1 < ch.length ? ch[i + 1].ms : totalMs;
    const start = i === 0 ? 0 : ch[i].ms;
    if (end - start < 10_000) p.push(`chapter "${ch[i].title}" is ${((end - start) / 1000).toFixed(1)} s – YouTube needs >= 10 s`);
  }
  return p;
}
