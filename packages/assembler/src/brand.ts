// Sloneek brand cards as HTML/CSS (intro, part interstitial, outro, YouTube thumbnail).
// Tokens come from sloneek.com (theme CSS, 2026-10): Geometria for headlines, Inter for text, primary #5245FF,
// lavender #EEECFF, ink black. Style brief: Revolut-like minimalism, strictly on brand, the logo's loop as the
// only decoration (it is the motif on every Sloneek marketing visual).
// The HTML is rendered to PNG by cards.ts (Chromium screenshot); every size is in rem, 1rem = 10px at 1080p.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const BRAND = {
  bg: "#F4F2FF",
  lavender: "#EEECFF",
  loop: "#E7E2FF",
  loopStrong: "#DDD6FF",
  primary: "#5245FF",
  primaryDark: "#3A31B5",
  track: "#D9D4FF",
  ink: "#000000",
  muted: "#475467",
  white: "#FFFFFF",
} as const;

export type BrandTokens = { [K in keyof typeof BRAND]: string };

/** Logo (sloneek.com header SVG, viewBox 0 0 130 33). Letters use currentColor, the loop var(--logo-loop). */
export const LOGO_SVG = `<svg viewBox="0 0 130 33" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M123.82 24.0267L115.554 16.5181V24.0267H110.459V1.39467H115.554V14.4802L123.482 6.25403H129.831L120.818 15.5336L130 24.0267H123.82Z" fill="currentColor"/><path d="M0 22.5629L0.232493 18.4354C2.16418 19.7988 4.85936 20.7001 7.35649 20.7001C10.4191 20.7001 11.5184 20.1346 11.5184 18.9693C11.5184 17.6375 10.0201 17.1381 6.29162 16.3717C2.56315 15.6053 0.367396 13.9435 0.367396 11.0789C0.367396 8.31773 3.22905 5.8206 8.32377 5.8206C11.2859 5.8206 13.6165 6.28559 15.5138 6.95149V10.746C14.0155 10.0485 11.5212 9.51464 9.48909 9.51464C6.52698 9.51464 5.32721 10.1145 5.32721 11.1794C5.32721 12.3447 6.79105 12.8757 10.5195 13.6765C14.5149 14.5405 16.4782 15.9412 16.4782 18.9033C16.4782 22.1323 13.4816 24.463 8.38978 24.463C5.65729 24.4601 1.9977 23.5933 0 22.5629Z" fill="currentColor"/><path d="M24.4288 1.39467H19.3685V24.0267H24.4288V1.39467Z" fill="currentColor"/><path d="M42.5 15.1404C42.5 12.0778 40.2698 10.0141 37.4397 10.0141C34.6096 10.0141 32.3479 12.0778 32.3479 15.1404C32.3479 18.2029 34.6096 20.2982 37.4397 20.2982C40.2698 20.3011 42.5 18.2029 42.5 15.1404ZM27.2876 15.1404C27.2876 9.74999 31.4466 5.8206 37.4397 5.8206C43.3984 5.8206 47.5574 9.74712 47.5574 15.1404C47.5574 20.5336 43.3955 24.4601 37.4397 24.4601C31.4495 24.4601 27.2876 20.5336 27.2876 15.1404Z" fill="currentColor"/><path d="M50.3846 6.25402H51.2486L54.4116 9.61509H54.5436C55.9414 7.15241 58.5362 5.8206 61.4007 5.8206C65.7951 5.8206 69.3226 8.88318 69.3226 13.6105V24.0267H64.2652V14.773C64.2652 12.0118 62.368 10.0456 59.8708 10.0456C57.3737 10.0456 55.4765 11.9744 55.4765 14.773V24.0267H50.3846V6.25402Z" fill="currentColor"/><path d="${loopPath()}" fill="var(--logo-loop, #5245FF)"/></svg>`;

