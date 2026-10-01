# @svp/assembler

Audio-first narration + final assembly. Two stages, both plain file-in/file-out (see root README for the folder layout).

```
pnpm --filter @svp/assembler start -- tts --recipe <recipe.json> --out out/<id> [--provider external|elevenlabs|say|espeak|mock]
pnpm --filter @svp/assembler start -- manifest --recipe <recipe.json> --out out/<id>      # voiceover to-do list only (external)
pnpm --filter @svp/assembler start -- mux --out out/<id> [--subtitles burn|sidecar|none] [--bgm <file> --bgm-volume 0.08] [--intro on|off] [--outro on|off]
      [--intro-image thumb.png [--intro-sec 3]] [--outro-image end.png [--outro-sec 3]] [--no-interstitials] [--no-chapters]
      [--cdp auto|<url>] [--card-renderer auto|drawtext|cdp|chromium|chrome|msedge|none]
pnpm --filter @svp/assembler start -- cards-check [--cdp auto|<url>] [--json]   # drawtext? else which PNG card renderer works (renders a test card)
```

ffmpeg / ffprobe: env `FFMPEG_PATH` / `FFPROBE_PATH` (ffprobe defaults to the one next to `FFMPEG_PATH`) > Homebrew
`ffmpeg-full` keg (`/opt/homebrew/opt/ffmpeg-full/bin`, `/usr/local/opt/…`; keg-only, used automatically when installed) >
PATH. Every ffmpeg/ffprobe call of this package goes through `run()` in `src/util.ts`, so this applies to tts, external and mux.

## Text roles (recipe step)

| field | used for | default |
|---|---|---|
| `narration` | base text | – |
| `narration_tts` | what is **spoken**: sent to TTS / listed as `tts_text` in the external manifest, cache key (`audio/<id>.txt`), stale-clip detection | `narration` |
| `subtitle` | what the viewer **reads** in `final.srt` (`""` = no cue for the step) | `narration` |

Example: `"narration": "Hlavní KPI docházky."`, `"narration_tts": "Hlavní kej pí áj docházky."` → the voice says
"kej pí áj", the subtitle shows "KPI". Cue timing always comes from the alignment of the spoken text; when the two texts
differ, subtitle characters are mapped onto it with an LCS alignment (identical words 1:1, differing spans interpolated),
so a cue still ends where its words are spoken. A subtitle-only edit never invalidates audio.

Relative paths are resolved against the directory you typed the command in (`INIT_CWD`), not the package dir. `.env` is auto-loaded from the cwd / repo root.

Programmatic: `import { tts, mux } from "@svp/assembler"` (`tts({recipe, out, provider?})` -> `{durations,...}`, `mux({out, subtitles?, bgm?, bgmVolume?, intro?, outro?, introImage?, outroImage?, introImageSec?, outroImageSec?, interstitials?, chapters?, cdp?, cardRenderer?})` -> `{finalPath, srtPath, totalMs, introMs, outroMs, cards, failedSteps, interstitials, stepOffsetMs, chaptersPath, chapters, warnings,...}`).

## tts

Per step with a non-empty spoken text (`narration_tts ?? narration`) -> `audio/<id>.mp3`, `audio/alignment/<id>.json`, sidecars `<id>.txt` (the spoken text) and `<id>.meta.json` (provider/voice/model). A step is skipped (cache hit) only when mp3 + alignment exist, the `.txt` equals the current spoken text AND the meta matches, so switching mock <-> elevenlabs or voice re-synthesizes. Silent steps get `0` in `durations.json` and any stale audio is removed.

Provider choice (`chooseProvider` in `src/tts.ts`):

1. `--provider` wins (and must be usable here, otherwise an error).
2. `recipe.voice.provider: "external"` is always honoured – no fallback, missing files are an error, never a robot voice.
3. `recipe.voice.provider` `elevenlabs` / `say` / `espeak` when usable here, else auto with a log note. (`mock` in a recipe is not a request.)
4. Auto: `elevenlabs` (`ELEVENLABS_API_KEY` set) → `say` (macOS) → `espeak` (espeak-ng on PATH) → `mock` (silent tone, log line).

### provider `external` (voiceover made outside the pipeline – Claude + ElevenLabs connector)

The assembler never synthesizes. `tts` (and `manifest`) first writes **`audio/manifest.json`** – the to-do list:

