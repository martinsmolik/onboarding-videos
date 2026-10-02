// Brand cards (intro / outro / interstitial) as PNG stills, for ffmpeg builds WITHOUT the `drawtext` filter
// (Homebrew's core `ffmpeg` formula has no libfreetype since 8.x). With drawtext, mux.ts draws the cards itself.
//
// Rendering = a <canvas> in a Chromium page (Playwright): text drawn with fillText, exported with toDataURL.
// Canvas output does not depend on the page being visible or on the device pixel ratio, so a background tab
// in the user's running browser works. Renderers, in order (`auto`):
//   cdp      – a temporary tab in an already running browser (BrowserOS neo over CDP; --cdp <url|auto>), closed afterwards
//   chromium – Playwright's own Chromium (needs `playwright install chromium`)
//   chrome   – installed Google Chrome (Playwright channel "chrome", no download)
//   msedge   – installed Microsoft Edge (channel "msedge")
// Playwright is not a dependency of this package: it is resolved from here, else from the sibling recorder package
// (which depends on playwright 1.56), else from the repo root. No code is shared between packages.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cardHtml, type BrandCard, type BrandFonts } from "./brand.js";

export type CardRendererName = "cdp" | "chromium" | "chrome" | "msedge";
export const CARD_RENDERERS: CardRendererName[] = ["cdp", "chromium", "chrome", "msedge"];

export interface CardSpec {
  /** file stem, e.g. "intro", "part-1" */
  key: string;
  /** title, may contain "\n" (max 3 lines) */
  title: string;
  /** smaller line under an accent bar (null = title only, vertically centred) */
  sub: string | null;
  /** brand card (brand.ts HTML template) – when set, title/sub are ignored and the card is a Chromium screenshot */
  brand?: BrandCard;
  /** output size for this card (default RenderOptions width/height), e.g. 1280x720 for the thumbnail */
  width?: number;
  height?: number;
}

export interface RenderOptions {
  width: number;
  height: number;
  /** CSS colours */
  bg: string;
  fg: string;
  /** ttf/otf files embedded via FontFace (null = system font stack: Inter, Helvetica Neue, Arial, DejaVu Sans) */
  boldFont: string | null;
  regularFont: string | null;
  /** brand fonts (brand.ts loadBrandFonts) for brand cards; missing faces fall back to system fonts */
  fonts?: BrandFonts;
  /** directory the PNGs are written to */
  dir: string;
  /** CDP endpoint (http://127.0.0.1:9110, ws://…, a port) or "auto"; undefined = skip the cdp renderer */
  cdp?: string;
  /** restrict / reorder renderers (default CARD_RENDERERS) */
  renderers?: CardRendererName[];
  log?: (m: string) => void;
}

export interface RenderResult {
  renderer: CardRendererName | null;
  /** key -> png path (empty when renderer is null) */
  files: Record<string, string>;
  /** "<renderer>: <why it did not work>" for every renderer that was tried and failed */
  tried: string[];
}

/** ffmpeg colour ("0x1f2a44", "0x1f2a44cc", "white") -> CSS ("#1f2a44", "#1f2a44cc", "white"). */
export function cssColor(ff: string): string {
  return /^0x[0-9a-f]{6}([0-9a-f]{2})?$/i.test(ff) ? "#" + ff.slice(2) : ff;
}

// ---------------------------------------------------------------- playwright resolution
let pwCache: { chromium: any; from: string } | null | undefined;
/** playwright-core / playwright, resolved from this package, the sibling recorder package, then the repo root. */
export async function loadPlaywright(): Promise<{ chromium: any; from: string } | null> {
  if (pwCache !== undefined) return pwCache;
  const here = path.dirname(fileURLToPath(import.meta.url)); // packages/assembler/src
  const bases = [path.join(here, "..", "package.json"), path.join(here, "..", "..", "recorder", "package.json"), path.join(here, "..", "..", "..", "package.json")];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const req = createRequire(base);
    for (const name of ["playwright-core", "playwright"]) {
      try {
        const p = req.resolve(name);
        const mod: any = await import(pathToFileURL(p).href);
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (chromium) return (pwCache = { chromium, from: `${name} (${path.relative(path.join(here, "..", "..", ".."), p)})` });
      } catch { /* next */ }
    }
  }
  return (pwCache = null);
}

