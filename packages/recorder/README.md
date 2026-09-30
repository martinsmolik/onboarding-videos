# @svp/recorder

Deterministic, LLM-free Playwright replay of `recipe.json` → `raw.webm` + `timing.json` + `shots/*.png`.

```
in : recipe.json, audio/durations.json (optional)
out: out/<id>/raw.webm, out/<id>/timing.json, out/<id>/shots/sNN.png
```

## Usage

```bash
# local demo (stand-in app on :4173)
pnpm demo &
pnpm --filter @svp/recorder start -- --recipe samples/recipe.absence-request.json --out out/absence-request

# with real narration lengths from the assembler
pnpm --filter @svp/recorder start -- --recipe out/absence-request/recipe.json \
  --out out/absence-request --durations out/absence-request/audio/durations.json

# flags
#   --durations <file>   audio/durations.json ({ "s01": 4210, ... } ms). Default: <out>/audio/durations.json if it exists.
#   --headed             show the browser (video is still recorded)
#   --strict             abort on the first failed step (remaining steps -> status "skipped")
```

Relative paths are resolved against the directory `pnpm` was invoked from (repo root), not the package dir.

Programmatic:

```ts
import { run } from '@svp/recorder';   // packages/recorder/src/index.ts
const { timing, videoPath } = await run({ recipe: 'out/x/recipe.json', out: 'out/x', durations: 'out/x/audio/durations.json' });
```

Env: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (Chromium already installed, never run `playwright install`). `SLONEEK_DEMO_USER` / `SLONEEK_DEMO_PASS` trigger the login hook (see below).

## How pacing works

Narration is synthesized *before* recording, so the recorder knows how long each step must be shown.
For every step:

```
t_start        = now                       (beacon flipped, narration starts here)
run actions    (each action: sleep(before_ms ?? 300) then act)
t_actions_end  = now
check expect   (5 s timeout) -> status ok | failed
screenshot     -> shots/<id>.png
wait until     now - t_start >= max(audio_ms, min_duration_ms ?? 0)
sleep          hold_after_ms ?? 800
t_end          = now
```

So each step lasts `max(actions_duration, audio_ms, min_duration_ms) + hold_after_ms`. If the actions take
longer than the narration, the step simply runs longer (audio finishes early, video keeps going). If the
narration is longer, the last frame is held until the narration ends. A step with empty narration has
`audio_ms = 0`. After the last step the recorder holds 1000 ms, then closes the context (that finalizes the webm).

Standalone mode: if no durations file is given/found, `audio_ms` is estimated from narration length
(Czech ≈ 14 chars/s, min 1500 ms), so the recorder produces a plausibly paced video without the assembler.

### Timeline and what `t_start_ms` means (for the assembler)

* All times in `timing.json` are **milliseconds from the first video frame** (`t = 0` = first frame of `raw.webm`).
* `t_start_ms` of step N is the video time at which narration `sNN.mp3` must start. It is also the moment the
  recorder started that step's actions (the cursor begins moving ≥ 300 ms later because of `before_ms`).
* `t_end_ms` of step N == `t_start_ms` of step N+1 (contiguous; no gaps). The last step's `t_end_ms` is
  `total_ms - ~1000` (tail hold).
* `t_actions_end_ms` is when the last action finished (before `expect` / pacing wait). Useful for placing
  callouts or for cutting a "just the action" clip.
* `total_ms` comes from `ffprobe` on the actual webm, `fps` from its stream (25).
* `audio_ms` is the value the recorder paced against (real duration or estimate).
* `sync_source` (extra field): `"beacon"` = timestamps re-anchored to true video frames (normal case),
  `"wall"` = raw wall-clock offsets (fallback when beacon detection failed – expect up to ~1 s drift on long videos).