```json
{ "recipe_id": "absence-request", "provider": "external", "audio_dir": "/…/out/absence-request/audio",
  "format": "mp3, 44.1 kHz (ElevenLabs output_format mp3_44100_128); .wav/.m4a accepted and transcoded",
  "voice": { "voice_id": null, "model_id": "eleven_multilingual_v2" }, "instructions": "…",
  "steps": [ { "id": "s01", "tts_text": "In this video, …", "subtitle": "In this video, …", "narration": "(= tts_text, deprecated alias)",
               "file": "s01.mp3", "path": "/…/audio/s01.mp3", "alignment_file": "alignment/s01.json", "chars": 87, "status": "missing" } ],
  "silent_steps": [], "missing": ["s01", "…"], "total_chars": 789 }
```

Voice **`tts_text`** only (`narration_tts ?? narration`); `subtitle` is listed for orientation. `chars` counts `tts_text`.
`status`: `present` | `missing` | `stale` (`tts_text` changed since the file was accepted and the file is not newer) |
`foreign` (the mp3 was synthesized by another provider of this pipeline and not replaced since – never accepted as
external audio). `pnpm voice:manifest <recipe> --id <id>` (root script) writes just this file + the empty
`audio/` and `audio/alignment/` dirs.

Then, for every narrated step:

* `audio/<id>.mp3` is required; `.wav` / `.m4a` are accepted too (the newest of the three wins) and transcoded to
  44.1 kHz mp3 (`libmp3lame 192k`). If any step has no usable file, `tts` fails with the list of missing files
  (+ narration) and the manifest path – nothing is half-written.
* Durations are measured with ffprobe → `audio/durations.json` (silent steps `0`, their stale files removed).
* Alignment for SRT: a supplied `audio/alignment/<id>.json` in ElevenLabs with-timestamps format (the bare
  `{characters, character_start_times_seconds, character_end_times_seconds}` or the whole response with an
  `alignment` key – normalised to the bare form) is kept; otherwise a linear alignment over the measured duration is
  written. A supplied file is recognised by being newer than the step's bookkeeping, so a re-generated alignment is
  picked up and our own linear one is re-derived each run. Warns if it ends > 1.5 s away from the audio length.
* Bookkeeping per step: `<id>.txt` (`tts_text` it was accepted for), `<id>.meta.json` (`{provider:"external", source, alignment}`).

- `espeak` (offline, real speech): `espeak-ng -v <cs|en|sk> -s 150 -f <textfile> -w tmp.wav` -> ffmpeg -> 44.1 kHz mono mp3 (`highshelf -4 dB @ 4 kHz` + `dynaudnorm` to tame the buzz). Voice comes from `recipe.lang`. Narration is passed through a temp file, never through a shell. No per-char timestamps, so the alignment is linear over the *measured* mp3 duration (SRT cues still land inside the spoken window). Measured: Czech ≈ 11 chars/s at 150 wpm (mock assumes 14), mean level ≈ -22 dBFS.
- `mock` (silent-ish tone): quiet 220 Hz sine, `max(1500, chars/14*1000)` ms, linear char alignment.
- Cache meta includes the provider (`{provider:"espeak", voice, wpm}`), so switching providers re-synthesizes.

### durations.json <-> recorder contract

`audio/durations.json` = `{ "s01": 5956, ... }`, integer ms, **always measured with ffprobe on the actual mp3** (never estimated), `0` for silent steps. The recorder reads it, holds each step for `max(actions, duration) + hold_after`, and writes `t_start_ms` (+ `audio_ms`) per step to `timing.json`. `mux` places each mp3 at exactly `t_start_ms`. Therefore: **re-run `tts` -> then record -> then `mux`**. If the narration changes after recording, mux warns (`audio_ms` in timing.json differs from the mp3).

## mux filter graph

```
[0:v] crop=W:H:0:0 (only if timing.beacon_strip_px > 0; H = raw height - strip), fps=30, yuv420p, setsar=1  => [vmain]
      (+ fade-in 0.3 s when intro on, fade-out 0.3 s when outro on)
intro: color=BRAND_BG:WxH:30fps:2.5s, drawtext(title, DejaVu Sans Bold) + accent bar + drawtext("Sloneek · onboarding"), fade in/out 0.4 s => [vintro]
outro: same, 2.0 s, "sloneek.com"                                                                                  => [voutro]
[vintro][vmain][voutro] concat=n=3:v=1:a=0  (all segments identical WxH / 30 fps / yuv420p / sar 1)              => [vcat]
[k:a] aformat=44100,stereo, adelay=T|T      (one per step mp3, T = t_start_ms + intro_ms, both channels)
[bgm] (-stream_loop -1) volume=0.08          (optional)
all -> amix=inputs=N:normalize=0:duration=longest   (plain sum: no 1/N attenuation; narrations don't overlap so no clipping)
    -> apad=whole_dur=<total> -> atrim=0:<total> -> alimiter=0.95 (safety)   => [aout]
video re-encoded libx264 crf20 yuv420p 30fps, aac 160k, -t (intro + total_ms + outro), faststart
```

