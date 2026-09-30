// Mirrors contracts/recipe.schema.json and contracts/timing.schema.json.
// Kept local on purpose – packages must not share code.

export type ActionType =
  | 'navigate' | 'click' | 'hover' | 'type' | 'press'
  | 'select' | 'scroll' | 'wait' | 'highlight';

export interface Action {
  type: ActionType;
  selector?: string;
  value?: string;
  clear?: boolean;
  delay_ms?: number;
  before_ms?: number;
}

export interface Step {
  id: string;
  narration: string;
  actions: Action[];
  hold_after_ms?: number;
  min_duration_ms?: number;
  expect?: { visible?: string; url_contains?: string };
}

export interface Recipe {
  id: string;
  version: number;
  title?: string;
  lang: 'cs' | 'en' | 'sk';
  app_version?: string;
  viewport: { width: number; height: number };
  start: { url: string; storage_state?: string };
  voice?: { provider?: string; voice_id?: string; model_id?: string };
  steps: Step[];
}

export type StepStatus = 'ok' | 'failed' | 'skipped';

export interface TimingStep {
  id: string;
  t_start_ms: number;
  t_actions_end_ms: number;
  t_end_ms: number;
  audio_ms: number;
  status: StepStatus;
  error?: string;
  screenshot?: string;
}

export interface Timing {
  recipe_id: string;
  video_path: string;
  fps: number;
  total_ms: number;
  recorded_at: string;
  /** 'beacon' = step times re-anchored to true video frames; 'wall' = raw Date.now() offsets (fallback) */
  sync_source: 'beacon' | 'wall';
  steps: TimingStep[];
}

export interface RunOptions {
  recipe: string;            // path to recipe.json
  out: string;               // output dir, e.g. out/<id>
  durations?: string;        // path to audio/durations.json (optional)
  headed?: boolean;
  strict?: boolean;          // abort on first failed step
  log?: (line: string) => void;
}

export interface RunResult {
  timing: Timing;
  timingPath: string;
  videoPath: string;
}
