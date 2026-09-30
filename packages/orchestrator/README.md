# @svp/orchestrator

Runs the whole onboarding-video pipeline as a resumable state machine, heals failed recording steps, uploads to YouTube, and ships an n8n workflow + batch runner.

```
knowledge > explore > tts > record > mux > upload        state: out/<id>/state.json
                          └─ heal loop: failed steps -> explorer --heal -> tts (cached) -> record again
```

## 0. Facts worth knowing before you start

* Commands are run from the repo root: `pnpm pipeline <cmd>` (= `pnpm --filter @svp/orchestrator start <cmd>`).
* Stages are child processes (`pnpm --filter @svp/<pkg> start -- ...`), stdout/stderr are shown live **and** written to `out/<id>/logs/<stage>.log`. Upload runs in-process (native `fetch`, no deps).
* Every stage has a timeout: `SVP_TIMEOUT_<STAGE>_MS` (defaults: knowledge 10 min, explore 20, tts 5, record 10, mux 10, upload 15).
* `.env` in the repo root is loaded automatically (real environment wins).
* If a package CLI drifts on stage day, override one stage without touching code:
  `SVP_CMD_RECORD='pnpm --filter @svp/recorder start -- --recipe {recipe} --out {out} --headed' pnpm pipeline run --id x --from record`
  (placeholders `{id} {out} {recipe} {scenario} {timing} {youtube}`; stages `KNOWLEDGE EXPLORE HEAL TTS RECORD MUX`).

## 1. Setup (once)

```bash
pnpm install
cp .env.example .env            # fill in the keys
pnpm exec playwright install chromium     # from packages/recorder if not already done
ffmpeg -version                  # assembler needs ffmpeg on PATH
```

Env used by the orchestrator (others are used by the packages):

| var | meaning |
|---|---|
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` | YouTube upload. If all three are present the `upload` stage runs, otherwise it is skipped (unless `--upload`, which then fails loudly) |
| `YT_PRIVACY` | `unlisted` (default) / `private` / `public` |
| `SVP_OUT_DIR` | override `out/` location |
| `SVP_TIMEOUT_*_MS`, `SVP_CMD_*` | see above |

## 2. One-time YouTube OAuth (do this **today**, not on stage)

1. Google Cloud Console > new project > **APIs & Services > Library > YouTube Data API v3 > Enable**.
2. **OAuth consent screen**: External, add yourself (the channel owner) as *Test user*. Scopes: `youtube.upload`, `youtube.force-ssl`.
3. **Credentials > Create OAuth client ID > Web application**, authorised redirect URI exactly `http://localhost:8787/callback`. Put id/secret in `.env` (`YT_CLIENT_ID`, `YT_CLIENT_SECRET`).
4. `node packages/orchestrator/scripts/yt-oauth.mjs` > open the printed URL > approve > copy `YT_REFRESH_TOKEN=...` into `.env`. (Remote box: `ssh -L 8787:localhost:8787 host` first.)
5. Smoke test: `pnpm pipeline run --id <existing id> --from upload --to upload`.

