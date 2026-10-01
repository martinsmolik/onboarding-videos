// Mirrors contracts/recipe.schema.json and contracts/timing.schema.json.
// Kept local on purpose – packages must not share code.

export type ActionType =
  | 'navigate' | 'click' | 'hover' | 'type' | 'fill' | 'press'
  | 'select' | 'scroll' | 'wait' | 'highlight' | 'zoom';

export interface Action {
  type: ActionType;
  selector?: string;
  value?: string;
  clear?: boolean;
  delay_ms?: number;
  /** type: 'fast' = 15 ms per char (default 35) */
  speed?: 'normal' | 'fast';
  /** zoom: time fully zoomed in (default 2500) */
  hold_ms?: number;
  before_ms?: number;
}

export interface Step {
  id: string;
  narration: string;
  /** text for the SRT (default narration) – assembler only */
  subtitle?: string;
  /** text sent to TTS (default narration) – the recorder estimates audio length from it */
  narration_tts?: string;
  /** video part; inherited by later steps without one */
  part?: number;
  part_title?: string;
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
  chapters?: boolean;
  interstitials?: boolean;
  steps: Step[];
}

export type StepStatus = 'ok' | 'failed' | 'skipped';

export interface ZoomWindow {
  selector?: string;
  /** scale actually used (clamped so the element stays inside the viewport) */
  scale: number;
  /** transform origin in viewport px (element centre, shifted so the zoomed element stays on screen) */
  origin?: [number, number];
  t_start_ms: number;   // zoom-in starts
  t_full_ms: number;    // fully zoomed in
  t_release_ms: number; // zoom-out starts
  t_end_ms: number;     // back at scale 1
}

export interface TimingStep {
  id: string;
  /** effective part (step.part or inherited); absent when the recipe has no parts */
  part?: number;
  part_title?: string;
  t_start_ms: number;
  t_actions_end_ms: number;
  t_end_ms: number;
  audio_ms: number;
  status: StepStatus;
  error?: string;
  screenshot?: string;
  zooms?: ZoomWindow[];
}

export interface Timing {
  recipe_id: string;
  video_path: string;
  fps: number;
  total_ms: number;
  recorded_at: string;
  /** 'beacon' = step times re-anchored to true video frames; 'wall' = raw Date.now() offsets (fallback);
   *  'screencast' = CDP screencast capture, video built from frame timestamps so video time == wall time by construction */
  sync_source: 'beacon' | 'wall' | 'screencast';
  /** Extra rows recorded BELOW the recipe viewport (raw.webm height = viewport.height + this). Holds the sync beacon; the assembler crops it away. Absent/0 in old timings = no crop. */
  beacon_strip_px: number;
  /** Value substituted for {{RUN_ID}} in the recipe (YYYYMMDDHHmmss unless overridden). */
  run_id?: string;
  /** Resolved {{DAY:...}} / {{DATE:...}} placeholders of this recording, e.g. {"{{DAY:+14d}}": "15"}. */
  placeholder_dates?: Record<string, string>;
  /** How the video was captured: 'video' = Playwright recordVideo (webm + beacon), 'screencast' = CDP Page.startScreencast (mp4). */
  capture?: 'video' | 'screencast';
  /** 'launch' = Playwright-launched Chromium, 'cdp' = attached to an already running browser (e.g. BrowserOS neo). */
  browser_mode?: 'launch' | 'cdp';
  steps: TimingStep[];
}

export interface RunOptions {
  recipe: string;            // path to recipe.json
  out: string;               // output dir, e.g. out/<id>
  durations?: string;        // path to audio/durations.json (optional)
  headed?: boolean;
  strict?: boolean;          // abort on first failed step
  /** Attach to a running browser over CDP: 'auto' (discovery) or an http(s)/ws(s) endpoint. Implies capture 'screencast'. */
  cdp?: string;
  /** Playwright storageState JSON used instead of recipe.start.storage_state (launch mode only). */
  sessionFile?: string;
  /** Capture method in launch mode. Default 'video' (recordVideo + beacon, the original path). CDP mode always uses 'screencast'. */
  capture?: 'video' | 'screencast';
  /** Override the {{RUN_ID}} value (default: local time YYYYMMDDHHmmss). Lowercased, only [a-z0-9] kept. */
  runId?: string;
  /** "today" for {{DAY:+Nd}} / {{DATE:...}} placeholders (tests; default now). */
  today?: Date;
  /** Keep the raw screencast JPEG frames in <out>/.frames (debugging). */
  keepFrames?: boolean;
  log?: (line: string) => void;
}

export interface RunResult {
  timing: Timing;
  timingPath: string;
  videoPath: string;
}
