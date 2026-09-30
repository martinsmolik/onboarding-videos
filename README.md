# Sloneek onboarding video pipeline (hackathon)

End-to-end generation of onboarding videos for the Sloneek portal (hosted on YouTube).

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

## Local dev without Sloneek credentials

`pnpm demo` serves `demo-app/index.html` on :4173 – a stand-in HR app with `data-testid`s. `samples/recipe.absence-request.json` runs against it. Voice provider `mock` generates a spoken-tempo silent/tone track with realistic duration (≈ 14 chars/s for Czech) so the whole pipeline runs offline.

## Env

Copy `.env.example` → `.env`. Never commit `.env`.
