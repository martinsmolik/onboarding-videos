// The in-process tool loop: one scenario step at a time, LLM drives the browser,
// the result is independently re-validated by deterministic replay.
import type { Browser } from 'playwright';
import type { Block, ModelClient, Msg, Usage } from './model.ts';
import { usd } from './model.ts';
import { SYSTEM_PROMPT, TOOLS } from './prompt.ts';
import { takeSnapshot, type SnapItem } from './snapshot.ts';
import {
  checkExpect, openFresh, perform, settle, validateActions, waitUnique, ValidationError,
  type Session, type StartState,
} from './replay.ts';
import type { Action, Expect, StepUsage } from './types.ts';

export interface StepTask {
  id: string;
  /** key into the dry-run fixture (defaults to id) */
  scriptKey?: string;
  narration: string;
  intent: string;
  must_show?: string;
  healContext?: string;
}

export interface AcceptedStep { id: string; intent?: string; actions: Action[]; expect?: Expect }

export interface StepResult { actions: Action[]; expect?: Expect; usage: StepUsage }

export class StepFailed extends Error {
  constructor(public stepId: string, msg: string, public usage?: StepUsage) { super(`${stepId}: ${msg}`); }
}
export class PrefixFailed extends Error {
  constructor(public index: number, msg: string) { super(msg); }
}

const ALLOWED_TYPES = new Set(['navigate', 'click', 'hover', 'type', 'press', 'select', 'scroll', 'wait']);

function sanitizeActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) throw new ValidationError(-1, 'actions must be an array');
  return raw.map((a: any, i) => {
    if (!a || !ALLOWED_TYPES.has(a.type)) throw new ValidationError(i, `action #${i + 1}: invalid type ${JSON.stringify(a?.type)}`);
    const o: Action = { type: a.type };
    if (typeof a.selector === 'string' && a.selector.trim()) o.selector = a.selector.trim();
    if (a.value !== undefined && a.value !== null) o.value = String(a.value);
    if (a.clear === true) o.clear = true;
    return o;
  });
}

function sanitizeExpect(raw: any): Expect | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e: Expect = {};
  if (typeof raw.visible === 'string' && raw.visible.trim()) e.visible = raw.visible.trim();
  if (typeof raw.url_contains === 'string' && raw.url_contains.trim()) e.url_contains = raw.url_contains.trim();
  return Object.keys(e).length ? e : undefined;
}

export interface ExplorerOptions {
  maxToolCalls?: number; // per step
  maxRefineRounds?: number; // rejected `done` calls tolerated before failing
  context?: { title: string; lang: string; audience: string };
  log?: (s: string) => void;
}

export class Explorer {
  accepted: AcceptedStep[] = [];
  current: Session | null = null;
  private refs = new Map<number, SnapItem>();
  private maxToolCalls: number;
  private maxRounds: number;
  private log: (s: string) => void;

  constructor(private browser: Browser, public start: StartState, private model: ModelClient, private opts: ExplorerOptions = {}) {
    this.maxToolCalls = opts.maxToolCalls ?? Number(process.env.EXPLORER_MAX_TOOL_CALLS || 12);
    this.maxRounds = opts.maxRefineRounds ?? 3;
    this.log = opts.log ?? ((s) => console.error(s));
  }

  /** Fresh browser, deterministic replay of all accepted steps (no LLM). */
  async replayPrefix(): Promise<Session> {
    const s = await openFresh(this.browser, this.start);
    for (let i = 0; i < this.accepted.length; i++) {
      const st = this.accepted[i];
      try {
        await validateActions(s.page, st.actions);
        await checkExpect(s.page, st.expect);
      } catch (e) {
        await s.context.close();
        throw new PrefixFailed(i, `replay of earlier step ${st.id} failed: ${(e as Error).message}`);
      }
    }
    return s;
  }

  async resetCurrent(): Promise<void> {
    await this.current?.context.close().catch(() => {});
    this.current = await this.replayPrefix();
  }

  async close(): Promise<void> {
    await this.current?.context.close().catch(() => {});
    this.current = null;
  }

