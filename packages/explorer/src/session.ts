import fs from 'node:fs';
import path from 'node:path';
import type { Block, ModelClient, ModelReply, Msg, ToolDef } from './model.ts';

/**
 * Session driver (EXPLORER_DRIVER=session): the "model" is the Claude that runs the surrounding
 * Claude Code session, so exploration is billed to that user's plan instead of an API key.
 *
 * Each model call becomes a file exchange in <out>/explorer-session/<run>/:
 *   turn-0001.request.md   written here: the new tool results / snapshot (+ system prompt on turn 1)
 *   turn-0001.reply.json   written by Claude: {"calls":[{"name":"click","input":{"ref":12}}, ...]}
 *   turn-0001.error.txt    written here when a reply is unusable; Claude writes a new reply
 *   finished.json          written when the explorer process ends
 * <out>/explorer-session/current names the active run. scripts/explorer-turn.mjs drives this loop.
 * The explorer itself is unchanged: every done() is still re-validated by deterministic replay.
 */
export class SessionModel implements ModelClient {
  name = 'session (Claude Code)';
  readonly dir: string;
  private turn = 0;
  private toolNames = new Map<string, string>();
  private seq = 0;

  constructor(outDir: string, private timeoutMs = Number(process.env.EXPLORER_SESSION_TIMEOUT_MS || 30 * 60_000)) {
    const root = path.join(outDir, 'explorer-session');
    const run = new Date().toISOString().replace(/[:.]/g, '-');
    this.dir = path.join(root, run);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(root, 'current'), run + '\n');
  }

  private file(kind: 'request.md' | 'reply.json' | 'error.txt', n = this.turn): string {
    return path.join(this.dir, `turn-${String(n).padStart(4, '0')}.${kind}`);
  }

  private render(req: { system: string; tools: ToolDef[]; messages: Msg[]; stepId: string }): string {
    const out: string[] = [];
    if (this.turn === 1) {
      out.push('# Explorer session', '', 'You are the model of the explorer. Reply to every turn with tool calls only, as JSON:',
        '`{"calls":[{"name":"<tool>","input":{...}}]}` (one or more calls, executed in order).', '',
        '## System prompt', '', req.system, '', '## Tools', '');
      for (const t of req.tools) out.push(`- **${t.name}**: ${t.description}`, `  input: \`${JSON.stringify(t.input_schema.properties ?? {})}\``);
      out.push('');
    }
    const last = req.messages[req.messages.length - 1];
    out.push(req.messages.length === 1 ? `# NEW STEP ${req.stepId} (turn ${this.turn})` : `# step ${req.stepId} · turn ${this.turn}`, '');
    let img = 0;
    const image = (b: Extract<Block, { type: 'image' }>) => {
      const f = this.file('request.md').replace(/\.request\.md$/, `.img${++img}.jpg`);
      fs.writeFileSync(f, Buffer.from(b.source.data, 'base64'));
      return `[screenshot saved: ${f} – open it with the Read tool]`;
    };
    for (const b of last.content) {
      if (b.type === 'text') out.push(b.text, '');
      else if (b.type === 'image') out.push(image(b), '');
      else if (b.type === 'tool_result') {
        out.push(`## ${this.toolNames.get(b.tool_use_id) ?? 'tool'} → ${b.is_error ? 'ERROR' : 'result'}`, '');
        if (typeof b.content === 'string') out.push(b.content, '');
        else for (const c of b.content) out.push(c.type === 'image' ? image(c) : c.text ?? JSON.stringify(c), '');
      }
    }
    return out.join('\n');
  }

  private parse(raw: string, tools: ToolDef[]): { name: string; input: any }[] {
    const j = JSON.parse(raw);
    const calls = Array.isArray(j) ? j : j?.calls;
    if (!Array.isArray(calls) || !calls.length) throw new Error('expected {"calls":[{"name":..., "input":{...}}]} with at least one call');
    const known = new Set(tools.map((t) => t.name));
    return calls.map((c: any, i: number) => {
      const name = c?.name ?? c?.tool;
      if (!known.has(name)) throw new Error(`call ${i + 1}: unknown tool "${name}" (tools: ${[...known].join(', ')})`);
      return { name, input: c.input ?? {} };
    });
  }

  async create(req: { system: string; tools: ToolDef[]; messages: Msg[]; stepId: string }): Promise<ModelReply> {
    this.turn++;
    const reqF = this.file('request.md');
    fs.writeFileSync(reqF + '.tmp', this.render(req));
    fs.renameSync(reqF + '.tmp', reqF);
    const replyF = this.file('reply.json');
    const deadline = Date.now() + this.timeoutMs;
    for (let attempt = 1; ; ) {
      if (Date.now() > deadline) throw new Error(`session driver: no reply to ${path.basename(reqF)} within ${Math.round(this.timeoutMs / 60_000)} min`);
      if (fs.existsSync(replyF)) {
        const raw = fs.readFileSync(replyF, 'utf8');
        try {
          const calls = this.parse(raw, req.tools);
          fs.rmSync(this.file('error.txt'), { force: true });
          const content: Block[] = calls.map((c) => {
            const id = `toolu_session_${++this.seq}`;
            this.toolNames.set(id, c.name);
            return { type: 'tool_use', id, name: c.name, input: c.input };
          });
          const zero = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
          return { content, stop_reason: 'tool_use', usage: zero };
        } catch (e) {
          fs.renameSync(replyF, replyF.replace(/\.json$/, `.rejected${attempt++}.json`));
          fs.writeFileSync(this.file('error.txt'), `Reply rejected: ${(e as Error).message}\nWrite a corrected ${path.basename(replyF)}.\n`);
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  finish(): void {
    fs.writeFileSync(path.join(this.dir, 'finished.json'), JSON.stringify({ at: new Date().toISOString(), turns: this.turn }) + '\n');
  }
}