function loopPath(): string {
  return "M96.7164 14.8993C95.7348 11.9228 95.198 9.78445 95.5712 7.18686C95.6688 6.50087 96.0304 5.89237 96.5844 5.47618C97.0379 5.13749 97.5775 4.95666 98.1372 4.95666C98.2606 4.95666 98.3869 4.96527 98.5132 4.98249C99.1992 5.08008 99.8077 5.44174 100.224 5.9957C100.64 6.54966 100.815 7.23565 100.718 7.92165C100.56 9.00087 98.6883 12.1122 96.7164 14.8993ZM79.2221 13.5761L79.1762 13.3005C78.9495 11.9171 78.7141 10.4877 78.8777 9.34243C78.9581 8.77411 79.2566 8.27469 79.7158 7.93026C80.0918 7.64897 80.5367 7.50259 80.9988 7.50259C81.1022 7.50259 81.2055 7.50833 81.3088 7.52555C82.4799 7.69202 83.295 8.78273 83.1286 9.94518C82.965 10.835 81.2945 13.843 79.7646 16.1536C79.5551 15.3614 79.3743 14.5032 79.2221 13.5761ZM104.759 20.2982L104.676 20.3413C104.658 20.3528 102.744 21.2626 100.356 20.1375C100.023 19.9796 99.7158 19.7844 99.4374 19.5606C99.4546 19.5405 99.4718 19.5204 99.4891 19.5003L99.5637 19.4084C100.87 17.6805 105.169 11.7936 105.623 8.6306C105.91 6.6329 105.402 4.6438 104.191 3.02785C102.979 1.41189 101.214 0.364241 99.2164 0.0772145C97.2187 -0.206942 95.2296 0.298226 93.6136 1.50948C91.9977 2.72073 90.95 4.48594 90.663 6.48365C90.0574 10.6943 91.1969 14.064 92.2962 17.3218C92.5057 17.9446 92.7468 18.5388 93.0166 19.1042C90.5999 21.2712 88.12 22.5801 86.0304 22.7265C84.6957 22.8241 83.5677 22.4308 82.5746 21.5324C82.4569 21.4262 82.345 21.3143 82.233 21.1966C82.2417 21.1851 82.2503 21.1737 82.2589 21.1622C83.7658 19.2965 87.6521 13.3063 88.031 10.6599C88.5878 6.78215 85.8869 3.17423 82.0092 2.62027C80.132 2.35333 78.2606 2.8298 76.7422 3.96642C75.2239 5.10305 74.2394 6.76493 73.9696 8.64208C73.6969 10.5422 74.0097 12.4366 74.2853 14.1099L74.3283 14.3797C74.7359 16.8769 75.3387 19.0095 76.1452 20.7977C76.1395 20.8063 76.1337 20.812 76.128 20.8206C72.9564 24.7127 70.8151 27.0979 66.9231 27.0979H66.903C66.1108 27.095 65.8926 27.1008 65.6458 27.1036C65.4133 27.1094 65.1521 27.1122 64.2709 27.1122V32.0692C65.2066 32.0692 65.485 32.0634 65.7348 32.0606C65.9213 32.0577 66.0878 32.0548 66.5471 32.0548C66.6561 32.0548 66.7795 32.0548 66.9259 32.0548C72.7554 32.0548 76.1825 28.5301 79.0758 25.0456C79.1332 25.1002 79.1934 25.1547 79.2537 25.2092C81.2428 27.0089 83.7084 27.8556 86.3834 27.6719C89.4575 27.4538 92.8071 25.8378 95.9673 23.1111C96.6676 23.7311 97.4311 24.242 98.2491 24.6237C101.952 26.3688 105.442 25.5307 106.96 24.7443L107.374 24.5433V19.0353L104.759 20.2982Z";
}

/** Just the loop (the logo's "ee"), cropped to its own bounds – the decorative motif. */
export const LOOP_SVG = (fill: string) =>
  `<svg viewBox="64 -0.3 43.4 32.4" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><path d="${loopPath()}" fill="${fill}"/></svg>`;

