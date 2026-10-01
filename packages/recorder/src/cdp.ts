// CDP endpoint discovery for attaching the recorder to an already running, logged-in browser
// (Martin's BrowserOS neo on macOS). No Playwright here: plain fetch / WebSocket (Node >= 22).
//
// `auto` tries, in order:
//   1. env CDP_URL (http://host:port or ws://...)
//   2. DevToolsActivePort files in macOS profile dirs (line 1 = port, line 2 = ws path) –
//      written by Chrome-style browsers started with --remote-debugging-port or with the
//      chrome://inspect "remote debugging" toggle. BrowserOS neo's built-in CDP server does NOT
//      write this file (it passes an empty output dir), so for neo step 3 is what hits.
//   3. "Local State" pref `browseros.server.cdp_port` in the same profile dirs (BrowserOS neo / BrowserOS
//      store the port their managed CDP server actually bound to there; default 9110 for neo, 9100 for BrowserOS).
//   4. http://127.0.0.1:{9110,9100,9222,9229,9000,9001,9002,9003}/json/version
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CdpEndpoint {
  /** What to pass to chromium.connectOverCDP (http://127.0.0.1:PORT or ws://...). */
  endpoint: string;
  /** Where it came from (env, file path, port probe). */
  source: string;
  /** /json/version "Browser" (e.g. "Chrome/151.0.7922.137") when available. */
  browser?: string;
  userAgent?: string;
  wsUrl?: string;
}

export interface CdpTarget { type: string; title: string; url: string }

/** BrowserOS neo's built-in CDP port (chromium_patches/.../browseros_server_prefs.h, BROWSERCLAW product). */
export const BROWSEROS_NEO_CDP_PORT = 9110;
/** BrowserOS (classic) built-in CDP port. */
export const BROWSEROS_CDP_PORT = 9100;
export const PROBE_PORTS = [BROWSEROS_NEO_CDP_PORT, BROWSEROS_CDP_PORT, 9222, 9229, 9000, 9001, 9002, 9003];

/**
 * macOS user-data dirs to look in. "BrowserClaw" is the real profile root of BrowserOS neo
 * (CrProductDirName; also listed in the Homebrew cask's zap stanza), "BrowserOS" the classic one.
 * The other spellings are cheap guesses kept for robustness.
 */
export function macProfileDirs(home = os.homedir()): string[] {
  const base = path.join(home, 'Library', 'Application Support');
  return ['BrowserClaw', 'BrowserOS', 'BrowserOS neo', 'BrowserOS Neo', 'browseros', 'browseros-neo'].map(d => path.join(base, d));
}

/** DevToolsActivePort: line 1 = port, line 2 = browser ws path (/devtools/browser/<uuid>). */
export function parseDevToolsActivePort(text: string): { port: number; wsPath?: string } | null {
  const [l1, l2] = text.split(/\r?\n/).map(s => s.trim());
  const port = Number(l1);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { port, wsPath: l2 && l2.startsWith('/') ? l2 : undefined };
}

/** `browseros.server.cdp_port` from a Chromium "Local State" JSON (nested or dotted key). */
export function parseLocalStateCdpPort(text: string): number | null {
  try {
    const j = JSON.parse(text);
    const v = j?.browseros?.server?.cdp_port ?? j?.['browseros.server.cdp_port'];
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n <= 65535 ? n : null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, timeoutMs = 1200): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Probe http://host:port/json/version; only accept real browser endpoints (not Node's inspector, not random JSON). */
export async function probeHttp(httpBase: string): Promise<{ browser?: string; userAgent?: string; wsUrl?: string } | null> {
  const j = await fetchJson(httpBase.replace(/\/$/, '') + '/json/version');
  if (!j || typeof j !== 'object') return null;
  if (typeof j.webSocketDebuggerUrl !== 'string') return null;
  if (typeof j.Browser === 'string' && /^node/i.test(j.Browser)) return null;
  return { browser: j.Browser, userAgent: j['User-Agent'], wsUrl: j.webSocketDebuggerUrl };
}

/** Minimal one-shot CDP call over a browser WebSocket (used when /json/* is not served). */
export async function cdpCall(wsUrl: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 3000): Promise<any> {
  const WS = (globalThis as any).WebSocket;
  if (!WS) throw new Error('global WebSocket missing (Node >= 22 required)');
  return await new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } reject(new Error(`CDP ${method}: timeout`)); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`CDP websocket error (${wsUrl.replace(/\/devtools\/.*/, '/devtools/…')})`)); };
    ws.onmessage = (ev: { data: string }) => {
      const m = JSON.parse(String(ev.data));
      if (m.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (m.error) reject(new Error(`CDP ${method}: ${m.error.message}`)); else resolve(m.result);
    };
  });
}