// ---------------------------------------------------------------- CDP endpoint (small on purpose; the recorder has the full discovery)
async function probe(httpBase: string): Promise<boolean> {
  try {
    const r = await fetch(httpBase.replace(/\/$/, "") + "/json/version", { signal: AbortSignal.timeout(1200) });
    if (!r.ok) return false;
    const j: any = await r.json();
    return typeof j?.webSocketDebuggerUrl === "string" && !(typeof j.Browser === "string" && /^node/i.test(j.Browser));
  } catch { return false; }
}
/**
 * Explicit endpoint (http/ws URL or bare port) is used as given. "auto": env CDP_URL, then
 * 127.0.0.1:9110 (BrowserOS neo), 9100 (BrowserOS), 9222 (Chrome --remote-debugging-port).
 */
export async function resolveCdp(spec: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (spec && spec !== "auto") return /^\d+$/.test(spec) ? `http://127.0.0.1:${spec}` : spec;
  if (env.CDP_URL) return env.CDP_URL;
  for (const port of [9110, 9100, 9222]) if (await probe(`http://127.0.0.1:${port}`)) return `http://127.0.0.1:${port}`;
  return null;
}

// ---------------------------------------------------------------- the canvas drawing (runs in the page)
interface PageArgs { cards: CardSpec[]; W: number; H: number; bg: string; fg: string; bold: string | null; regular: string | null }
/**
 * Mirrors mux.ts cardFilter (drawtext): title (bold) centred, 6.6 % of height (5.8 % when wrapped), line spacing 25 %;
 * with a subtitle the title block moves up 4.5 % of height, accent bar 4 % wide at 55 % opacity, subtitle 2.8 % at 85 %.
 * Plain JS in a string on purpose: tsx/esbuild may inject helpers (__name) into TS functions, which would break
 * Playwright's function serialisation.
 */
export const PAGE_DRAW_JS = `async (a) => {
  const fam = {};
  for (const [k, url] of [["b", a.bold], ["r", a.regular]]) {
    if (!url) continue;
    try { const ff = new FontFace("SvpCard" + k, "url(" + url + ")"); await ff.load(); document.fonts.add(ff); fam[k] = '"SvpCard' + k + '", '; } catch (e) { /* system stack */ }
  }
  const stack = 'Inter, "Helvetica Neue", Helvetica, Arial, "DejaVu Sans", sans-serif';
  const fontB = (px) => "bold " + px + "px " + (fam.b || "") + stack;
  const fontR = (px) => px + "px " + (fam.r || "") + stack;
  const W = a.W, H = a.H;
  return a.cards.map((c) => {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.fillStyle = a.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = a.fg; g.textAlign = "center"; g.textBaseline = "alphabetic";
    const lines = c.title.split("\\n");
    const titleSize = Math.round(H * (lines.length > 1 ? 0.058 : 0.066));
    g.font = fontB(titleSize);
    const m = lines.map((l) => g.measureText(l));
    const fa = m[0].fontBoundingBoxAscent || titleSize * 0.93, fd = m[0].fontBoundingBoxDescent || titleSize * 0.24;
    const lineH = fa + fd + Math.round(titleSize * 0.25);
    const asc = Math.max(...m.map((x) => x.actualBoundingBoxAscent));
    const desc = m[m.length - 1].actualBoundingBoxDescent;
    const textH = asc + (lines.length - 1) * lineH + desc;
    const top = (H - textH) / 2 - (c.sub ? Math.round(H * 0.045) : 0);
    lines.forEach((l, i) => g.fillText(l, W / 2, top + asc + i * lineH));
    if (c.sub) {
      const barY = Math.round(H * 0.5 + H * 0.045 + titleSize * 0.35);
      const bw = Math.round(W * 0.04), bh = Math.max(3, Math.round(H * 0.004));
      g.globalAlpha = 0.55; g.fillRect(Math.round((W - bw) / 2), barY, bw, bh);
      g.globalAlpha = 0.85; g.font = fontR(Math.round(H * 0.028));
      const sm = g.measureText(c.sub);
      g.fillText(c.sub, W / 2, barY + Math.round(H * 0.03) + sm.actualBoundingBoxAscent);
      g.globalAlpha = 1;
    }
    return cv.toDataURL("image/png");
  });
}`;

