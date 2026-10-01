# Sloneek onboarding video pipeline (hackathon)

End-to-end generation of onboarding videos for the Sloneek portal (hosted on YouTube).

**Without a terminal:** colleagues run it on claude.ai/code with the `/onboarding-video` skill, see [docs/CLAUDE-CLOUD.md](docs/CLAUDE-CLOUD.md).

## Core design decisions (do not violate)

1. **Never record with an LLM in the loop.** Discovery (slow, agentic) and recording (deterministic Playwright replay) are separate phases joined by `recipe.json`.
2. **Audio first, video adapts.** Narration is synthesized per step *before* recording. The recorder holds each step for `max(actions_duration, audio_duration) + hold_after`. Sync is by construction.
3. **Everything is a file.** Contracts in `contracts/`. Stages communicate only through files in `out/<recipe_id>/`. Any stage can be rerun alone.
4. **Recording is cheap, so retries are cheap.** Failed step ⇒ `status: failed` in timing.json ⇒ explorer self-heals that step ⇒ re-record.

## Pipeline

```
old video / release notes ─▶ knowledge ─▶ scenario.json ─▶ explorer ─▶ recipe.json
                                                                          │
                                        ┌─────────────────────────────────┘
                                        ▼
                     assembler tts  ─▶ out/<id>/audio/sNN.mp3 + durations.json
                                        ▼
                     recorder       ─▶ out/<id>/raw.webm + timing.json (+ screenshots)
                                        ▼
                     assembler mux  ─▶ out/<id>/final.mp4 + final.srt
                                        ▼
                     orchestrator   ─▶ YouTube (unlisted) + state record
```

## Output folder layout (`out/<recipe_id>/`)

```
scenario.json          (knowledge)
recipe.json            (explorer)  – or copied from samples/
audio/s01.mp3 ...      (assembler tts)
audio/durations.json   (assembler tts)  { "s01": 4210, "s02": 2980, ... }  ms
audio/alignment/*.json (assembler tts)  ElevenLabs char timestamps, for SRT
raw.webm               (recorder)
timing.json            (recorder)
shots/s01.png ...      (recorder)
final.mp4, final.srt   (assembler mux)
chapters.txt           (assembler mux, only when the recipe has parts)
state.json             (orchestrator)
```

## Packages