  // ---------------------------------------------------------------- tools
  private async runTool(name: string, input: any, task: StepTask, state: { done?: StepResult }): Promise<{ content: string | Block[]; is_error?: boolean }> {
    const page = this.current!.page;
    const item = (ref: unknown) => {
      const it = this.refs.get(Number(ref));
      if (!it) throw new Error(`unknown ref [${ref}] – take a new snapshot`);
      if (!it.selector) throw new Error(`[${ref}] has no unique selector; pick another element or use a scoped selector via done()`);
      return it;
    };
    const act = async (a: Action, it: SnapItem) => {
      const n = await waitUnique(page, a.selector!, 3000);
      if (n !== 1) throw new Error(`selector ${a.selector} now matches ${n} elements – take a new snapshot`);
      await perform(page, a);
      const warn = it.unstable ? ' WARNING: this selector is UNSTABLE and will be rejected in done() – use a scoped selector like [data-testid=…] >> text="…".' : '';
      return `ok: ${a.type} ${a.selector}${a.value !== undefined ? ` value=${JSON.stringify(a.value)}` : ''}. URL: ${page.url()}.${warn} Page may have changed – snapshot again before using refs.`;
    };
    switch (name) {
      case 'snapshot': {
        const snap = await takeSnapshot(page);
        this.refs = new Map(snap.items.map((i) => [i.ref, i]));
        return { content: snap.text };
      }
      case 'click': { const it = item(input.ref); return { content: await act({ type: 'click', selector: it.selector! }, it) }; }
      case 'type': {
        const it = item(input.ref);
        return { content: await act({ type: 'type', selector: it.selector!, value: String(input.text ?? ''), ...(input.clear ? { clear: true } : {}) }, it) };
      }
      case 'select': { const it = item(input.ref); return { content: await act({ type: 'select', selector: it.selector!, value: String(input.option) }, it) }; }
      case 'press': await page.keyboard.press(String(input.key)); await settle(page); return { content: `ok: pressed ${input.key}. URL: ${page.url()}` };
      case 'scroll': await perform(page, { type: 'scroll', value: input.dir === 'up' ? 'up' : 'down' }); return { content: 'ok: scrolled' };
      case 'screenshot': {
        const buf = await page.screenshot({ type: 'jpeg', quality: 55 });
        return { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }] };
      }
      case 'verify_visible': {
        const sel = String(input.selector);
        const n = await waitUnique(page, sel, 3000);
        let vis = false; let txt = '';
        if (n >= 1) {
          vis = await page.locator(sel).first().isVisible();
          txt = ((await page.locator(sel).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
        }
        return { content: `${sel}: count=${n}${n === 1 ? '' : ' (must be exactly 1 to be usable)'} visible=${vis}${txt ? ` text=${JSON.stringify(txt)}` : ''}`, is_error: !(n === 1 && vis) };
      }
      case 'done': {
        const actions = sanitizeActions(input.actions);
        const expect = sanitizeExpect(input.expect);
        if (task.must_show && !expect?.visible) throw new ValidationError(-1, `must_show is "${task.must_show}" – provide expect.visible with a selector that proves it`);
        // Independent re-validation: fresh browser, replay previous steps, then this list.
        const s = await this.replayPrefix();
        try {
          await validateActions(s.page, actions);
          await checkExpect(s.page, expect);
        } catch (e) {
          await s.context.close();
          throw e;
        }
        // The validated page becomes the working page: the next step starts from exactly the recorder's state.
        await this.current!.context.close().catch(() => {});
        this.current = s;
        state.done = { actions, expect, usage: undefined as never };
        return { content: 'accepted' };
      }
      default:
        throw new Error(`unknown tool ${name}`);
    }
  }