const fontDataUrl = (f: string | null): string | null => {
  if (!f || !fs.existsSync(f)) return null;
  const mime = f.toLowerCase().endsWith(".otf") ? "font/otf" : "font/ttf";
  return `data:${mime};base64,${fs.readFileSync(f).toString("base64")}`;
};

async function drawWith(page: any, specs: CardSpec[], o: RenderOptions): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const write = (key: string, buf: Buffer) => {
    const f = path.join(o.dir, `.card-${key}.png`);
    fs.writeFileSync(f, buf);
    files[key] = f;
  };
  // brand cards: the HTML template, screenshotted at the card's own size
  for (const s of specs.filter((x) => x.brand)) {
    const w = s.width ?? o.width, h = s.height ?? o.height;
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(cardHtml(s.brand!, w, h, o.fonts ?? {}), { waitUntil: "load" });
    await page.evaluate("document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => r(1))))");
    const buf: Buffer = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h }, scale: "css", animations: "disabled" });
    if (!buf?.length) throw new Error(`card ${s.key}: empty screenshot`);
    write(s.key, buf);
  }
  // classic cards: canvas (title + sub)
  const classic = specs.filter((x) => !x.brand);
  if (classic.length) {
    const args: PageArgs = { cards: classic, W: o.width, H: o.height, bg: o.bg, fg: o.fg, bold: fontDataUrl(o.boldFont), regular: fontDataUrl(o.regularFont) };
    const urls: string[] = await page.evaluate(`(${PAGE_DRAW_JS})(${JSON.stringify(args)})`);
    classic.forEach((s, i) => {
      const b64 = urls[i]?.replace(/^data:image\/png;base64,/, "");
      if (!b64) throw new Error(`card ${s.key}: empty canvas output`);
      write(s.key, Buffer.from(b64, "base64"));
    });
  }
  return files;
}

const short = (e: any) => String(e?.message ?? e).replace(/[\u2500-\u257f]+/g, " ").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" ").replace(/\s+/g, " ").slice(0, 220);

/** Render all cards with the first renderer that works. Never throws; renderer=null when none worked. */
export async function renderCardPngs(specs: CardSpec[], o: RenderOptions): Promise<RenderResult> {
  const tried: string[] = [];
  const log = o.log ?? (() => {});
  const pw = await loadPlaywright();
  if (!pw) return { renderer: null, files: {}, tried: ["playwright: not resolvable (playwright-core / playwright) – run `pnpm i` in the repo root"] };
  for (const r of o.renderers ?? CARD_RENDERERS) {
    let browser: any = null, page: any = null;
    try {
      if (r === "cdp") {
        if (o.cdp === undefined) continue; // not requested
        const ep = await resolveCdp(o.cdp);
        if (!ep) { tried.push(`cdp: no endpoint answered (${o.cdp}: CDP_URL, 127.0.0.1:9110/9100/9222)`); continue; }
        browser = await pw.chromium.connectOverCDP(ep, { timeout: 10_000 });
        const ctx = browser.contexts()[0];
        if (!ctx) throw new Error("browser has no default context");
        page = await ctx.newPage(); // temporary tab – closed below, existing tabs are never touched
        log(`[cards] rendering ${specs.length} card(s) in a temporary tab of ${ep}`);
      } else {
        browser = await pw.chromium.launch({ headless: true, timeout: 20_000, ...(r === "chromium" ? {} : { channel: r }) });
        page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
        log(`[cards] rendering ${specs.length} card(s) with ${r === "chromium" ? "Playwright Chromium" : `channel ${r}`} (headless)`);
      }
      const files = await drawWith(page, specs, o);
      return { renderer: r, files, tried };
    } catch (e) {
      tried.push(`${r}: ${short(e)}`);
    } finally {
      if (r === "cdp") await page?.close().catch(() => {});
      await browser?.close().catch(() => {}); // connectOverCDP: disconnect only – the user's browser keeps running
    }
  }
  return { renderer: null, files: {}, tried };
}