// ---------------------------------------------------------------- fonts
export interface BrandFonts {
  /** CSS src value per face, e.g. `url(data:font/woff2;base64,…) format("woff2")`; missing = system fallback */
  geometriaBold?: string;
  interRegular?: string;
  interSemiBold?: string;
}
export const FONT_FILES: Record<keyof BrandFonts, string> = {
  geometriaBold: "Geometria-Bold.woff2",
  interRegular: "Inter-Regular.woff2",
  interSemiBold: "Inter-SemiBold.woff2",
};
/** Where `scripts/brand-fetch.mjs` puts the brand fonts (not in git: Geometria is a licensed web font). */
export function brandFontDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.BRAND_FONT_DIR || path.join(env.HOME || os.homedir(), ".onboarding-videos", "brand", "fonts");
}
/** Fonts found in brandFontDir(), embedded as data URLs (Chromium then needs no file/network access). */
export function loadBrandFonts(dir = brandFontDir()): { fonts: BrandFonts; missing: string[] } {
  const fonts: BrandFonts = {};
  const missing: string[] = [];
  for (const [k, file] of Object.entries(FONT_FILES) as [keyof BrandFonts, string][]) {
    const f = path.join(dir, file);
    if (fs.existsSync(f) && fs.statSync(f).size > 1000) fonts[k] = `url(data:font/woff2;base64,${fs.readFileSync(f).toString("base64")}) format("woff2")`;
    else missing.push(file);
  }
  return { fonts, missing };
}

// ---------------------------------------------------------------- card specs
export type BrandCard =
  | { kind: "intro"; title: string; eyebrow: string; meta?: string }
  | { kind: "part"; index: number; count: number; label: string; title: string; videoTitle?: string }
  | { kind: "outro"; line: string; url: string }
  | { kind: "thumb"; title: string; eyebrow: string; shot?: string /* image URL (data:) */ };

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** UI strings per language. */
export function brandStrings(lang?: string) {
  if (lang === "en") return { eyebrow: "Video guide", part: (i: number, n: number) => `Part ${i} of ${n}`, outro: "Questions? Ask Ellie in the app.", min: (m: number) => `${m} min` };
  if (lang === "sk") return { eyebrow: "Videonávod", part: (i: number, n: number) => `Časť ${i} z ${n}`, outro: "Otázky? Opýtajte sa Ellie v aplikácii.", min: (m: number) => `${m} min` };
  return { eyebrow: "Videonávod", part: (i: number, n: number) => `Část ${i} z ${n}`, outro: "Dotazy? Zeptejte se Ellie v aplikaci.", min: (m: number) => `${m} min` };
}

const fontFaces = (f: BrandFonts) =>
  [
    f.geometriaBold && `@font-face{font-family:"SvpGeometria";font-weight:700;src:${f.geometriaBold};}`,
    f.interRegular && `@font-face{font-family:"SvpInter";font-weight:400;src:${f.interRegular};}`,
    f.interSemiBold && `@font-face{font-family:"SvpInter";font-weight:600;src:${f.interSemiBold};}`,
  ].filter(Boolean).join("\n");

/**
 * Full HTML document for one card at width x height. Layout scales with height (1rem = height/108 px),
 * so 1920x1080, 1280x720 and 2560x1440 look identical.
 */
