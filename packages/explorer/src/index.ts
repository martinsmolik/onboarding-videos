import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { AnthropicModel, ScriptedModel, type ModelClient } from './model.ts';
import { Explorer, PrefixFailed, StepFailed, type AcceptedStep } from './explore.ts';
import { openFresh, type StartState } from './replay.ts';
import type { Recipe, RecipeStep, Scenario, StepUsage, Timing } from './types.ts';

export { takeSnapshot, describeMatches } from './snapshot.ts';
export { policyViolations } from './policy.ts';
export { Explorer } from './explore.ts';

export interface RunOptions {
  /** scenario.json (explore mode; optional in heal mode – intents are then taken from out/<id>/scenario.json or narration) */
  scenario?: string;
  /** out/<id> directory */
  out?: string;
  /** heal mode: path to out/<id>/timing.json */
  heal?: string;
  headed?: boolean;
  /** dry run with a scripted fake model; true = fixtures/<scenario id>.dry-run.json, string = fixture path */
  dryRun?: boolean | string;
  startUrl?: string;
  /** inject a model (tests) */
  model?: ModelClient;
  log?: (s: string) => void;
}

export interface RunResult { recipePath: string; recipe: Recipe; usage: StepUsage[]; healed?: string[] }

const VIEWPORT = { width: 1920, height: 1080 };
const DEMO_URL = 'http://localhost:4173/index.html';
const BASE = process.env.INIT_CWD || process.cwd(); // pnpm --filter runs in the package dir; resolve user paths from where the command was typed
const PKG_DIR = path.resolve(new URL('..', import.meta.url).pathname);
const abs = (p: string) => (path.isAbsolute(p) ? p : path.resolve(BASE, p));
const rel = (p: string) => path.relative(BASE, p) || '.';
const today = () => new Date().toISOString().slice(0, 10);
const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T;
const writeJson = (p: string, v: unknown) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

function recipeStepId(id: string, i: number): string {
  return /^s[0-9]{2,3}$/.test(id) ? id : `s${String(i + 1).padStart(2, '0')}`;
}

