# @svp/assembler

Audio-first narration + final assembly. Two stages, both plain file-in/file-out (see root README for the folder layout).

```
pnpm --filter @svp/assembler start -- tts --recipe <recipe.json> --out out/<id> [--provider elevenlabs|mock]
pnpm --filter @svp/assembler start -- mux --out out/<id> [--subtitles burn|sidecar|none] [--bgm <file> --bgm-volume 0.08]
```

Relative paths are resolved against the directory you typed the command in (`INIT_CWD`), not the package dir. `.env` is auto-loaded from the cwd / repo root.

Programmatic: `import { tts, mux } from "@svp/assembler"` (`tts({recipe, out, provider?})` -> `{durations,...}`, `mux({out, subtitles?, bgm?, bgmVolume?})` -> `{finalPath, srtPath, totalMs, warnings,...}`).

## tts

Per step with non-empty narration -> `audio/<id>.mp3`, `audio/alignment/<id>.json`, sidecars `<id>.txt` (narration) and `<id>.meta.json` (provider/voice/model). A step is skipped (cache hit) only when mp3 + alignment exist, the `.txt` equals the current narration AND the meta matches, so switching mock <-> elevenlabs or voice re-synthesizes. Silent steps get `0` in `durations.json` and any stale audio is removed.

Provider default: `elevenlabs` if `ELEVENLABS_API_KEY` is set, else `mock`. Mock = quiet 220 Hz sine, `max(1500, chars/14*1000)` ms, linear char alignment.

### durations.json <-> recorder contract

`audio/durations.json` = `{ "s01": 5956, ... }`, integer ms, **always measured with ffprobe on the actual mp3** (never estimated), `0` for silent steps. The recorder reads it, holds each step for `max(actions, duration) + hold_after`, and writes `t_start_ms` (+ `audio_ms`) per step to `timing.json`. `mux` places each mp3 at exactly `t_start_ms`. Therefore: **re-run `tts` -> then record -> then `mux`**. If the narration changes after recording, mux warns (`audio_ms` in timing.json differs from the mp3).

## mux filter graph

```
[k:a] aformat=44100,stereo, adelay=T|T      (one per step mp3, T = t_start_ms, both channels)
[bgm] (-stream_loop -1) volume=0.08          (optional)
all -> amix=inputs=N:normalize=0:duration=longest   (plain sum: no 1/N attenuation; narrations don't overlap so no clipping)
    -> apad=whole_dur=<total> -> atrim=0:<total> -> alimiter=0.95 (safety)   => [aout]
video re-encoded libx264 crf20 yuv420p 30fps, aac 160k, -t total_ms (from timing.json), faststart
```
Subtitles: `final.srt` is always written unless `none`; `burn` adds the libass `subtitles=` filter (DejaVu Sans, FontSize 22, Outline 1, MarginV 40; libass scales these from its 384x288 default PlayRes, so they're resolution independent).

Cues: built from the alignment of each step, <= 42 chars, split on sentence end, then commas, then balanced word wrap; start = `t_start_ms + char_start(first)`, end = `t_start_ms + char_end(last)`; overlaps trimmed.

Warnings (printed + returned in `warnings`): `DRIFT` (t_start+audio > total+200), `OVERLAP` between narrations, step `failed`/`skipped`, stale `durations.json` vs mp3, recorder `audio_ms` mismatch.

## ElevenLabs notes

Endpoint (verified against docs): `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128`, header `xi-api-key`, JSON body `{text, model_id}` (+ optional `voice_settings`, `language_code`, `seed`, `previous_text`/`next_text`, `apply_text_normalization`). **`output_format` is a query param, not a body field.** Response: `{ audio_base64, alignment:{characters[],character_start_times_seconds[],character_end_times_seconds[]}, normalized_alignment:{...same} }`. We use `alignment` (1:1 with the input text). 429/5xx/network errors retried 3x (1s, 2s, 4s). `ELEVENLABS_BASE_URL` overrides the host (for tests).

- Model: default `eleven_multilingual_v2` (best-quality Czech; supports cs). `eleven_flash_v2_5` is ~half the price and faster but noticeably less natural; override with `ELEVENLABS_MODEL_ID` or `recipe.voice.model_id`.
- Voice: `recipe.voice.voice_id` or `ELEVENLABS_VOICE_ID`. Pick one Czech-capable voice and keep it fixed across all videos (consistency > variety). Default stability/similarity are fine for narration; raise stability (~0.6) if delivery varies between steps.
- Cost: billed per character (multilingual_v2 = 1 credit/char; flash = 0.5). The sample video is ~410 chars; a typical 2-minute video is ~1,500-2,000 chars = ~2k credits, i.e. roughly $0.3-0.6 on Creator-tier overage pricing. Caching means only edited steps are re-billed.
- Per-step synthesis means prosody resets at each step; acceptable since steps are one idea each.
