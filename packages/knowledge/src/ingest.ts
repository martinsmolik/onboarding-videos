import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Segment, ensureDir, log, run, srcDir, writeJson, writeTranscript } from "./util.js";

export type IngestOptions = { youtube: string; out: string; skipAudio?: boolean };
export type IngestResult = {
  meta: Record<string, unknown>;
  audioPath?: string;
  transcriptFrom?: "youtube-subtitles";
  warnings: string[];
};

/** Parse a WebVTT file (incl. YouTube auto-caption rolling format) into deduped segments. */
export function parseVtt(vtt: string): Segment[] {
  const toMs = (t: string) => {
    const m = t.trim().match(/^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$/);
    if (!m) return 0;
    return ((+(m[1] ?? 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4].padEnd(3, "0").slice(0, 3);
  };
  const cues: Segment[] = [];
  for (const block of vtt.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split("-->");
    const text = lines
      .slice(ti + 1)
      .map((l) =>
        l
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&gt;/g, ">")
          .replace(/&lt;/g, "<")
          .trim(),
      )
      .filter(Boolean);
    if (!text.length) continue;
    cues.push({ start_ms: toMs(a), end_ms: toMs(b.split(/\s/).filter(Boolean)[0] ?? b), text: text.join("\n") });
  }
  // Auto-captions repeat the previous line in each following cue; keep only new lines.
  const out: Segment[] = [];
  let prevLines: string[] = [];
  for (const c of cues) {
    const lines = c.text.split("\n");
    const fresh = lines.filter((l) => !prevLines.includes(l));
    prevLines = lines;
    if (!fresh.length) continue;
    out.push({ start_ms: c.start_ms, end_ms: c.end_ms, text: fresh.join(" ") });
  }
  // fix ends: a segment ends where the next begins (capped)
  for (let i = 0; i < out.length - 1; i++) out[i].end_ms = Math.max(out[i].end_ms, Math.min(out[i + 1].start_ms, out[i].start_ms + 15000));
  return out;
}

export async function ingest(opts: IngestOptions): Promise<IngestResult> {
  const dir = srcDir(opts.out);
  ensureDir(dir);
  const warnings: string[] = [];

  const which = await run("yt-dlp", ["--version"]);
  if (which.code !== 0) {
    throw new Error("yt-dlp not found. Install: pip install yt-dlp --break-system-packages");
  }

  // 1) metadata + subtitles (no media download)
  const common = ["--no-playlist", "--no-warnings"];
  const metaRun = await run("yt-dlp", [...common, "--dump-single-json", "--skip-download", opts.youtube], { timeoutMs: 120000 });
  if (metaRun.code !== 0) {
    throw new Error(`yt-dlp metadata failed: ${metaRun.stderr.trim().split("\n").slice(-2).join(" | ")}`);
  }
  const info = JSON.parse(metaRun.stdout);
  const meta = {
    id: info.id,
    url: opts.youtube,
    title: info.title,
    upload_date: info.upload_date, // YYYYMMDD
    description: info.description,
    duration_s: info.duration,
    uploader: info.uploader ?? info.channel,
  };
  writeJson(join(dir, "meta.json"), meta);

  let transcriptFrom: IngestResult["transcriptFrom"];
  const subRun = await run(
    "yt-dlp",
    [...common, "--skip-download", "--write-sub", "--write-auto-sub", "--sub-lang", "cs,en", "--sub-format", "vtt", "--convert-subs", "vtt", "-o", join(dir, "subs.%(ext)s"), opts.youtube],
    { timeoutMs: 120000 },
  );
  const vttFiles = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("subs.") && f.endsWith(".vtt")) : [];
  if (subRun.code !== 0 && !vttFiles.length) warnings.push(`subtitle fetch failed: ${subRun.stderr.trim().split("\n").pop()}`);
  if (vttFiles.length) {
    // prefer cs over en; creator subs are the same file name as auto (yt-dlp prefers creator)
    const pick = vttFiles.find((f) => f.includes(".cs")) ?? vttFiles[0];
    const segs = parseVtt(readFileSync(join(dir, pick), "utf8"));
    if (segs.length) {
      writeTranscript(opts.out, segs);
      transcriptFrom = "youtube-subtitles";
      log(`subtitles found (${pick}) -> transcript written, STT can be skipped`);
    }
  } else warnings.push("no subtitles available - run `transcribe`");

  // 2) audio (always saved, per spec; failure is non-fatal when a transcript already exists)
  let audioPath: string | undefined;
  if (!opts.skipAudio) {
    audioPath = join(dir, "audio.m4a");
    const a = await run("yt-dlp", [...common, "-f", "bestaudio[ext=m4a]/bestaudio", "-x", "--audio-format", "m4a", "-o", join(dir, "audio.%(ext)s"), opts.youtube], { timeoutMs: 600000 });
    if (a.code !== 0) {
      const msg = `audio download failed: ${a.stderr.trim().split("\n").pop()}`;
      if (!transcriptFrom) throw new Error(msg);
      warnings.push(msg + " (non-fatal, transcript exists)");
      audioPath = undefined;
    }
  }
  warnings.forEach((w) => log("WARN", w));
  return { meta, audioPath, transcriptFrom, warnings };
}
