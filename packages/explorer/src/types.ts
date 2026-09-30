// Local copies of the contracts (contracts/*.schema.json). Duplicated on purpose:
// packages must stay independent.

export type ActionType =
  | 'navigate' | 'click' | 'hover' | 'type' | 'press' | 'select' | 'scroll' | 'wait' | 'highlight';

export interface Action {
  type: ActionType;
  selector?: string;
  value?: string;
  clear?: boolean;
  delay_ms?: number;
  before_ms?: number;
}

export interface Expect {
  visible?: string;
  url_contains?: string;
}

export interface RecipeStep {
  id: string;
  narration: string;
  actions: Action[];
  hold_after_ms?: number;
  min_duration_ms?: number;
  expect?: Expect;
}

export interface Recipe {
  id: string;
  version: number;
  title?: string;
  lang: 'cs' | 'en' | 'sk';
  app_version?: string;
  viewport: { width: number; height: number };
  start: { url: string; storage_state?: string };
  voice?: { provider?: 'elevenlabs' | 'mock'; voice_id?: string; model_id?: string };
  steps: RecipeStep[];
}

export interface ScenarioStep {
  id: string;
  narration: string;
  intent: string;
  must_show?: string;
}

export interface Scenario {
  id: string;
  lang: 'cs' | 'en' | 'sk';
  title: string;
  audience: 'admin' | 'manager' | 'employee';
  source?: Record<string, unknown>;
  /** not in the contract, optional: where the video starts (else --start-url / SLONEEK_DEMO_URL / demo app) */
  start_url?: string;
  /** not in the contract, optional: copied to recipe.voice */
  voice?: Recipe['voice'];
  steps: ScenarioStep[];
}

export interface TimingStep {
  id: string;
  t_start_ms: number;
  t_end_ms: number;
  status: 'ok' | 'failed' | 'skipped';
  error?: string;
  screenshot?: string;
}

export interface Timing {
  recipe_id: string;
  steps: TimingStep[];
}

export interface StepUsage {
  step: string;
  calls: number;
  tool_calls: number;
  rounds: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  usd: number;
}
