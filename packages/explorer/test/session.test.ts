// Session driver: request/reply file exchange, rejected replies, finish marker, helper script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SessionModel } from '../src/session.ts';
import { SYSTEM_PROMPT, TOOLS } from '../src/prompt.ts';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const until = async (cond: () => boolean) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50)); assert.ok(cond(), 'timed out'); };

test('session model: request file, rejected reply, accepted reply, finish marker', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'svp-session-'));
  const m = new SessionModel(out, 10_000);
  const turn = (k: string) => path.join(m.dir, `turn-0001.${k}`);
  const pending = m.create({ system: SYSTEM_PROMPT, tools: TOOLS, stepId: 's01',
    messages: [{ role: 'user', content: [{ type: 'text', text: '# snapshot g1\n[1] a "Absence" selector=[data-testid=nav-absences]' }] }] });

  await until(() => fs.existsSync(turn('request.md')));
  const req = fs.readFileSync(turn('request.md'), 'utf8');
  assert.match(req, /## System prompt/);
  assert.match(req, /# NEW STEP s01/);
  assert.match(req, /\*\*done\*\*/);

  fs.writeFileSync(turn('reply.json'), '{"calls":[{"name":"tap","input":{}}]}');
  await until(() => fs.existsSync(turn('error.txt')));
  assert.match(fs.readFileSync(turn('error.txt'), 'utf8'), /unknown tool "tap"/);

  fs.writeFileSync(turn('reply.json'), '{"calls":[{"name":"click","input":{"ref":1}},{"name":"snapshot","input":{}}]}');
  const r = await pending;
  assert.deepEqual(r.content.map((b: any) => [b.type, b.name, b.input]), [['tool_use', 'click', { ref: 1 }], ['tool_use', 'snapshot', {}]]);
  assert.ok(!fs.existsSync(turn('error.txt')));

  // helper script: no pending turn -> WAITING; after finish() -> FINISHED
  const helper = () => spawnSync('node', [path.join(ROOT, 'scripts/explorer-turn.mjs'), path.basename(out), '--wait', '0'],
    { encoding: 'utf8', env: { ...process.env, SVP_OUT_DIR: path.dirname(out) } }).stdout.trim().split('\n').pop();
  assert.equal(helper(), 'WAITING');
  m.finish();
  assert.equal(helper(), 'FINISHED');
  fs.rmSync(out, { recursive: true, force: true });
});
