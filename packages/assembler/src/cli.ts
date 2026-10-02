import { loadEnv, parseArgs } from "./util.js";
import { tts } from "./tts.js";
import { mux } from "./mux.js";
import { writeManifest } from "./external.js";
import { ffmpegCaps, ffprobeBin, readJson, resolvePath } from "./util.js";
import { renderCardPngs, cssColor, loadPlaywright, CARD_RENDERERS, type CardRendererName } from "./cards.js";
import { loadBrandFonts, brandFontDir } from "./brand.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

loadEnv();
const { cmd, flags } = parseArgs(process.argv.slice(2));
const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);

async function main() {
  if (cmd === "tts") {
    if (!str("recipe") || !str("out")) throw new Error("usage: tts --recipe <path> --out out/<id> [--provider elevenlabs|external|say|espeak|mock]");
    const p = str("provider");
    if (p && !["elevenlabs", "external", "say", "espeak", "mock"].includes(p)) throw new Error("--provider must be elevenlabs|external|say|espeak|mock");
    await tts({ recipe: str("recipe")!, out: str("out")!, provider: p as any });
  } else if (cmd === "manifest") {
    if (!str("recipe") || !str("out")) throw new Error("usage: manifest --recipe <path> --out out/<id>");
    const { manifest, file } = writeManifest(readJson(resolvePath(str("recipe")!)), resolvePath(str("out")!));
    console.log(`[manifest] ${file}`);
    console.log(`[manifest] ${manifest.steps.length} narrated step(s), ${manifest.total_chars} chars, ${manifest.silent_steps.length} silent; ${manifest.missing.length} without usable audio`);
    const cut = (x: string) => (x.length > 80 ? x.slice(0, 77) + "..." : x);
    for (const s of manifest.steps) {
      console.log(`  ${s.status === "present" ? "ok     " : s.status.padEnd(7)} ${s.file.padEnd(9)} ${cut(s.tts_text)}`);
      if (s.subtitle !== s.tts_text) console.log(`  ${"".padEnd(7)} ${"".padEnd(9)} subtitle: ${cut(s.subtitle)}`);
    }
  } else if (cmd === "cards-check") {
    // pre-flight: does ffmpeg have drawtext / subtitles, and if not, which PNG card renderer works here (renders one tiny test card)
    const caps = await ffmpegCaps();
    const style = str("card-style") ?? process.env.SVP_CARD_STYLE ?? "brand";
    const brandFonts = loadBrandFonts();
    const res: any = { ffmpeg: caps.bin, ffprobe: ffprobeBin(), drawtext: caps.drawtext, subtitles: caps.subtitles, forcedNoDrawtext: caps.forcedNoDrawtext, style,
      brandFontsMissing: style === "brand" ? brandFonts.missing : [], brandFontDir: brandFontDir(), cards: caps.drawtext && style !== "brand" ? "drawtext" : null, tried: [] as string[] };
    const want = str("card-renderer");
    if (style === "brand" || !caps.drawtext || (want && want !== "auto" && want !== "drawtext")) {
      const pw = await loadPlaywright();
      res.playwright = pw?.from ?? null;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svp-cards-check-"));
      try {
        const spec = style === "brand"
          ? { key: "check", title: "", sub: null, brand: { kind: "part" as const, index: 2, count: 4, label: "Část 2 z 4", title: "Žluťoučký kůň" } }
          : { key: "check", title: "Nastavení · Ukázka využití · Závěr", sub: "Žluťoučký kůň" };
        const r = await renderCardPngs([spec], {
          width: 640, height: 360, bg: cssColor("0x1f2a44"), fg: "#ffffff", boldFont: null, regularFont: null, dir, fonts: brandFonts.fonts,
          cdp: flags.cdp === true ? "auto" : str("cdp") ?? process.env.SVP_CARD_CDP, renderers: want && CARD_RENDERERS.includes(want as any) ? [want as CardRendererName] : undefined,
        });
        res.cards = r.renderer ? `png:${r.renderer}` : style === "brand" && caps.drawtext ? "drawtext" : "none";
        res.tried = r.tried;
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
    if (flags.json) console.log(JSON.stringify(res));
    else console.log(`ffmpeg ${res.ffmpeg}: drawtext=${res.drawtext} subtitles=${res.subtitles} -> style=${style} cards=${res.cards}${res.brandFontsMissing.length ? ` (brand fonts missing in ${res.brandFontDir}: ${res.brandFontsMissing.join(", ")} - run node scripts/brand-fetch.mjs)` : ""}${res.tried.length ? `\n  tried: ${res.tried.join("\n         ")}` : ""}`);
  } else if (cmd === "mux") {
    if (!str("out")) throw new Error("usage: mux --out out/<id> [--subtitles burn|sidecar|none] [--bgm <file> --bgm-volume 0.08] [--intro on|off] [--outro on|off] [--intro-image <png> [--intro-sec 3]] [--outro-image <png> [--outro-sec 3]] [--no-interstitials] [--no-chapters] [--cdp auto|<url>] [--card-renderer auto|drawtext|cdp|chromium|chrome|msedge|none] [--card-style brand|classic] [--no-thumbnail] [--lufs -16|0]");
    const s = str("subtitles") ?? "sidecar";
    if (!["burn", "sidecar", "none"].includes(s)) throw new Error("--subtitles must be burn|sidecar|none");
    // --intro / --outro: bare flag or "on" = force on, "off" / --no-intro = force off, absent = default (on when recipe has a title)
    const tri = (k: string): boolean | undefined => {
      if (flags[`no-${k}`]) return false;
      const v = flags[k];
      if (v === undefined) return undefined;
      if (v === true || /^(on|true|1|yes)$/i.test(String(v))) return true;
      if (/^(off|false|0|no)$/i.test(String(v))) return false;
      throw new Error(`--${k} must be on|off`);
    };
    const num = (k: string) => { const v = str(k); if (v === undefined) return undefined; const n = Number(v); if (!(n > 0)) throw new Error(`--${k} must be a positive number of seconds`); return n; };
    const r = await mux({
      out: str("out")!, subtitles: s as any, bgm: str("bgm"), bgmVolume: str("bgm-volume") ? Number(str("bgm-volume")) : undefined,
      intro: tri("intro"), outro: tri("outro"), interstitials: tri("interstitials"), chapters: tri("chapters"),
      introImage: str("intro-image"), outroImage: str("outro-image"), introImageSec: num("intro-sec"), outroImageSec: num("outro-sec"),
      cdp: flags.cdp === true ? "auto" : str("cdp"), cardRenderer: str("card-renderer") as any,
      cardStyle: str("card-style") as any, thumbnail: tri("thumbnail"), loudnessLufs: str("lufs") !== undefined ? Number(str("lufs")) : undefined,
    });
    if (r.warnings.length) { console.log("\nWARNINGS:"); r.warnings.forEach((w) => console.log(" - " + w)); }
  } else {
    console.error("usage: start -- <tts|manifest|mux|cards-check> ...");
    process.exit(2);
  }
}
main().catch((e) => { console.error("[assembler] ERROR:", e.message ?? e); process.exit(1); });