| package | owner | in | out |
|---|---|---|---|
| `packages/recorder` | agent A | recipe.json, audio/durations.json | raw.webm, timing.json, shots/ |
| `packages/assembler` | agent B | recipe.json (tts) / raw.webm+timing.json (mux) | audio/*, final.mp4, final.srt |
| `packages/explorer` | agent C | scenario.json (+ failed steps from timing.json) | recipe.json |
| `packages/knowledge` | agent D | YouTube URL / Linear | scenario.json |
| `packages/orchestrator` | agent E | recipe id | runs stages, uploads, state.json, n8n workflow |

Each package: TypeScript, `tsx` runtime, exposes a CLI (`pnpm --filter @svp/<name> start -- <args>`) and a programmatic `run()` export. Shared code must NOT be introduced between packages – keep them independent; duplicate 20 lines rather than couple.

## Settled contract rules (found during integration)

- **Run order:** `tts` → `record` → `mux`. The recorder paces against `audio/durations.json`, which must hold *real* mp3 durations (ffprobe), never estimates. Silent steps are `0`, not omitted.
- **Time base:** `timing.json` is in *video* time (t=0 = first frame of raw.webm). The recorder corrects wall-clock drift with a 6 px sync beacon in the bottom-left corner of an 8 px strip below the content (`sync_source: "beacon"`, `beacon_strip_px: 8`; mux crops the strip). Steps are contiguous: `t_end(N) == t_start(N+1)`. `final.mp4` time = recording time + intro card length (2.5 s by default).
- **CDP screencast mode** (`recorder --cdp`, `pnpm local`): recording attaches to a running, logged-in browser (BrowserOS neo on Martin's Mac), writes `raw.mp4` built from `Page.screencastFrame` timestamps (`sync_source: "screencast"`, `beacon_strip_px: 0`) – video time equals the screencast clock by construction, no beacon. The launch + recordVideo + beacon path above is unchanged. Details: `packages/recorder/README.md`.
- **External voice:** `recipe.voice.provider: "external"` = mp3s are produced outside the pipeline (Claude via the ElevenLabs connector) into `out/<id>/audio/<stepId>.mp3`; `tts` only measures them and writes the to-do list `audio/manifest.json` (`pnpm voice:manifest`); voice its `tts_text` (= `narration_tts ?? narration`), never `subtitle`. Missing files fail `tts` with the list.
- **`:text-is("…")` in recipes** = the element's whole `textContent`, whitespace-normalised (explorer `resolve.js`). The recorder translates it to `locator(css).filter({ hasText: /^\s*…\s*$/ })`, because Playwright's native `:text-is` only matches the deepest element owning the text (`button:text-is("X")` misses `<button><span>X</span></button>`). Failed-step errors name the action: `action 3 click <selector>: …`.
- **Placeholders:** `{{RUN_ID}}`, `{{ENV:NAME}}`, `{{DAY:+Nd}}`, `{{DAY:+Nd+M}}`, `{{DATE:+Nd[+M]:FMT}}` are substituted by the recorder right before replay (never in narration).
- **Exit codes:** recorder exits 0 with failed steps (status lives in timing.json), 1 on crash. Orchestrator heals only when timing.json lists `failed` steps. mux never aborts on failed steps: it writes `final.mp4` and ends with a loud `!!! N step(s) FAILED in timing.json: …` banner (`MuxResult.failedSteps`); `pnpm local` then exits 2.
- **ffmpeg:** the assembler uses env `FFMPEG_PATH` / `FFPROBE_PATH` > Homebrew `ffmpeg-full` keg (`/opt/homebrew/opt/ffmpeg-full/bin`, keg-only, so never on PATH by itself) > `ffmpeg` on PATH. The recorder always uses `ffmpeg` from PATH (it needs no text filters).
- **Re-mux only:** `pnpm local <recipe> --id <id> --mux-only` (also `pnpm absence:mux`, `pnpm pilot:mux`) skips tts + record and re-runs mux on `out/<id>/raw.mp4` + `timing.json` + `audio/durations.json`; then opens `final.mp4` (`--no-open` to skip).
- **Heal:** `explorer --heal out/<id>/timing.json` rewrites `out/<id>/recipe.json` in place and bumps `version`. `tts` is cached per step (narration + provider + voice), so re-running after heal is cheap.
- **Knowledge** is four commands (`ingest` → `transcribe` → `changes` → `scenarize`); its result is `out/<id>/scenario.json` plus `scenario.review.md` for a 30-second human approval.
- **Ids:** `out/<id>` is the pipeline id; `recipe.id` may differ (it goes into the YouTube description). Keep them equal in practice.
- **Paths:** stages resolve relative paths against the directory pnpm was invoked from (`INIT_CWD`); the orchestrator always passes absolute paths.
- **Login on the real tenant:** explorer saves `out/<id>/storage-state.json` (+ `login-actions.json` with `{{SLONEEK_DEMO_USER}}` placeholders); recorder uses `recipe.start.storage_state`. Credentials only ever come from env.
- **Recipe v2 fields (brief „Kostra videonávodů“, all optional, old recipes unchanged):** step `part` (int, inherited by
  later steps) + `part_title` → 1.5 s interstitial card "`2 / Nastavení`" at every part change and `out/<id>/chapters.txt`
  (YouTube chapters in `final.mp4` time); top-level `interstitials` / `chapters` (default `true`). Step `narration_tts`
  (spoken; TTS, external manifest `tts_text`, cache + stale detection) and `subtitle` (shown in `final.srt`), both
  default `narration`. Actions `zoom` (`selector`, `value` scale default `"1.6"`, `hold_ms` default 2500) and `fill`
  (whole value at once); `type` defaults to 35 ms/char, `speed: "fast"` = 15 ms (CDP screencast; the recordVideo + beacon path keeps 80 / 40 ms). `timing.json` steps carry `part` /
  `part_title` and `zooms[]` (video time). Final time = recording time + intro + 1.5 s per card before the step.
  mux: `--no-interstitials`, `--no-chapters`, `--intro-image <png> [--intro-sec 3]`, `--outro-image <png> [--outro-sec 3]`
  (also via `pnpm local`). Sample: `samples/recipe.parts-demo.json` (demo app, 3 parts).
- **YouTube:** the API cannot replace a video's media. `--replace <oldId>` uploads a new video, sets the old one private and writes `out/video-map.json` – the portal has to swap the link. Uploads from unverified API projects are forced to *private*; flip to unlisted in Studio or get the project audited.

## Video look (recorder + assembler)

- **Parts.** Interstitial card per part change (1.5 s, brand colours, "`<part> / <part_title>`" + video title), `chapters.txt` for the YouTube description, thumbnails as intro/outro stills (`--intro-image` / `--outro-image`). Fonts: `BRAND_FONT[_BOLD]` > Inter (if installed) > DejaVu Sans.
- **Zoom.** `zoom` action = CSS scale on `<html>` (400 ms in, hold, 400 ms out), cursor stays normal size on the zoomed element, beacon unaffected. Origin = element centre, shifted only to keep the zoomed element on screen; scale clamped to fit. Details: `packages/recorder/README.md` → Zoom.
- **Intro / outro cards.** `assembler mux` wraps the recording in a 2.5 s title card (`recipe.title` + "Sloneek · onboarding") and a 2 s "sloneek.com" card, generated with ffmpeg `color` + `drawtext` (DejaVu Sans) and joined with `concat`.
- **ffmpeg without `drawtext`** (Homebrew core `ffmpeg` 8.x/9.x has no libfreetype / libass): mux renders the same cards as PNG stills on a Chromium `<canvas>` (same layout, sizes, colours, font file, Czech diacritics) and loops them with `-loop 1` (same length / 30 fps / yuv420p / fades / silence), so timeline and chapters are unchanged. Renderer order: a temporary tab of the running browser over CDP (BrowserOS neo – `pnpm local` passes the endpoint it found) → Playwright's Chromium (needs `playwright install chromium`) → installed Google Chrome → Edge. If none works, the cards are skipped with a `CARDS DISABLED` warning and `chapters.txt` follows the shorter timeline; `--intro-image` / `--outro-image` still work. `--subtitles burn` (libass) falls back to the sidecar `final.srt`. Proper fix: `brew install ffmpeg-full`. `pnpm local:check` says which path will be used. Test hook: `SVP_FORCE_NO_DRAWTEXT=1`. Default on when the recipe has a `title`; `--intro off` / `--outro off` to disable. Colours: env `BRAND_BG` (`#1f2a44`), `BRAND_FG` (`#ffffff`). All audio offsets and SRT cues are shifted by the intro length; `timing.json` stays in recording time.
- **Offline speech.** Without `ELEVENLABS_API_KEY` the tts default is now `espeak` (espeak-ng, voice from `recipe.lang`, 150 wpm, linear alignment over the measured mp3) – intelligible narration instead of a tone. `--provider mock` still gives the silent tone; `--provider elevenlabs` needs the key.
- **Beacon strip.** The recorder records 8 px taller than the recipe viewport (1920×1088 for 1920×1080) and keeps the sync beacon in that extra opaque strip; `timing.beacon_strip_px: 8` tells mux to `crop=W:H:0:0`. The beacon therefore never appears in `final.mp4`, and old timings without the field still work (no crop). The recipe viewport remains the content size.
- **Cursor.** 28 px arrow with a subtle shadow, always re-stacked above modals/toasts; 420 ms click ripple (visible for ~10 frames).

## Local dev without Sloneek credentials

`pnpm demo` serves `demo-app/index.html` on :4173 – a stand-in HR app with `data-testid`s. `samples/recipe.absence-request.json` runs against it. Voice provider `espeak` (default without an ElevenLabs key) produces real offline speech via espeak-ng; `mock` generates a spoken-tempo silent/tone track with realistic duration (≈ 14 chars/s for Czech).

## Env

Copy `.env.example` → `.env`. Never commit `.env`.
