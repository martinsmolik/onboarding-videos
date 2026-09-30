#!/usr/bin/env node
// Offline smoke test: demo server (:4173) -> pipeline run tts+record+mux with mock voice -> verify final.mp4
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173; // samples/recipe.absence-request.json hardcodes http://localhost:4173
const outRoot = path.resolve(process.env.SVP_OUT_DIR || path.join(root, 'out'));
const final = path.join(outRoot, 'smoke', 'final.mp4');
let server;
const t0 = Date.now();

const fail = (msg) => { console.error(`\nSMOKE FAIL: ${msg}`); cleanup(); process.exit(1); };
function cleanup() { if (server && !server.killed) server.kill('SIGTERM'); }
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

const portBusy = () => new Promise((res) => {
  const s = net.createServer().once('error', () => res(true)).once('listening', () => s.close(() => res(false)));
  s.listen(PORT);
});
const waitHttp = async (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(`http://localhost:${PORT}/index.html`)).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

for (const bin of ['ffmpeg', 'ffprobe']) {
  if (spawnSync(bin, ['-version'], { stdio: 'ignore' }).status !== 0) fail(`${bin} neni v PATH (macOS: brew install ffmpeg)`);
}
if (await portBusy()) fail(`port ${PORT} je obsazeny (zavri jiny 'pnpm demo' / proces: lsof -i :${PORT})`);

server = spawn(process.execPath, [path.join(root, 'scripts/serve-demo.mjs')], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
if (!(await waitHttp(10000))) fail('demo server nenabehl');
console.log(`demo server on :${PORT}`);

const r = spawnSync('pnpm', ['pipeline', 'run', '--id', 'smoke', '--recipe', 'samples/recipe.absence-request.json', '--to', 'mux', '--force'],
  { cwd: root, stdio: 'inherit', env: process.env, timeout: 170000 });
if (r.status !== 0) fail(`pipeline skoncila s kodem ${r.status ?? r.signal}`);

if (!fs.existsSync(final)) fail(`${final} neexistuje`);
const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', final], { encoding: 'utf8' });
if (pr.status !== 0) fail(`ffprobe selhal: ${pr.stderr}`);
const info = JSON.parse(pr.stdout);
const dur = Number(info.format?.duration);
const audio = (info.streams || []).filter((s) => s.codec_type === 'audio').length;
const video = (info.streams || []).filter((s) => s.codec_type === 'video').length;
console.log(`final.mp4: duration=${dur.toFixed(1)}s audio_streams=${audio} video_streams=${video}`);
if (!(dur > 20)) fail(`delka ${dur}s <= 20s`);
if (audio !== 1) fail(`ocekavan 1 audio stream, je ${audio}`);
if (video < 1) fail('chybi video stream');

cleanup();
console.log(`\nSMOKE PASS (${Math.round((Date.now() - t0) / 1000)}s)`);
process.exit(0);
