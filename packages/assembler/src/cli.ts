import { loadEnv, parseArgs } from "./util.js";
import { tts } from "./tts.js";
import { mux } from "./mux.js";

loadEnv();
const { cmd, flags } = parseArgs(process.argv.slice(2));
const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);

async function main() {
  if (cmd === "tts") {
    if (!str("recipe") || !str("out")) throw new Error("usage: tts --recipe <path> --out out/<id> [--provider elevenlabs|espeak|mock]");
    const p = str("provider");
    if (p && p !== "elevenlabs" && p !== "espeak" && p !== "mock") throw new Error("--provider must be elevenlabs|espeak|mock");
    await tts({ recipe: str("recipe")!, out: str("out")!, provider: p as any });
  } else if (cmd === "mux") {
    if (!str("out")) throw new Error("usage: mux --out out/<id> [--subtitles burn|sidecar|none] [--bgm <file> --bgm-volume 0.08] [--intro on|off] [--outro on|off]");
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
    const r = await mux({ out: str("out")!, subtitles: s as any, bgm: str("bgm"), bgmVolume: str("bgm-volume") ? Number(str("bgm-volume")) : undefined, intro: tri("intro"), outro: tri("outro") });
    if (r.warnings.length) { console.log("\nWARNINGS:"); r.warnings.forEach((w) => console.log(" - " + w)); }
  } else {
    console.error("usage: start -- <tts|mux> ...");
    process.exit(2);
  }
}
main().catch((e) => { console.error("[assembler] ERROR:", e.message ?? e); process.exit(1); });