export function cardHtml(card: BrandCard, width: number, height: number, fonts: BrandFonts = {}, t: BrandTokens = BRAND): string {
  const rem = height / 108;
  const head = `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces(fonts)}
:root{--bg:${t.bg};--lav:${t.lavender};--loop:${t.loop};--loop-strong:${t.loopStrong};--primary:${t.primary};--primary-dark:${t.primaryDark};--track:${t.track};--ink:${t.ink};--muted:${t.muted};--white:${t.white};
--display:"SvpGeometria",Geometria,"Inter Display",Inter,"Helvetica Neue",Arial,sans-serif;--text:"SvpInter",Inter,"Helvetica Neue",Arial,sans-serif;}
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:${rem.toFixed(4)}px}
body{width:${width}px;height:${height}px;overflow:hidden;background:var(--bg);color:var(--ink);font-family:var(--text);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.stage{position:relative;width:100%;height:100%;overflow:hidden}
.loop{position:absolute;pointer-events:none}
.loop svg{width:100%;height:100%;display:block}
.logo{position:absolute;color:var(--ink);--logo-loop:var(--primary)}
.logo svg{height:100%;width:auto;display:block}
.eyebrow{font:600 2.6rem/1 var(--text);color:var(--primary);letter-spacing:0.01em}
.title{font-family:var(--display);font-weight:700;color:var(--ink);letter-spacing:-0.025em;line-height:1.04;text-wrap:balance}
.muted{font:400 2.4rem/1.3 var(--text);color:var(--muted)}
</style></head><body><div class="stage">`;
  const tail = `</div></body></html>`;
  const W = width / rem; // stage width in rem (192 at 16:9)
  // the loop's tail ends in a straight cut: keep it below the bottom edge so only curves are visible
  const LOOP = `<div class="loop" style="width:124rem;height:92.5rem;right:-34rem;top:30rem">${LOOP_SVG("var(--loop)")}</div>`;

  if (card.kind === "intro") {
    return head + `
${LOOP}
<div class="logo" style="left:12rem;top:10rem;height:4.4rem">${LOGO_SVG}</div>
<div style="position:absolute;left:12rem;top:0;bottom:0;width:${Math.min(112, W - 24)}rem;display:flex;flex-direction:column;justify-content:center;gap:3.2rem">
  <div class="eyebrow">${esc(card.eyebrow)}</div>
  <div class="title" style="font-size:${card.title.length > 42 ? 8.4 : 10}rem">${esc(card.title)}</div>
</div>
${card.meta ? `<div class="muted" style="position:absolute;left:12rem;bottom:10rem">${esc(card.meta)}</div>` : ""}` + tail;
  }

  if (card.kind === "part") {
    const segs = Array.from({ length: Math.max(1, card.count) }, (_, i) =>
      `<i style="flex:1;height:0.6rem;border-radius:0.3rem;background:${i < card.index ? "var(--primary)" : "var(--track)"}"></i>`).join("");
    return head + `
${LOOP}
<div class="logo" style="left:12rem;top:10rem;height:3.4rem">${LOGO_SVG}</div>
<div style="position:absolute;left:12rem;top:0;bottom:0;width:${Math.min(112, W - 24)}rem;display:flex;flex-direction:column;justify-content:center;gap:3rem">
  <div class="eyebrow">${esc(card.label)}</div>
  <div class="title" style="font-size:${card.title.length > 28 ? 9 : 11.2}rem">${esc(card.title)}</div>
  <div style="display:flex;gap:0.8rem;width:${Math.min(56, 11 * card.count)}rem;margin-top:1.6rem">${segs}</div>
</div>
${card.videoTitle ? `<div class="muted" style="position:absolute;left:12rem;bottom:10rem">${esc(card.videoTitle)}</div>` : ""}` + tail;
  }

  if (card.kind === "outro") {
    return head + `
${LOOP}
<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4.4rem">
  <div class="logo" style="position:static;height:9.6rem">${LOGO_SVG}</div>
  <div class="muted" style="text-align:center">${esc(card.line)}<br><span style="font-weight:600;color:var(--ink)">${esc(card.url)}</span></div>
</div>` + tail;
  }

  // thumb: big title left, app screenshot bleeding off the right edge, loop behind it
  const long = card.title.length > 30;
  return head + `
<div class="loop" style="width:124rem;height:92.5rem;right:-40rem;top:4rem">${LOOP_SVG("var(--loop-strong)")}</div>
${card.shot ? `<div style="position:absolute;left:${(W * 0.55).toFixed(1)}rem;top:19rem;width:118rem;height:66.4rem;border-radius:2rem;overflow:hidden;background:var(--white);box-shadow:0 2.4rem 6rem rgba(58,49,181,0.18),0 0 0 0.2rem rgba(82,69,255,0.08)">
  <img src="${card.shot}" style="width:100%;height:100%;object-fit:cover;object-position:left top;display:block;transform:scale(1.3);transform-origin:left top"></div>` : ""}
<div class="logo" style="left:9rem;top:9rem;height:4.4rem">${LOGO_SVG}</div>
<div style="position:absolute;left:9rem;top:0;bottom:0;width:${card.shot ? (W * 0.55 - 12).toFixed(1) : (W - 18).toFixed(1)}rem;display:flex;flex-direction:column;justify-content:center;gap:3.2rem;padding-top:4rem">
  <div class="title" style="font-size:${long ? 9.6 : 12}rem;line-height:1">${esc(card.title)}</div>
  <div><span style="display:inline-block;font:600 2.8rem/1 var(--text);color:var(--white);background:var(--primary);padding:1.4rem 2.4rem;border-radius:99rem">${esc(card.eyebrow)}</span></div>
</div>` + tail;
}
