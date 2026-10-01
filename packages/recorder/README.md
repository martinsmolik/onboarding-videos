# @svp/recorder

Deterministic, LLM-free Playwright replay of `recipe.json` → `raw.webm` (launch + recordVideo) or `raw.mp4` (CDP screencast) + `timing.json` + `shots/*.png`.

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

More flags (all optional):

```
--cdp auto|<http://127.0.0.1:9110>|<ws://…>   attach to a RUNNING, logged-in browser (BrowserOS neo) – CDP screencast capture
--session-file out/session.json              Playwright storageState for a Playwright-launched Chromium (fallback auth)
--capture video|screencast                   launch-mode capture (default video = the original recordVideo + beacon path)
--run-id <id>                                value for {{RUN_ID}} (default local YYYYMMDDHHmmss; lowercased, [a-z0-9] only)
--keep-frames                                keep the screencast JPEGs + frames.ffconcat in <out>/.frames
--cdp-check [auto|<endpoint>] [--json]       discovery only: endpoint, browser version, page targets, Playwright attach test
```

## CDP mode (`--cdp`) – record inside Martin's BrowserOS neo

The PoC runs on a Mac where BrowserOS neo is already logged in to pre-prod (Sloneek keeps auth in `localStorage`
`sloneek-access-token` / `sloneek-refresh-token`, no cookies). Instead of copying tokens, the recorder attaches to
that browser:

1. `chromium.connectOverCDP(endpoint)` and take the existing **default context** (= the logged-in profile).
2. `context.newPage()` – a **new tab**; existing tabs are never touched (not even listed through Playwright pages).
3. The cursor overlay is added with `page.addInitScript` to **this page only**, without the beacon strip.
4. `Emulation.setDeviceMetricsOverride({width, height, deviceScaleFactor: 1, mobile: false})` sizes the tab to the
   recipe viewport regardless of the real window size or Retina scale (verified: a 1280×800 window yields
   1920×1080 frames).
5. Same step/pacing engine as before (`replaySteps`), then `Emulation.clearDeviceMetricsOverride`, close the tab,
   disconnect (`browser.close()` on a CDP connection only disconnects – the browser keeps running). SIGINT/SIGTERM
   also close the tab.

Output: `raw.mp4` (H.264, CFR 30 fps, exactly viewport size), `timing.json` with `sync_source: "screencast"`,
`beacon_strip_px: 0`, `capture: "screencast"`, `browser_mode: "cdp"`.

### Screencast capture and the time base

* `Page.startScreencast({format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1})`; every
  `Page.screencastFrame` is acked immediately, the JPEG is written to `.frames/fNNNNNN.jpg` together with
  `metadata.timestamp` (seconds, browser clock = frame swap time).