**Two gotchas that will bite if ignored**
* **Unverified API projects upload as PRIVATE.** Per the `videos.insert` docs, every video uploaded through a project created after 28 Jul 2020 that hasn't passed Google's API compliance audit is locked to `private`, whatever `YT_PRIVACY` says. For the hackathon: upload works, then flip to unlisted in YouTube Studio (or apply for the audit: <https://support.google.com/youtube/contact/yt_api_form>).
* **Consent screen in "Testing" => refresh token dies after 7 days** (`invalid_grant`). Re-run `yt-oauth.mjs`, or publish the app ("In production" is fine for one user; you'll see an "unverified app" warning once).
* Quota: default 10 000 units/day; the docs page for `videos.insert` currently states its cost in a separate upload bucket, captions.insert costs 400 units. Don't batch-test uploads 30 times.

## 3. Run one video

```bash
# from an old YouTube video (knowledge > explore > ...)
pnpm pipeline run --id attendance-overview --youtube "https://youtu.be/XXXX" --lang cs --audience employee --title "Přehled docházky"

# from a ready recipe (skips knowledge+explore; works offline with the demo app + mock voice)
pnpm demo &                                   # serves demo-app on :4173
pnpm pipeline run --id absence-request --recipe samples/recipe.absence-request.json

# from a scenario you edited by hand
pnpm pipeline run --id attendance-overview --scenario out/attendance-overview/scenario.json
```

Flags: `--from <stage> --to <stage>` `--force` `--max-heal 2` `--upload` `--replace <videoId>` `--since YYYY-MM-DD` `--dry-run`.

**Resume semantics**
* Re-running skips stages that are `done`. A `failed` or interrupted stage is retried.
* `--from X` = "redo X and everything after it" (implies force for those). `--to Y` stops after Y. `--force` = redo every stage in range.
* Passing a `--recipe` whose content differs from `out/<id>/recipe.json` automatically redoes explore and everything after.
* Careful: `--from`/`--force` covering `upload` uploads *again* (new video). Use `--to mux` while iterating.
* A pid lock (`out/<id>/.lock`) stops two runs on one id.

**Heal loop.** After `record`, `timing.json` is read. Steps with `status: failed` => `explorer --heal out/<id>/timing.json` > `tts` (cache makes it cheap) > `record` again, at most `--max-heal` (2) times. Still failing => `record` is `failed` with `steps still failing after 2 heal(s): s03, s07` and `state.json.failed_steps` lists the ids. Each attempt's timing is kept as `logs/timing.run<N>.json`. A recorder exit code != 0 without failed steps (crash) is **not** healed, it fails the stage.

`pnpm pipeline status --id <id>` (`--json` for machines), `pnpm pipeline ls`.

### Replacing an already published video
**YouTube cannot replace the media of an existing video** (`videos.update` is metadata-only; there is no API or Studio "replace file" that keeps the ID/URL/stats). So `--replace <oldVideoId>` does: upload new video > set the old one to `private` (status re-sent in full because `videos.update` wipes omitted fields) > write the mapping to `out/video-map.json`:
```json
{ "absence-request": { "video_id": "NEW", "url": "https://youtu.be/NEW", "updated_at": "...", "superseded": ["OLD"] } }
```
**The portal must read this mapping (or the new `video_url` in `state.json`) and swap the link.** Anyone holding the old link gets a "private video" page.

## 4. Batch

`videos.csv` (repo root; example in `packages/orchestrator/videos.csv.example`), columns `id,youtube_url,lang,audience,title`:
```bash
node packages/orchestrator/scripts/batch.mjs                 # ./videos.csv
node packages/orchestrator/scripts/batch.mjs my.csv --upload --max-heal 3
```
Sequential, never aborts on a failing row, writes `out/batch-report.md`, exit code 1 if any failed. Rerun is cheap: finished ids skip straight through.

## 5. n8n

`n8n/onboarding-video-pipeline.workflow.json` -> n8n > Workflows > Import from file.

```
Webhook (POST) > Build command (validates, shell-quotes) > Run pipeline (Execute Command) > Parse result
   > Succeeded? ── yes > Read final.mp4 > Slack: upload mp4 + status/video url/review notes
                └─ no  > Slack: ALERT with failed stage + failed step ids + log path
```
Requirements/caveats:
* **Self-hosted only.** Execute Command isn't on n8n Cloud and is disabled by default since n8n 2.0: start n8n with `NODES_EXCLUDE='[]'`. n8n must run on the host with the repo, pnpm, ffmpeg and Playwright browsers (a Docker n8n runs commands *inside the container*).
* Edit `REPO` in the *Build command* code node, choose Slack credentials + channel in the two Slack nodes (credentials are placeholders), add header auth on the Webhook before exposing it.
* Payload: `{ "id": "absence-request", "youtube_url": "https://youtu.be/...", "recipe": {...}, "lang": "cs", "audience": "employee", "title": "...", "upload": true, "dry_run": true }`. Webhook returns immediately; the workflow continues in the background (timeout 1 h).
* Trigger: `curl -X POST https://<n8n>/webhook/onboarding-video -H 'content-type: application/json' -d '{"id":"absence-request","dry_run":true}'` (use `/webhook-test/...` while the workflow is open in the editor). `review` text comes from `out/<id>/scenario.review.md` if knowledge produced it.
* Node versions used: webhook 2.1, code 2, executeCommand 1, if 2.2, readWriteFile 1, slack 2.3. If n8n complains about a version on import, open the node and re-select the operation.

## 6. Tests / dry run

`--dry-run` swaps every stage for `test/stubs/<stage>.mjs`, which write contract-shaped files. The record stub fails step `s03` until explorer-stub has "healed" it (`STUB_FAIL_STEP=s05` to change, `STUB_ALWAYS_FAIL=1` to exhaust the heal budget). Upload stub returns a fake `https://youtu.be/STUB...` (runs even without YT creds).
```bash
pnpm --filter @svp/orchestrator test     # state machine, heal, --from/--force, recipe invalidation, lock
```

## 7. Demo script (5 commands on stage)

```bash
# 1. the stand-in HR app (separate terminal)
pnpm demo
# 2. heal loop live: s03 "breaks", explorer repairs it, recorder retries (stubs; ~5 s)
STUB_FAIL_STEP=s03 pnpm pipeline run --id heal-demo --recipe samples/recipe.absence-request.json --dry-run
# 3. the real thing: deterministic Playwright replay + audio-first sync + ffmpeg mux
pnpm pipeline run --id absence-request --recipe samples/recipe.absence-request.json
# 4. state of everything / show idempotency (all stages skip)
pnpm pipeline ls && pnpm pipeline run --id absence-request
# 5. publish (unlisted) and print the link; swap-a-video story via --replace
pnpm pipeline run --id absence-request --from upload --upload
```
Fallback if the network dies: steps 1-4 work fully offline (mock voice). Have a finished `out/absence-request/` ready and pre-upload it once so step 5 is a rehearsed beat.