const httpBaseOf = (endpoint: string): string | null => {
  try {
    const u = new URL(endpoint);
    if (u.protocol === 'http:' || u.protocol === 'https:') return `${u.protocol}//${u.host}`;
    if (u.protocol === 'ws:' || u.protocol === 'wss:') return `${u.protocol === 'wss:' ? 'https' : 'http'}://${u.host}`;
  } catch { /* fallthrough */ }
  return null;
};

/** Validate an explicit endpoint (http or ws). */
export async function checkEndpoint(endpoint: string, source: string): Promise<CdpEndpoint | null> {
  const ep = /^\d+$/.test(endpoint) ? `http://127.0.0.1:${endpoint}` : endpoint;
  const base = httpBaseOf(ep);
  if (!base) return null;
  const v = await probeHttp(base);
  if (v) return { endpoint: ep.startsWith('ws') ? ep : base, source, ...v };
  if (ep.startsWith('ws')) {
    // e.g. chrome://inspect toggle mode: websocket works, /json/* is 404
    try { await cdpCall(ep, 'Browser.getVersion'); return { endpoint: ep, source, wsUrl: ep }; } catch { return null; }
  }
  return null;
}

export interface DiscoverOptions { env?: NodeJS.ProcessEnv; home?: string; ports?: number[]; log?: (l: string) => void }

/** Resolve `auto` or an explicit endpoint. Returns null when nothing answers; `tried` lists what was attempted. */
export async function discoverCdp(spec: string, o: DiscoverOptions = {}): Promise<{ found: CdpEndpoint | null; tried: string[] }> {
  const env = o.env ?? process.env;
  const tried: string[] = [];
  if (spec && spec !== 'auto') {
    tried.push(spec);
    return { found: await checkEndpoint(spec, 'flag --cdp'), tried };
  }
  if (env.CDP_URL) {
    tried.push(`env CDP_URL=${env.CDP_URL}`);
    const f = await checkEndpoint(env.CDP_URL, 'env CDP_URL');
    if (f) return { found: f, tried };
  }
  const dirs = macProfileDirs(o.home);
  for (const d of dirs) {
    const file = path.join(d, 'DevToolsActivePort');
    if (!fs.existsSync(file)) continue;
    tried.push(file);
    const p = parseDevToolsActivePort(fs.readFileSync(file, 'utf8'));
    if (!p) continue;
    const http = await checkEndpoint(`http://127.0.0.1:${p.port}`, file);
    if (http) return { found: http, tried };
    if (p.wsPath) {
      const ws = await checkEndpoint(`ws://127.0.0.1:${p.port}${p.wsPath}`, file);
      if (ws) return { found: ws, tried };
    }
  }
  const statePorts: number[] = [];
  for (const d of dirs) {
    const file = path.join(d, 'Local State');
    if (!fs.existsSync(file)) continue;
    const port = parseLocalStateCdpPort(fs.readFileSync(file, 'utf8'));
    if (!port) continue;
    tried.push(`${file} (browseros.server.cdp_port=${port})`);
    statePorts.push(port);
    const f = await checkEndpoint(`http://127.0.0.1:${port}`, `${file} (browseros.server.cdp_port)`);
    if (f) return { found: f, tried };
  }
  for (const port of o.ports ?? PROBE_PORTS) {
    if (statePorts.includes(port)) continue;
    tried.push(`http://127.0.0.1:${port}/json/version`);
    const f = await checkEndpoint(`http://127.0.0.1:${port}`, `port probe ${port}`);
    if (f) return { found: f, tried };
  }
  return { found: null, tried };
}

/** Strip query/fragment so tokens in tab URLs never reach the terminal. */
export function safeUrl(u: string): string {
  try {
    const x = new URL(u);
    if (x.protocol === 'http:' || x.protocol === 'https:') return `${x.origin}${x.pathname}`.slice(0, 120);
    return `${x.protocol}${x.host}${x.pathname}`.slice(0, 120);
  } catch {
    return u.split(/[?#]/)[0].slice(0, 120);
  }
}

/** Page targets of the browser (titles + sanitized URLs). */
export async function listTargets(ep: CdpEndpoint): Promise<CdpTarget[]> {
  const base = httpBaseOf(ep.endpoint);
  let raw: any[] | null = base ? await fetchJson(base + '/json/list') : null;
  if (!Array.isArray(raw)) {
    const ws = ep.wsUrl ?? (ep.endpoint.startsWith('ws') ? ep.endpoint : undefined);
    if (!ws) return [];
    const r = await cdpCall(ws, 'Target.getTargets');
    raw = (r?.targetInfos ?? []).map((t: any) => ({ type: t.type, title: t.title, url: t.url }));
  }
  return (raw ?? []).map(t => ({ type: String(t.type), title: String(t.title ?? ''), url: safeUrl(String(t.url ?? '')) }));
}