function pickModel(opts: RunOptions, scenarioId: string): ModelClient {
  if (opts.model) return opts.model;
  if (opts.dryRun) {
    const f = typeof opts.dryRun === 'string' ? abs(opts.dryRun) : path.join(PKG_DIR, 'fixtures', `${scenarioId}.dry-run.json`);
    return new ScriptedModel(f);
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set – set it, or run with --dry-run');
  return new AnthropicModel();
}

async function launch(headed?: boolean): Promise<Browser> {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';
  return chromium.launch({ headless: !headed });
}

const hasCreds = () => !!(process.env.SLONEEK_DEMO_URL && process.env.SLONEEK_DEMO_USER && process.env.SLONEEK_DEMO_PASS);

/**
 * "Step 0": let the model log in (credentials only as {{ENV}} placeholders), save
 * login-actions.json + storage-state.json, return the logged-in start state.
 */
async function login(browser: Browser, model: ModelClient, outDir: string, log: (s: string) => void): Promise<{ start: StartState; usage: StepUsage }> {
  const loginUrl = process.env.SLONEEK_DEMO_URL!;
  const ex = new Explorer(browser, { url: loginUrl, viewport: VIEWPORT }, model, { log });
  try {
    const r = await ex.exploreStep({
      id: 's00', scriptKey: 'login', narration: '',
      intent: 'Log in to the app. Type {{SLONEEK_DEMO_USER}} as the e-mail/username and {{SLONEEK_DEMO_PASS}} as the password (literally these placeholders), then submit the login form.',
      must_show: 'the logged-in application (main navigation / dashboard) is visible and the login form is gone',
    });
    const statePath = path.join(outDir, 'storage-state.json');
    await ex.current!.context.storageState({ path: statePath });
    const landing = ex.current!.page.url();
    writeJson(path.join(outDir, 'login-actions.json'), {
      url: loginUrl,
      actions: r.actions,
      expect: r.expect,
      landing_url: landing,
      note: 'Values like {{SLONEEK_DEMO_USER}} / {{SLONEEK_DEMO_PASS}} are env placeholders – substitute from env before replay. Prefer recipe.start.storage_state; use these actions only when it is missing or expired.',
      generated_at: new Date().toISOString(),
    });
    log(`[explorer] login ok → ${landing}; storage state ${rel(statePath)}`);
    return { start: { url: landing, storageState: statePath, viewport: VIEWPORT }, usage: r.usage };
  } finally {
    await ex.close();
  }
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? ((s: string) => console.error(s));
  return opts.heal ? heal(opts, log) : explore(opts, log);
}

// ------------------------------------------------------------------ explore
async function explore(opts: RunOptions, log: (s: string) => void): Promise<RunResult> {
  if (!opts.scenario) throw new Error('--scenario is required');
  const scenario = readJson<Scenario>(abs(opts.scenario));
  const outDir = abs(opts.out ?? `out/${scenario.id}`);
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(path.join(outDir, 'scenario.json'))) fs.copyFileSync(abs(opts.scenario), path.join(outDir, 'scenario.json'));
  const model = pickModel(opts, scenario.id);
  log(`[explorer] ${scenario.id}: ${scenario.steps.length} steps, model=${model.name}, out=${rel(outDir)}`);

  const browser = await launch(opts.headed);
  const usage: StepUsage[] = [];
  const steps: RecipeStep[] = [];
  let start: StartState = { url: opts.startUrl ?? scenario.start_url ?? process.env.SLONEEK_DEMO_URL ?? DEMO_URL, viewport: VIEWPORT };
  const recipePath = path.join(outDir, 'recipe.json');
  const prevVersion = fs.existsSync(recipePath) ? (readJson<Recipe>(recipePath).version ?? 0) : 0;
  const build = (): Recipe => ({
    id: scenario.id,
    version: prevVersion + 1,
    title: scenario.title,
    lang: scenario.lang,
    app_version: today(),
    viewport: VIEWPORT,
    start: { url: start.url, ...(start.storageState ? { storage_state: rel(start.storageState) } : {}) },
    voice: scenario.voice ?? { provider: 'elevenlabs' },
    steps,
  });
  try {
    if (hasCreds() && (!opts.dryRun || hasLoginScript(opts, scenario.id))) {
      const r = await login(browser, model, outDir, log);
      start = r.start;
      usage.push(r.usage);
    }
    const ex = new Explorer(browser, start, model, { log, context: { title: scenario.title, lang: scenario.lang, audience: scenario.audience } });
    for (let i = 0; i < scenario.steps.length; i++) {
      const s = scenario.steps[i];
      const id = recipeStepId(s.id, i);
      if (id !== s.id) log(`[explorer] scenario step id "${s.id}" → recipe id "${id}"`);
      const r = await ex.exploreStep({ id, scriptKey: s.id, narration: s.narration, intent: s.intent, must_show: s.must_show });
      usage.push(r.usage);
      ex.accepted.push({ id, intent: s.intent, actions: r.actions, expect: r.expect });
      steps.push({ id, narration: s.narration, actions: r.actions, hold_after_ms: 800, ...(r.expect ? { expect: r.expect } : {}) });
      writeJson(path.join(outDir, 'explorer-log.json'), { mode: 'explore', model: model.name, usage, total_usd: total(usage) });
    }
    await ex.close();
    const recipe = build();
    writeJson(recipePath, recipe);
    log(`[explorer] wrote ${rel(recipePath)} v${recipe.version} · total $${total(usage)}`);
    return { recipePath, recipe, usage };
  } catch (e) {
    if (e instanceof StepFailed && e.usage) usage.push(e.usage);
    writeJson(path.join(outDir, 'recipe.partial.json'), build());
    writeJson(path.join(outDir, 'explorer-log.json'), { mode: 'explore', model: model.name, usage, total_usd: total(usage), error: (e as Error).message });
    throw e;
  } finally {
    await browser.close();
  }
}

function hasLoginScript(opts: RunOptions, id: string): boolean {
  try {
    const f = typeof opts.dryRun === 'string' ? abs(opts.dryRun) : path.join(PKG_DIR, 'fixtures', `${id}.dry-run.json`);
    return !!readJson<{ steps: Record<string, unknown> }>(f).steps.login;
  } catch { return false; }
}

const total = (u: StepUsage[]) => Number(u.reduce((a, b) => a + b.usd, 0).toFixed(4));

