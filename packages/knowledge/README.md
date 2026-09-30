# @svp/knowledge

Figures out what an existing onboarding video says, what changed in the app since, and produces a fresh `scenario.json` (contract: `contracts/scenario.schema.json`) for the explorer, plus a human review file.

```
YouTube URL ─ingest─▶ source/{meta.json, subs→transcript.*, audio.m4a}
                          │ (no subtitles) transcribe ─▶ source/transcript.{json,txt}
Linear ─changes─▶ source/changes.json (+ changes.meta.json)
product notes (.md) ───────────────┐
                                   ▼
                 scenarize (Claude, forced tool-use, ajv validation, 1 retry)
                                   ▼
            out/<id>/scenario.json  +  out/<id>/scenario.review.md
```

All stages talk through files in `out/<id>/` and can be rerun alone. `<id>` (the folder name) becomes `scenario.id`.

## CLI

```
pnpm --filter @svp/knowledge start -- ingest     --youtube <url> --out out/<id>
pnpm --filter @svp/knowledge start -- transcribe --out out/<id> [--provider elevenlabs|openai|local] [--language cs] [--force]
pnpm --filter @svp/knowledge start -- changes    --since 2026-01-01 --out out/<id> [--keywords "docházka,attendance,absence"]
pnpm --filter @svp/knowledge start -- scenarize  --out out/<id> --lang cs --audience employee [--title "..."] [--product-notes notes.md] [--fake-llm]
```

Programmatic: `import { ingest, transcribe, changes, scenarize, validateScenario, run } from "@svp/knowledge"`.

- **ingest**: `yt-dlp` metadata (`meta.json`: title, upload_date, description, ...), subtitles (`--write-sub --write-auto-sub --sub-lang cs,en`, VTT with auto-caption rolling-duplicates removed) -> `transcript.json/txt` directly, and audio -> `audio.m4a`. If subtitles exist, `transcribe` is a no-op (unless `--force`).
- **transcribe**: ElevenLabs Scribe (`POST /v1/speech-to-text`, multipart `model_id=scribe_v1`, `language_code`, `timestamps_granularity=word`, `file`; header `xi-api-key`), OpenAI `whisper-1` (`verbose_json`), or `local` (`faster-whisper` in python3; never installed automatically, model downloads on first use, `WHISPER_MODEL` default `small`). Output `[{start_ms,end_ms,text}]`.
- **changes**: Linear GraphQL, `issues(filter:{completedAt:{gt:since}})`, paginated (max 1000 issues), keyword filter applied client-side, accent-insensitive, over title/description/project/labels. No key or API error => empty list + warning (never fails).
- **scenarize**: model `claude-sonnet-4-5` (override `SCENARIST_MODEL` or `--model`-less env). Tool `submit_scenario` with `tool_choice` forced; its input schema is derived from the contract (+ 6–12 steps). Code then overwrites deterministic fields (`id`, `lang`, `audience`, `title` if given, step ids `s01..`, and `source.*` provenance) and validates with ajv (+ editorial rules). On failure the errors are sent back once; second failure throws. Soft lint (narration 8–25 words, missing `must_show`) goes to the review file. `--fake-llm` returns `test/fixture/scenario.fixture.json` through the same validation/review path (review file is marked FIXTURE).
- **review**: `scenario.review.md` = steps table (narration / intent / must_show), "What changed vs old video" (`source.changes_detected` + Linear issues considered), warnings, approval checklist.

## Env

| var | used by |
|---|---|
| `ANTHROPIC_API_KEY` (`ANTHROPIC_BASE_URL` optional) | scenarize |
| `SCENARIST_MODEL` | scenarize (default `claude-sonnet-4-5`) |
| `LINEAR_API_KEY` | changes (personal key, sent as raw `Authorization`) |
| `ELEVENLABS_API_KEY` | transcribe elevenlabs |
| `OPENAI_API_KEY` | transcribe openai |
| `yt-dlp` on PATH | ingest (`pip install yt-dlp --break-system-packages`) |

## Cost per video (rough, verify current pricing)

- scenarize: ~3–6k input tokens (transcript + changes + notes + prompt), ~1.5k output => about $0.03–0.05 on Sonnet; +same again if the retry triggers.
- STT only when no YouTube subtitles: ElevenLabs Scribe ≈ $0.4/h and Whisper API $0.006/min => ~$0.02–0.04 for a 5 min video; `local` is free.
- Linear and yt-dlp: free. Total typically < $0.10 per video.

## Tests

`pnpm --filter @svp/knowledge test` – VTT parsing, STT word grouping, keyword filter, graceful Linear degradation, fake-LLM scenarize -> validate -> review (uses `test/fixture/transcript.txt` with the old name "Přidat nepřítomnost" and `changes.json` renaming it to "Nová absence").

## Adding other knowledge sources (Notion, help center, ...)

A source only has to write files into `out/<id>/source/` and be readable by `scenarize`:
1. Add `src/<source>.ts` exporting a function that fetches pages since a date and writes `source/<source>.json` (`[{title, text_excerpt, updated_at, url}]`) – mirror `changes.ts` (env key, graceful degradation, keyword filter).
2. Add a subcommand in `src/cli.ts`.
3. In `scenarize.ts` read the file and add another XML block to `buildUserPrompt` (e.g. `<help_center>`); mention it as authoritative-for-naming in `SYSTEM_PROMPT`. Simplest alternative without code: export to markdown and pass via `--product-notes`.