* Frames arrive **only on repaint**. Idle gaps are therefore not missing video: the video is built with the ffmpeg
  **concat demuxer** where each frame lasts `next.ts − ts` (`option framerate 1000` gives a 1 ms time base instead of
  image2's 40 ms) and the last frame is held until the recording end (it is listed twice because the concat demuxer
  drops the final entry's duration). `-fps_mode cfr -r 30` resamples that VFR timeline to CFR 30 fps,
  `-t` = exact length. Result: **video t = frame.ts − t0**, t0 = first frame timestamp.
* Step times are taken with `Date.now()`. They are mapped into the screencast clock with
  `offset = min over frames (receipt wall time − frame.ts)` – the smallest observed delivery latency, so any constant
  difference between the Node clock and the browser clock cancels out – and then `t_video = (wall/1000 − offset − t0)·1000`.
  The recorder waits for the first frame before `t = 0` (if none arrives in 4 s it nudges a repaint, then fails with
  "is the browser window visible?").
* Sanity numbers in the log: delivery latency min/spread, and video length vs wall timeline (cloud test: +4 ms over 38.8 s).

**Measured (cloud, headful Chromium 141 on Xvfb, demo app, CDP attach, 1280×800 window → 1920×1080):**
first changed frame vs `t_actions_end_ms`: s02 page switch +92 ms, s03 form +47 ms, s06 toast −79 ms (frame quantum
33 ms; the toast has no animation, so the −79 ms is the click's CDP round-trip returning after the browser already
painted). Narration onset in `final.mp4` vs `intro + t_start_ms`: +5 ms on all 6 steps. mux keeps the frame exactly
(75 frames = 2.5 s intro offset, ±1 frame). For comparison the beacon path corrected up to 732 ms of drift in the
same smoke run.

### Endpoint discovery (`--cdp auto`)

In order (`src/cdp.ts`):

1. env `CDP_URL` (`http://host:port`, `ws://…` or a bare port).
2. `DevToolsActivePort` (line 1 port, line 2 ws path) in `~/Library/Application Support/{BrowserClaw, BrowserOS,
   BrowserOS neo, …}` – written by Chromium when started with `--remote-debugging-port`.
3. `Local State` pref `browseros.server.cdp_port` in the same dirs – the port BrowserOS's managed CDP server actually
   bound to (it moves to the next free port when the default is busy and persists the choice).
4. Port probe `http://127.0.0.1:{9110, 9100, 9222, 9229, 9000…9003}/json/version` (Node inspectors are rejected).

`pnpm --filter @svp/recorder start -- --cdp-check auto` prints the result and the open page titles (URLs without
query strings, so tokens never reach the terminal).

### BrowserOS neo and CDP – findings (verified in source, 2026-10-01)

* **neo always runs its own CDP server on `127.0.0.1:9110`** – no flag needed. BrowserOS (classic) uses 9100.
  `kDefaultCDPPort = 9110` under `BUILDFLAG(BROWSEROS_PRODUCT_BROWSERCLAW)`, else 9100
  ([browseros_server_prefs.h](https://github.com/browseros-ai/BrowserOS/blob/main/packages/browseros/chromium_patches/chrome/browser/browseros/server/browseros_server_prefs.h)).
  It is started with `content::DevToolsAgentHost::StartRemoteDebuggingServer(…)` bound to 127.0.0.1 / ::1, i.e. the
  standard DevTools HTTP + WebSocket endpoint (`/json/version`, `/json/list`) that Playwright's `connectOverCDP` speaks;
  it passes an empty output dir, so **no `DevToolsActivePort` file** is written
  ([browseros_server_manager.cc](https://github.com/browseros-ai/BrowserOS/blob/main/packages/browseros/chromium_patches/chrome/browser/browseros/server/browseros_server_manager.cc)).
* If 9110 is taken, `FindAvailablePort` picks another one and saves it in Local State as `browseros.server.cdp_port`
  (same file) – discovery step 3 reads it. A fixed port can be forced with `--browseros-cdp-port=<n>`
  ([browseros_switches.h](https://github.com/browseros-ai/BrowserOS/blob/main/packages/browseros/chromium_patches/chrome/browser/browseros/core/browseros_switches.h)).
* `--remote-debugging-port` also works, but then neo **skips its managed CDP server** ("--remote-debugging-port takes
  precedence"), which its own MCP sidecar expects – prefer `--browseros-cdp-port`.
* neo's product id is "browserclaw": the macOS profile root is **`~/Library/Application Support/BrowserClaw`**
  (`browseros_product_dir_name = "BrowserClaw"` → `CrProductDirName`,
  [buildflags.gni](https://github.com/browseros-ai/BrowserOS/blob/main/packages/browseros/chromium_patches/chrome/browser/browseros/buildflags.gni));
  the app bundle is **`BrowserOS neo.app`** (Homebrew cask `browseros-neo`: `app "BrowserOS neo.app"`, zap
  `~/Library/Application Support/BrowserClaw`,
  [Casks/browseros-neo.rb](https://github.com/browseros-ai/homebrew-tap/blob/main/Casks/browseros-neo.rb)). neo's own
  session data lives in `~/.browserclaw/` ([README](https://github.com/browseros-ai/BrowserOS#readme)). The public docs
  (docs.browseros.com) describe only the MCP endpoint, not CDP.
* Relaunch with a fixed port (only if `--cdp auto` finds nothing): `open --args` is ignored while the app runs, so quit first:

  ```bash
  osascript -e 'quit app "BrowserOS neo"'; sleep 2
  open -a "BrowserOS neo" --args --browseros-cdp-port=9110
  curl -s http://127.0.0.1:9110/json/version
  ```

Not verified on a real Mac (the cloud has no BrowserOS): whether neo's tab-grouping / agent cockpit reacts to a tab
opened over raw CDP, and screencast behaviour when the neo window is on another Space (frames may stop – keep the
window visible during recording).

## Fallback auth (`--session-file`)

If CDP is not available: Martin copies the two localStorage keys from the logged-in tab into a Playwright
storageState (`scripts/grab-session.md`: DevTools snippet → clipboard → `pbpaste > out/session.json`), and the
recorder launches its own Chromium with `storageState` = that file. Only counts are logged (origins, number of keys,
cookies) – never values. In `pnpm local` this mode records with the screencast capture too
(`--capture screencast`); plain `--session-file` on the recorder CLI keeps the original recordVideo + beacon capture.
`out/session.json` is git-ignored.

## Placeholders

Substituted right before replay in every action `value` / `selector`, `expect.visible` / `expect.url_contains` and
`start.url` (narration is never touched; `recipe.json` is never rewritten):

| placeholder | value | example (today Thu 2026-10-01) |
|---|---|---|
| `{{RUN_ID}}` | unique per recording, lowercase `[a-z0-9]` (local `YYYYMMDDHHmmss`, or `--run-id` / env `RUN_ID`, sanitized) | `video.demo+{{RUN_ID}}@example.com` → `video.demo+20261001143005@example.com` |
| `{{ENV:NAME}}` | `process.env.NAME` (also from `.env`); unset = hard error naming the variable, values never logged | |
| `{{DAY:+Nd}}` | day-of-month of today + N days; Saturday/Sunday move forward to the next Monday | `{{DAY:+2d}}` (Sat 3) → `5` |
| `{{DAY:+Nd+M}}` | that start day + M **calendar** days (end of a range) | `{{DAY:+2d+2}}` → `7` (Wed) |
| `{{DATE:+Nd:FMT}}`, `{{DATE:+Nd+M:FMT}}` | same dates, formatted; tokens `YYYY MM M DD D` | `{{DATE:+2d+2:MM/DD/YYYY}}` → `10/07/2026` |

"today" is read once per run, so all placeholders of one recording agree. Unknown `{{…}}` tokens are an error
(they would otherwise be typed literally). `timing.json` gets `run_id` and `placeholder_dates` (DAY/DATE only).
The log prints every resolved date with its weekday and warns when it is not in the current month (date pickers
that open on the current month would pick the wrong cell). Holidays are not skipped, and only the start day skips
weekends – `pnpm local:check` warns when any resolved date is a Saturday/Sunday.

For `recipes/absence-request.en.json` (picks days 26/28 by number and expects `10/26/2026 - 10/28/2026, 3 Days`)
the selectors become `…:text-is("{{DAY:+Nd}}")` / `…:text-is("{{DAY:+Nd+2}}")` and the expect
`…:text-is("{{DATE:+Nd:MM/DD/YYYY}} - {{DATE:+Nd+2:MM/DD/YYYY}}, 3 Days")`; choose N so the start is a Monday in
the current month (the recipe itself is left to the explorer/Claude).

Programmatic:

```ts
import { run } from '@svp/recorder';   // packages/recorder/src/index.ts
const { timing, videoPath } = await run({ recipe: 'out/x/recipe.json', out: 'out/x', durations: 'out/x/audio/durations.json' });
```

Env: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (Chromium already installed, on this cloud box browsers are preinstalled (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1); on a Mac run `pnpm run setup` which installs Chromium). `SLONEEK_DEMO_USER` / `SLONEEK_DEMO_PASS` trigger the login hook (see below).

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
* `beacon_strip_px` (extra field, currently `8`): `raw.webm` is `viewport.width × (viewport.height + 8)`. The bottom
  8 rows are an opaque strip holding the sync beacon; the assembler crops them (`crop=W:H:0:0`). Missing/`0` in an
  old timing.json = raw video is exactly the viewport, nothing to crop.
* `audio_ms` is the value the recorder paced against (real duration or estimate).
* `sync_source` (extra field): `"beacon"` = timestamps re-anchored to true video frames (normal case),
  `"wall"` = raw wall-clock offsets (fallback when beacon detection failed – expect up to ~1 s drift on long videos).

**Why the beacon:** Playwright's video writer emits `max(1, round(25·Δt))` frames per screencast frame, so video
time drifts from wall time whenever the page repaints faster than 25 fps (measured: +0.5 s over a 36 s recording).
The cursor overlay draws a 6×6 px square in the bottom-left corner of an opaque 8 px strip that lives *below* the
recipe viewport (the browser context is `viewport.height + 8` tall, see "Beacon strip"); its colour flips at every step
start (grey → black → white → black …). After recording, the recorder scans that square in `raw.webm` with ffmpeg and
rewrites `t_start_ms` of each step to the exact frame where the flip appeared; the other timestamps of the step are
shifted by the same delta. Measured residual error between `t_actions_end_ms` and the visible UI change: 40–150 ms.
The same reason is why the overlay animates at ~24 fps (alternating 2/3 vsync ticks) and why this mode keeps the old
typing defaults (80 ms/char, `speed: "fast"` 40 ms; the screencast defaults are 35/15 ms) – measured on the smoke recipe,
40 ms/char adds ~120–150 ms of in-step drift per typing step vs 80 ms. Do not change those to "smoother" values without
re-measuring drift. An explicit `delay_ms` is always honoured. CDP screencast mode has no such limit.

### Beacon strip (why raw.webm is 1920×1088)

The recipe viewport is the *content* size. The recorder opens the browser context 8 px taller
(`BEACON_STRIP_PX` in `cursor.ts`) and records at that size (e.g. 1920×1088). An opaque, `position:fixed`, max-z-index
strip covers those bottom 8 rows and holds the 6×6 beacon at its bottom-left. Page content lays out in the full 1088 px
and may extend under the strip; nothing of the strip reaches `final.mp4` because the assembler crops to
`timing.beacon_strip_px`. Screenshots in `shots/` are clipped to the content viewport as well. Beacon detection is
unchanged (still `crop=6:6:0:ih-6` on the raw video) and was verified on the demo recipe: 6/6 transitions found,
wall→video corrections +59…+538 ms.

## Cursor overlay

Headless Chromium videos never show the OS cursor, so a DOM overlay is injected on every page
(`context.addInitScript`, re-positioned after each navigation): a 28 px SVG arrow with a subtle drop shadow,
`position:fixed; pointer-events:none; z-index:2147483647`. Before every move/click the overlay (and the beacon strip)
are re-appended as the last children of `<body>`, so a modal or toast appended later with the same max z-index can never
cover the cursor.

* `click` / `hover` / `type` / `select`: element is scrolled into view, its centre computed, the overlay glides
  there with ease-in-out over 600–900 ms (distance based) while the real mouse (`page.mouse.move`) follows the same
  path in 12 steps (so `:hover` styles react); a 420 ms expanding ring (56 px, blue outline + soft fill) marks the
  click – ≈ 10 frames at 25 fps, verified visible in `final.mp4`.
* `highlight`: 2 s outline pulse on the element.
* `scroll`: `down` / `up` = 400 px wheel; a selector (in `value` or `selector`) = smooth `scrollIntoView`.
* `type`: clicks the field first, optional `clear`, then per-char typing: `delay_ms`, else `speed: "fast"` = 15 ms,
  else 35 ms (the brief: typing must be quick). recordVideo + beacon mode keeps 80 / 40 ms (see "Why the beacon").
* `fill`: cursor glides to the field and clicks, then the whole `value` appears at once (`locator.fill` = native value
  setter + `input` event, then a `change` event; works with React/Angular inputs). Use it for anything longer than a few words.
* `zoom`: smooth zoom on `selector` – `value` = scale (default `"1.6"`), `hold_ms` = time fully zoomed (default 2500);
  total = 400 ms in + hold + 400 ms out (cubic ease-in-out). Details in "Zoom" below.
* `select`: native `<select>` popups are not rendered in the video, so the option is set directly
  (`selectOption` by label, falling back to value) after the cursor arrives.
* `navigate`, `press`, `wait` as expected. Every action honors `before_ms` (default 300).

Failed actions or `expect` (5 s) mark the step `failed` (with `error`), take the screenshot anyway and continue with
the next step; `--strict` aborts instead. A failed step is the self-heal signal for the explorer, not a crash, so the
process exits 0 (exit 1 only on a real error, e.g. invalid recipe).

## Zoom

Implemented in the overlay (`__svpCursor.zoom`, `src/cursor.ts`) as a CSS `transform: scale(s)` on
`document.documentElement`, animated from JS: every animation frame in CDP screencast mode (smooth), on the shared
~24 fps cadence in recordVideo + beacon mode (keeps video time = wall time). Geometry (`zoomFit` in `src/index.ts`):

* scale = `min(value, 0.96·viewport / element size)` – a full-width card cannot be zoomed 1.6× (log line
  `zoom …: scale 1.6 -> 1.12 …`); zoom a smaller element instead.
* origin = element centre, moved only as far as needed to keep the zoomed element inside the viewport (2 % margin), so
  a left-menu item zooms "to the right" instead of being cut off.
* cursor: if it is not already on the element it glides to the element centre first. During the zoom it stays at
  normal size (counter-scaled by 1/s around its hot spot) and sits on the zoomed content point it pointed at.
* a transform on `<html>` makes `<html>` the containing block of `position:fixed` elements; the overlay compensates
  for its own cursor and the beacon strip (the beacon never moves, sync detection is unaffected – verified 7/7).
  The **app's own fixed elements shift during the zoom only when the document itself is scrolled** (`window.scrollY > 0`;
  logged). SPAs that scroll inside a container (Sloneek, demo app) are unaffected.
* viewport scrollbars that would appear because of the scaled page are suppressed for the zoom; existing ones stay.
* `<html>` inline styles are restored afterwards; a failed zoom resets instantly.

`timing.json` gets per step `zooms: [{selector, scale, origin:[x,y], t_start_ms, t_full_ms, t_release_ms, t_end_ms}]`
in video time (shifted with the step in both sync modes).

## Parts (`step.part`, `part_title`)

The recorder only logs them: every timing step gets the **effective** `part` / `part_title` (a step without `part`
inherits the previous one). Interstitial cards and chapters are made by the assembler. `narration_tts` (default
narration) is the text whose length the standalone estimate uses; `subtitle` is ignored here.

## Login hook

`src/login.ts` runs only when `SLONEEK_DEMO_USER` and `SLONEEK_DEMO_PASS` are set **and** `start.url` is not
localhost, and only when no `start.storage_state` file is used. It contains a generic best-guess form fill
(`input[type=email]`, `input[type=password]`, `button[type=submit]`) marked `TODO(sloneek)` – replace with the real
selectors, or better, record a storageState once and point `recipe.start.storage_state` at it.

## Video quality and upgrade path

Playwright's built-in recorder is JPEG screencast → VP8 (`-crf 8 -b:v 1M -deadline realtime`) at 25 fps: soft text,
no control over bitrate, and the frame-timing quirk described above. For the hackathon 1920×1080 from the recipe
viewport is acceptable. To upgrade later without touching the recipe contract:

1. **Xvfb + ffmpeg x11grab** – run headed Chromium on a virtual display and capture with
   `ffmpeg -f x11grab -framerate 30 -video_size 1920x1080 -i :99 -c:v libx264 -crf 18 -preset veryfast`.
   Real wall-clock timing (no drift), sharp text, any bitrate. The OS cursor becomes visible as well.
2. **CDP screencast** – implemented: `--cdp` always, `--capture screencast` in launch mode (see "CDP mode").

## Known limits

* 25 fps VP8 with soft text (see above).
* The beacon strip is visible in `raw.webm` (bottom 8 rows); only the assembler's crop removes it. Anything the app
  renders in its bottom 8 px (e.g. a `bottom:0` sticky bar) sits under the strip and is cropped too.
* `t = 0` is defined as the first video frame; the first ~50–100 ms of the video is the blank page before `start.url`
  loads (page is created before `goto` so the screencast starts immediately).
* Only the first matching element of a selector is used (`locator(...).first()`), 10 s locator timeout.
* Native `<select>`, `<input type=date>` pickers and file dialogs are not visible in the video.
* No retry logic inside the recorder – re-run the whole recipe (recording is cheap).