  // ---------------------------------------------------------------- loop
  private userIntro(task: StepTask, snapshot: string): string {
    const c = this.opts.context;
    const prev = this.accepted.length
      ? this.accepted.map((s) => `- ${s.id}: ${s.intent ?? ''} → ${JSON.stringify(s.actions)}`).join('\n')
      : '(none – this is the first step)';
    return [
      c ? `Video: "${c.title}" (lang=${c.lang}, audience=${c.audience})` : '',
      `Previous steps (already performed; the page is in the state after them):\n${prev}`,
      '',
      `## Current step ${task.id}`,
      `Narration (spoken while your actions run): ${JSON.stringify(task.narration)}`,
      `Intent: ${task.intent}`,
      task.must_show ? `must_show (turn it into expect.visible): ${task.must_show}` : 'must_show: (none given – add expect only if something observable appears)',
      task.healContext ? `\n## SELF-HEAL CONTEXT\n${task.healContext}` : '',
      '',
      `Current page snapshot:\n${snapshot}`,
    ].filter((l) => l !== '').join('\n');
  }

  async exploreStep(task: StepTask): Promise<StepResult> {
    if (!this.current) await this.resetCurrent();
    const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const stat: StepUsage = { step: task.id, calls: 0, tool_calls: 0, rounds: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, usd: 0 };
    const finish = () => Object.assign(stat, usage, { usd: Number(usd(usage).toFixed(4)) });

    const snap = await takeSnapshot(this.current!.page);
    this.refs = new Map(snap.items.map((i) => [i.ref, i]));
    const messages: Msg[] = [{ role: 'user', content: [{ type: 'text', text: this.userIntro(task, snap.text) }] }];
    const state: { done?: StepResult } = {};

    while (true) {
      if (stat.tool_calls >= this.maxToolCalls) throw new StepFailed(task.id, `tool budget of ${this.maxToolCalls} calls exhausted`, finish());
      const reply = await this.model.create({ system: SYSTEM_PROMPT, tools: TOOLS, messages, stepId: task.scriptKey ?? task.id });
      stat.calls++;
      for (const k of Object.keys(usage) as (keyof Usage)[]) usage[k] += reply.usage[k] ?? 0;
      messages.push({ role: 'assistant', content: reply.content });
      const uses = reply.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
      if (!uses.length) {
        stat.tool_calls++; // a wasted turn counts against the budget
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Use the tools. Finish the step by calling done.' }] });
        continue;
      }
      const results: Block[] = [];
      for (const u of uses) {
        stat.tool_calls++;
        if (state.done) { results.push({ type: 'tool_result', tool_use_id: u.id, content: 'skipped: step already accepted' }); continue; }
        try {
          const r = await this.runTool(u.name, u.input, task, state);
          results.push({ type: 'tool_result', tool_use_id: u.id, content: r.content as any, ...(r.is_error ? { is_error: true } : {}) });
          this.log(`  ${task.id} · ${u.name}${u.name === 'done' ? ' ✓' : ''} ${short(u.input)}`);
        } catch (e) {
          const msg = (e as Error).message;
          if (u.name === 'done') {
            stat.rounds++;
            this.log(`  ${task.id} · done ✗ (round ${stat.rounds}/${this.maxRounds}) ${msg.split('\n')[0]}`);
            if (stat.rounds > this.maxRounds) throw new StepFailed(task.id, `done rejected ${stat.rounds}x, last: ${msg}`, finish());
            results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true,
              content: `REJECTED by independent replay: ${msg}\nYour working page is unchanged (still after your own actions). Fix only what is wrong and call done again.` });
          } else {
            this.log(`  ${task.id} · ${u.name} ✗ ${msg.split('\n')[0]}`);
            results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: `error: ${msg.split('\n').slice(0, 3).join(' ')}` });
          }
        }
      }
      messages.push({ role: 'user', content: results });
      if (state.done) {
        finish();
        this.log(`[explorer] ${task.id} ok · ${stat.tool_calls} tool calls · ${stat.rounds} rejected done · in ${usage.input_tokens}+${usage.cache_read_input_tokens}c out ${usage.output_tokens} · $${stat.usd}`);
        return { ...state.done, usage: stat };
      }
    }
  }
}

function short(v: unknown): string {
  const s = JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 137) + '…' : s;
}