// ------------------------------------------------------------------ heal
async function heal(opts: RunOptions, log: (s: string) => void): Promise<RunResult> {
  const timingPath = abs(opts.heal!);
  const timing = readJson<Timing>(timingPath);
  const outDir = opts.out ? abs(opts.out) : path.dirname(timingPath);
  const recipePath = path.join(outDir, 'recipe.json');
  const recipe = readJson<Recipe>(recipePath);
  const scenPath = opts.scenario ? abs(opts.scenario) : path.join(outDir, 'scenario.json');
  const scenario = fs.existsSync(scenPath) ? readJson<Scenario>(scenPath) : null;
  const intentOf = (id: string, i: number) => {
    const s = scenario?.steps.find((x, k) => recipeStepId(x.id, k) === id) ?? scenario?.steps[i];
    return { intent: s?.intent ?? recipe.steps[i].narration, must_show: s?.must_show, scriptKey: s?.id ?? id };
  };

  const failedIdx = timing.steps.filter((s) => s.status === 'failed')
    .map((s) => ({ t: s, i: recipe.steps.findIndex((r) => r.id === s.id) }))
    .filter((x) => { if (x.i < 0) log(`[explorer] timing step ${x.t.id} not in recipe – ignored`); return x.i >= 0; })
    .sort((a, b) => a.i - b.i);
  if (!failedIdx.length) {
    log('[explorer] heal: no failed steps in timing.json – nothing to do');
    return { recipePath, recipe, usage: [], healed: [] };
  }
  const model = pickModel(opts, recipe.id);
  const browser = await launch(opts.headed);
  const usage: StepUsage[] = [];
  const healed: string[] = [];
  try {
    let storage = recipe.start.storage_state ? resolveStorage(recipe.start.storage_state, outDir) : undefined;
    let start: StartState = { url: recipe.start.url, storageState: storage, viewport: recipe.viewport ?? VIEWPORT };
    if (recipe.start.storage_state && !storage) {
      if (!hasCreds()) throw new Error(`storage state ${recipe.start.storage_state} missing and no SLONEEK_DEMO_* creds to re-login`);
      const r = await login(browser, model, outDir, log);
      usage.push(r.usage);
      start = { ...start, storageState: r.start.storageState };
    }

    const queue = failedIdx.map((x) => ({ i: x.i, error: x.t.error ?? 'failed (no error message)', screenshot: x.t.screenshot }));
    while (queue.length) {
      const job = queue[0];
      const ex = new Explorer(browser, start, model, { log, context: { title: recipe.title ?? recipe.id, lang: recipe.lang, audience: scenario?.audience ?? 'admin' } });
      ex.accepted = recipe.steps.slice(0, job.i).map((s, k): AcceptedStep => ({ id: s.id, intent: intentOf(s.id, k).intent, actions: s.actions, expect: s.expect }));
      try {
        await ex.resetCurrent(); // deterministic replay (no LLM) up to the failed step
      } catch (e) {
        if (e instanceof PrefixFailed) {
          // an earlier step is broken too (the recorder may have got lucky) – heal it first
          log(`[explorer] heal: earlier step ${recipe.steps[e.index].id} fails on replay → healing it first`);
          queue.unshift({ i: e.index, error: e.message, screenshot: undefined });
          await ex.close();
          continue;
        }
        throw e;
      }
      const step = recipe.steps[job.i];
      const meta = intentOf(step.id, job.i);
      log(`[explorer] heal ${step.id}: ${job.error.split('\n')[0]}`);
      const r = await ex.exploreStep({
        id: step.id, scriptKey: meta.scriptKey, narration: step.narration, intent: meta.intent, must_show: meta.must_show,
        healContext: [
          'This step used to work but FAILED during the last deterministic recording. The app UI has probably changed.',
          `Previous actions: ${JSON.stringify(step.actions)}`,
          `Previous expect: ${JSON.stringify(step.expect ?? null)}`,
          `Recorder error: ${job.error}`,
          job.screenshot ? `(recorder screenshot at failure: ${job.screenshot})` : '',
          'Achieve the same intent in the current UI. Reuse previous selectors only if they still resolve to exactly one element.',
        ].filter(Boolean).join('\n'),
      });
      await ex.close();
      usage.push(r.usage);
      recipe.steps[job.i] = { ...step, actions: r.actions, ...(r.expect ? { expect: r.expect } : {}) };
      if (!r.expect) delete recipe.steps[job.i].expect;
      healed.push(step.id);
      queue.shift();
      // drop duplicate jobs for the same step
      for (let k = queue.length - 1; k >= 0; k--) if (queue[k].i === job.i) queue.splice(k, 1);
    }
    recipe.version = (recipe.version ?? 0) + 1;
    recipe.app_version = today();
    if (start.storageState) recipe.start.storage_state = rel(start.storageState);
    writeJson(recipePath, recipe);
    writeJson(path.join(outDir, 'explorer-log.json'), { mode: 'heal', model: model.name, healed, usage, total_usd: total(usage) });
    log(`[explorer] healed ${healed.join(', ')} → ${rel(recipePath)} v${recipe.version} · $${total(usage)}`);
    return { recipePath, recipe, usage, healed };
  } finally {
    await browser.close();
  }
}

function resolveStorage(p: string, outDir: string): string | undefined {
  for (const c of [abs(p), path.join(outDir, path.basename(p))]) if (fs.existsSync(c)) return c;
  return undefined;
}

// expose for tests
export { openFresh };
