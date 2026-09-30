import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

// Minimal message shapes (subset of the Messages API) so the scripted model needs no SDK.
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string | any[]; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface Msg { role: 'user' | 'assistant'; content: Block[] }

export interface ToolDef { name: string; description: string; input_schema: any }

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface ModelReply { content: Block[]; stop_reason: string | null; usage: Usage }

export interface ModelClient {
  name: string;
  create(req: { system: string; tools: ToolDef[]; messages: Msg[]; stepId: string }): Promise<ModelReply>;
}

// Sonnet 4.5 list price, USD per million tokens.
export const PRICE = { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 };
export function usd(u: Usage): number {
  return (u.input_tokens * PRICE.input + u.output_tokens * PRICE.output
    + u.cache_read_input_tokens * PRICE.cache_read + u.cache_creation_input_tokens * PRICE.cache_write) / 1e6;
}

export class AnthropicModel implements ModelClient {
  private client = new Anthropic();
  constructor(public name = process.env.EXPLORER_MODEL || 'claude-sonnet-4-5') {}

  async create(req: { system: string; tools: ToolDef[]; messages: Msg[] }): Promise<ModelReply> {
    const tools = req.tools.map((t, i) =>
      i === req.tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t);
    const res = await this.client.messages.create({
      model: this.name,
      max_tokens: 2048,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      tools: tools as any,
      messages: req.messages as any,
    });
    return {
      content: res.content as Block[],
      stop_reason: res.stop_reason,
      usage: {
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/**
 * Dry-run model: replays a fixture of tool calls per step. Placeholders are resolved
 * against the latest snapshot the explorer produced, so the snapshot generator and the
 * selector derivation are genuinely exercised:
 *   "@ref:testid=nav-absences"   -> the [n] of the snapshot line containing `testid=nav-absences`
 *   "@sel:testid=nav-absences"   -> the selector= of that line
 *   "@ref:\"Nová absence\""      -> match by any substring of the line
 * Fixture: { "steps": { "s02": [ {"tool":"click","input":{"ref":"@ref:testid=nav-absences"}}, ... ] } }
 */
export class ScriptedModel implements ModelClient {
  name = 'scripted-dry-run';
  private cursor = new Map<string, number>();
  private fixture: { steps: Record<string, { tool: string; input: any }[]> };
  private seq = 0;
  constructor(fixturePath: string) {
    this.fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  }

  private latestSnapshot(messages: Msg[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const b of [...messages[i].content].reverse()) {
        const texts: string[] = [];
        if (b.type === 'text') texts.push(b.text);
        if (b.type === 'tool_result') {
          if (typeof b.content === 'string') texts.push(b.content);
          else for (const c of b.content) if (c.type === 'text') texts.push(c.text);
        }
        for (const t of texts) { const k = t.indexOf('# snapshot g'); if (k >= 0) return t.slice(k); }
      }
    }
    throw new Error('scripted model: no snapshot in context');
  }

  private resolve(v: any, snap: string): any {
    if (typeof v === 'string') {
      const m = v.match(/^@(ref|sel):(.+)$/);
      if (!m) return v;
      const needle = m[2];
      const line = snap.split('\n').find((l) => /^\[\d+\]/.test(l) && (l.includes(` ${needle} `) || l.endsWith(` ${needle}`) || l.includes(needle)));
      if (!line) throw new Error(`scripted model: no snapshot line matches "${needle}"\n${snap}`);
      if (m[1] === 'ref') return Number(line.match(/^\[(\d+)\]/)![1]);
      const sel = line.match(/ selector=(.+?)(?: \([^)]*\))?$/);
      if (!sel || sel[1] === '(none)') throw new Error(`scripted model: line has no selector: ${line}`);
      return sel[1];
    }
    if (Array.isArray(v)) return v.map((x) => this.resolve(x, snap));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.resolve(x, snap)]));
    return v;
  }

  async create(req: { messages: Msg[]; stepId: string }): Promise<ModelReply> {
    const list = this.fixture.steps[req.stepId] ?? [];
    const i = this.cursor.get(req.stepId) ?? 0;
    this.cursor.set(req.stepId, i + 1);
    const zero = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    if (i >= list.length) return { content: [{ type: 'text', text: '(script exhausted)' }], stop_reason: 'end_turn', usage: zero };
    const call = list[i];
    const input = this.resolve(call.input ?? {}, this.latestSnapshot(req.messages));
    return {
      content: [{ type: 'tool_use', id: `toolu_dry_${++this.seq}`, name: call.tool, input }],
      stop_reason: 'tool_use',
      usage: zero,
    };
  }
}