### Parts: interstitial cards and chapters

`step.part` (int) + `part_title` – set on the first step of each part (brief: 1 Úvod, 2 Nastavení, 3 Ukázka využití,
4 Pohled manažera/zaměstnance, 5 Závěr); later steps inherit the part. Wherever the effective part changes between two
(non-skipped) steps:

* **Interstitial** (`recipe.interstitials`, default `true`; `--no-interstitials` wins): the recording is split at the
  step's `t_start_ms` (snapped to the 30 fps grid, `trim=start_frame/end_frame`, exact) and a 1.5 s card
  (`INTERSTITIAL_MS`) "`<part> / <part_title>`" + accent bar + `recipe.title` is concatenated in between (brand colours,
  same font as the intro, 0.25 s fades, silent). No card before the very first step (the intro covers it).
  Shift: final time = recording time + intro + 1.5 s × (cards at or before the step) – applied to `adelay`, SRT cues and
  burned subtitles; `MuxResult.stepOffsetMs` lists it per step. `timing.json` is never rewritten.
* **Chapters** (`recipe.chapters`, default `true`; `--no-chapters`): `out/<id>/chapters.txt`, YouTube format –
  `0:00 <first part title>` then `M:SS <part_title>` at each card start in `final.mp4` time (floored to the second, so a
  click lands just before the card). Missing `part_title` → "Část N". Written only when the recipe has parts. Warns when
  YouTube would ignore the list (< 3 chapters, or one shorter than 10 s). Paste it into the video description.

### Intro / outro images (thumbnails)

`--intro-image <png|jpg>` / `--outro-image <png|jpg>` show a still instead of the generated card for `--intro-sec` /
`--outro-sec` seconds (default 3, whole frames). Scaled to fit and letterboxed in `BRAND_BG`. The intro image is the
very first frame (no fade from black – good for YouTube previews), 0.3 s fade into the recording; the outro image fades
in. An image wins over `--no-intro` / `--no-outro`; every shift uses the image length.

### Cards without `drawtext` (Homebrew core ffmpeg)

`ffmpeg -hide_banner -filters` is checked once per binary (`ffmpegCaps`, `src/util.ts`). With `drawtext` nothing changes.
Without it (Homebrew's core `ffmpeg` formula 8.x/9.x is built without libfreetype, libass, fontconfig – `ffmpeg-full` has them):

* every text card (intro, outro, each interstitial) is drawn on a Chromium `<canvas>` (`src/cards.ts`) with the same
  geometry as `cardFilter` (title 6.6 % / 5.8 % of height, 25 % line spacing, block raised 4.5 % when there is a subtitle,
  accent bar 4 % wide at 55 %, subtitle 2.8 % at 85 %), the same colours and the same font file (`fontFile()` embedded via
  `FontFace`; system stack Inter → Helvetica Neue → Arial when none is found) → `out/<id>/.card-<key>.png` (removed after);
* each PNG becomes a segment via `-loop 1 -framerate 30 -t <ms> -i card.png` → `scale,fps=30,format=yuv420p,setsar=1,trim,fade in/out`
  – same length, fps, pixel format, SAR, fades and (silent) audio as the drawtext card, so `concat`, `adelay` offsets,
  SRT and `chapters.txt` are identical (verified by test: same durations/chapters, frames close to the drawtext ones);
* renderer order (`--card-renderer auto`): **cdp** – a temporary tab in an already running browser (`--cdp <url>|auto`,
  env `SVP_CARD_CDP`; `pnpm local` passes the endpoint the recorder found, i.e. BrowserOS neo; the tab is closed and the
  browser only disconnected) → **chromium** – Playwright's bundled build (`chromium.launch()`; headless uses
  `chromium_headless_shell-<rev>`, which exists only after `playwright install chromium`) → **chrome** – channel `chrome`,
  the user's installed Google Chrome, no download → **msedge**. Canvas output does not depend on tab visibility or the
  display's pixel ratio. Playwright is not a dependency of this package; it is resolved from here, then the sibling
  recorder package, then the repo root;
* none works → cards are **skipped** with a `CARDS DISABLED` warning (intro/outro/interstitials off; `introMs`/offsets 0,
  `chapters.txt` in the shorter timeline, so it still matches `final.mp4`). `--intro-image` / `--outro-image` stills need
  no text and keep working;
* `--subtitles burn` needs the `subtitles` filter (libass) – without it mux warns and writes the sidecar `final.srt` only.

`MuxResult.cards` = `drawtext` | `png:<renderer>` | `none` | `off` (no text card wanted). `--card-renderer <name>` forces
one path (`drawtext` errors when the filter is missing). `SVP_FORCE_NO_DRAWTEXT=1` pretends the filter is missing (tests).