**Why the beacon:** Playwright's video writer emits `max(1, round(25·Δt))` frames per screencast frame, so video
time drifts from wall time whenever the page repaints faster than 25 fps (measured: +0.5 s over a 36 s recording).
The cursor overlay draws a 6×6 px square in the bottom-left corner whose colour flips at every step start
(grey → black → white → black …). After recording, the recorder scans that square in `raw.webm` with ffmpeg and
rewrites `t_start_ms` of each step to the exact frame where the flip appeared; the other timestamps of the step are
shifted by the same delta. Measured residual error between `t_actions_end_ms` and the visible UI change: 40–150 ms.
The same reason is why the overlay animates at ~24 fps (alternating 2/3 vsync ticks) and the default typing delay is
80 ms (2 frames) instead of 60 ms – do not change those to "smoother" values without re-measuring drift.

## Cursor overlay

Headless Chromium videos never show the OS cursor, so a DOM overlay is injected on every page
(`context.addInitScript`, re-positioned after each navigation): a 24 px SVG arrow with a drop shadow,
`position:fixed; pointer-events:none; z-index:2147483647`.

* `click` / `hover` / `type` / `select`: element is scrolled into view, its centre computed, the overlay glides
  there with ease-in-out over 600–900 ms (distance based) while the real mouse (`page.mouse.move`) follows the same
  path in 12 steps (so `:hover` styles react); a 300 ms expanding ring marks the click.
* `highlight`: 2 s outline pulse on the element.
* `scroll`: `down` / `up` = 400 px wheel; a selector (in `value` or `selector`) = smooth `scrollIntoView`.
* `type`: clicks the field first, optional `clear`, then per-char typing (`delay_ms`, default 80).
* `select`: native `<select>` popups are not rendered in the video, so the option is set directly
  (`selectOption` by label, falling back to value) after the cursor arrives.
* `navigate`, `press`, `wait` as expected. Every action honors `before_ms` (default 300).

Failed actions or `expect` (5 s) mark the step `failed` (with `error`), take the screenshot anyway and continue with
the next step; `--strict` aborts instead. A failed step is the self-heal signal for the explorer, not a crash, so the
process exits 0 (exit 1 only on a real error, e.g. invalid recipe).

## Login hook

`src/login.ts` runs only when `SLONEEK_DEMO_USER` and `SLONEEK_DEMO_PASS` are set **and** `start.url` is not
localhost, and only when no `start.storage_state` file is used. It contains a generic best-guess form fill
(`input[type=email]`, `input[type=password]`, `button[type=submit]`) marked `TODO(sloneek)` – replace with the real
selectors, or better, record a storageState once and point `recipe.start.storage_state` at it.

## Video quality and upgrade path (not implemented)

Playwright's built-in recorder is JPEG screencast → VP8 (`-crf 8 -b:v 1M -deadline realtime`) at 25 fps: soft text,
no control over bitrate, and the frame-timing quirk described above. For the hackathon 1920×1080 from the recipe
viewport is acceptable. To upgrade later without touching the recipe contract:

1. **Xvfb + ffmpeg x11grab** – run headed Chromium on a virtual display and capture with
   `ffmpeg -f x11grab -framerate 30 -video_size 1920x1080 -i :99 -c:v libx264 -crf 18 -preset veryfast`.
   Real wall-clock timing (no drift), sharp text, any bitrate. The OS cursor becomes visible as well.
2. **CDP screencast** – `Page.startScreencast` via `context.newCDPSession(page)`, pipe frames with their
   `metadata.timestamp` into ffmpeg using `-use_wallclock_as_timestamps` / `-vsync vfr`, encode to H.264. Keeps the
   headless setup; gives correct timestamps and PNG-quality frames.

In both cases keep the beacon scan – it makes sync independent of the capture method.

## Known limits

* 25 fps VP8 with soft text (see above).
* The 6×6 px beacon square is visible in `raw.webm` in the bottom-left corner. The assembler may crop 6 px or
  overlay a bar there; at 1080p it is barely noticeable.
* `t = 0` is defined as the first video frame; the first ~50–100 ms of the video is the blank page before `start.url`
  loads (page is created before `goto` so the screencast starts immediately).
* Only the first matching element of a selector is used (`locator(...).first()`), 10 s locator timeout.
* Native `<select>`, `<input type=date>` pickers and file dialogs are not visible in the video.
* No retry logic inside the recorder – re-run the whole recipe (recording is cheap).
