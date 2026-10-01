#!/usr/bin/env node
// One turn of the session-driven explorer (EXPLORER_DRIVER=session), for the Claude that runs the session.
// Usage: node scripts/explorer-turn.mjs <id> [--reply <file.json>] [--wait <seconds>]
//   --reply  answers the pending turn ({"calls":[{"name":"click","input":{"ref":12}}]}), then waits
//   prints the next request (tool results / snapshot) as soon as the explorer asks for one.
// Last line of output is a status for the caller:
//   TURN <n>       a request is printed above; answer it with --reply
//   REJECTED <n>   your reply was unusable (reason above); write a corrected one
//   FINISHED       the explorer process ended – check `pnpm pipeline status --id <id>`
//   WAITING        nothing yet (explorer is replaying in a fresh browser); call again without --reply
//   NO-SESSION     no session-driven explorer has started for this id yet
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const id = argv[0];
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
if (!id || id.startsWith('--')) { console.error('usage: node scripts/explorer-turn.mjs <id> [--reply <file.json>] [--wait <seconds>]'); process.exit(2); }
const root = path.resolve(new URL('..', import.meta.url).pathname);
const base = path.join(path.resolve(process.env.SVP_OUT_DIR || path.join(root, 'out')), id, 'explorer-session');
const waitMs = Number(opt('--wait') ?? 240) * 1000;

const runDir = () => {
  try { return path.join(base, fs.readFileSync(path.join(base, 'current'), 'utf8').trim()); } catch { return null; }
};
const pad = (n) => String(n).padStart(4, '0');
/** highest turn number that has a request */
const lastTurn = (dir) => Math.max(0, ...fs.readdirSync(dir).map((f) => f.match(/^turn-(\d{4})\.request\.md$/)?.[1]).filter(Boolean).map(Number));
const f = (dir, n, kind) => path.join(dir, `turn-${pad(n)}.${kind}`);

let dir = runDir();
const reply = opt('--reply');
if (reply) {
  if (!dir) { console.log('NO-SESSION'); process.exit(1); }
  const n = lastTurn(dir);
  const raw = fs.readFileSync(path.resolve(process.env.INIT_CWD || process.cwd(), reply), 'utf8');
  try { JSON.parse(raw); } catch (e) { console.log(`not valid JSON: ${e.message}\nREJECTED ${n}`); process.exit(1); }
  if (fs.existsSync(f(dir, n, 'reply.json'))) { console.log(`turn ${n} is already answered`); }
  else { fs.writeFileSync(f(dir, n, 'reply.json') + '.tmp', raw); fs.renameSync(f(dir, n, 'reply.json') + '.tmp', f(dir, n, 'reply.json')); }
}

const deadline = Date.now() + waitMs;
while (true) {
  dir = runDir();
  if (dir && fs.existsSync(dir)) {
    const n = lastTurn(dir);
    const errF = n ? f(dir, n, 'error.txt') : null;
    if (errF && fs.existsSync(errF) && !fs.existsSync(f(dir, n, 'reply.json'))) {
      console.log(fs.readFileSync(errF, 'utf8')); console.log(`REJECTED ${n}`); process.exit(0);
    }
    if (n && !fs.existsSync(f(dir, n, 'reply.json')) && !(errF && fs.existsSync(errF))) {
      console.log(fs.readFileSync(f(dir, n, 'request.md'), 'utf8')); console.log(`TURN ${n}`); process.exit(0);
    }
    if (fs.existsSync(path.join(dir, 'finished.json'))) { console.log('FINISHED'); process.exit(0); }
  }
  if (Date.now() > deadline) { console.log(dir ? 'WAITING' : 'NO-SESSION'); process.exit(0); }
  await new Promise((r) => setTimeout(r, 500));
}