### Failed steps

A step with `status: "failed"` in `timing.json` keeps its audio; mux still writes `final.mp4` and ends with a
`!!! N step(s) FAILED in timing.json: <ids>` banner (also in `warnings`, `MuxResult.failedSteps`). Re-record before publishing.

### Intro / outro cards

On by default when `recipe.json` (in `out/<id>/`) has a `title`; force with `--intro on|off`, `--outro on|off` (also `--no-intro`, `--no-outro`; outro defaults to the intro setting). Intro = 2.5 s (`INTRO_MS`), outro = 2.0 s (`OUTRO_MS`). Colours via env `BRAND_BG` (default `#1f2a44`) and `BRAND_FG` (default `#ffffff`). Title is word-wrapped to <= 34 chars/line (max 3 lines). Text is passed to `drawtext` through temp files in `out/` (`.card-*.txt`, removed afterwards), so titles with `:`/`'`/`%` need no escaping. Font: env `BRAND_FONT` / `BRAND_FONT_BOLD` (ttf/otf path) > Inter (`Inter-Bold.ttf` / `Inter-Regular.ttf` in
`/usr/share/fonts/truetype/inter`, `/usr/local/share/fonts`, `/Library/Fonts`, `~/Library/Fonts`) >
`/usr/share/fonts/truetype/dejavu/DejaVuSans(-Bold).ttf` > fontconfig `font=DejaVu Sans`. All of them cover Czech diacritics.

**Everything downstream of the recording shifts by `intro_ms`:** audio `adelay` offsets, SRT cue times, burned subtitles (applied after `concat`). `timing.json` stays in recording time – it is never rewritten. `MuxResult.introMs` reports the shift. With both cards off the output is byte-for-byte the old pipeline (plus the strip crop).

### Beacon strip crop

CDP screencast recordings (`raw.mp4`, `sync_source: "screencast"`, `beacon_strip_px: 0`) need no crop; the raw file is always taken from `timing.video_path`. The recorder (launch + recordVideo) records `viewport.height + timing.beacon_strip_px` rows (currently 8) and puts the sync beacon in the extra strip. mux crops it (`crop=W:H:0:0`) before anything else. `beacon_strip_px` absent or `0` (old timings) = no crop. A warning is printed if the cropped size differs from `recipe.viewport`.

Subtitles: `final.srt` is always written unless `none`; `burn` adds the libass `subtitles=` filter (DejaVu Sans, FontSize 22, Outline 1, MarginV 40; libass scales these from its 384x288 default PlayRes, so they're resolution independent).

Cues: built from the step's **subtitle text** (`subtitle ?? narration`, read from `out/<id>/recipe.json`; without a recipe the spoken text in `audio/<id>.txt`) and the alignment of the spoken text, <= 42 chars, split on sentence end, then commas, then balanced word wrap; start = `offset + t_start_ms + char_start(first)`, end = `offset + t_start_ms + char_end(last)` with `offset` = intro + cards before the step; overlaps trimmed.

Warnings (printed + returned in `warnings`): `DRIFT` (t_start+audio > total+200), `OVERLAP` between narrations, step `failed`/`skipped`, stale `durations.json` vs mp3, recorder `audio_ms` mismatch.

## ElevenLabs notes

Endpoint (verified against docs): `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128`, header `xi-api-key`, JSON body `{text, model_id}` (+ optional `voice_settings`, `language_code`, `seed`, `previous_text`/`next_text`, `apply_text_normalization`). **`output_format` is a query param, not a body field.** Response: `{ audio_base64, alignment:{characters[],character_start_times_seconds[],character_end_times_seconds[]}, normalized_alignment:{...same} }`. We use `alignment` (1:1 with the input text). 429/5xx/network errors retried 3x (1s, 2s, 4s). `ELEVENLABS_BASE_URL` overrides the host (for tests).

- Model: default `eleven_multilingual_v2` (best-quality Czech; supports cs). `eleven_flash_v2_5` is ~half the price and faster but noticeably less natural; override with `ELEVENLABS_MODEL_ID` or `recipe.voice.model_id`.
- Voice: `recipe.voice.voice_id` or `ELEVENLABS_VOICE_ID`. Pick one Czech-capable voice and keep it fixed across all videos (consistency > variety). Default stability/similarity are fine for narration; raise stability (~0.6) if delivery varies between steps.
- Cost: billed per character (multilingual_v2 = 1 credit/char; flash = 0.5). The sample video is ~410 chars; a typical 2-minute video is ~1,500-2,000 chars = ~2k credits, i.e. roughly $0.3-0.6 on Creator-tier overage pricing. Caching means only edited steps are re-billed.
- Per-step synthesis means prosody resets at each step; acceptable since steps are one idea each.
