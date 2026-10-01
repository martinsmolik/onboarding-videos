# @svp/explorer

Turns a `scenario.json` (narration + plain-language intent per step, **no selectors**) into a
`recipe.json` whose selectors have been **proven** by actually performing every step in Chromium.
This is the only stage where an LLM drives a browser. Speed does not matter here. What matters is
that the recipe is correct.

```
pnpm --filter @svp/explorer start -- --scenario samples/scenario.absence-request.json --out out/absence-request
pnpm --filter @svp/explorer start -- --heal out/absence-request/timing.json          # self-heal failed steps
  [--headed] [--dry-run [fixture.json]] [--start-url <url>]
```

Programmatic: `import { run } from '@svp/explorer'` then `await run({ scenario, out, heal?, headed?, dryRun?, startUrl? })`
→ `{ recipePath, recipe, usage[], healed? }`.

Relative paths are resolved from where you ran the command (`INIT_CWD`), not from the package directory.

## How it works

```
for each scenario step:
  snapshot(page) ──▶ Claude (tool loop, max 12 tool calls)
                       snapshot / click(n) / type(n) / select(n) / press / scroll / verify_visible / screenshot
                       done(actions, expect)
                            │
                            ▼
          INDEPENDENT RE-VALIDATION (no LLM):
          new browser context → start.url (+ storage state)
          → replay all accepted steps → replay this step's actions:
            before each action: policy check + locator.count() === 1 (polled for up to 5 s)
          → expect.visible must match exactly 1 element and be visible
                            │
             ok ────────────┴──────────── rejected (at most 3 times)
   the validated page becomes             Claude gets the exact reason, e.g. "AMBIGUOUS – matches 2
   the working page for the next step     elements", plus a unique selector for each match.
                                           It fixes only its done() call.
```

* **An in-process tool loop over the Anthropic Messages API** (`@anthropic-ai/sdk`). No MCP is involved.
  The model is `claude-sonnet-5-5` (override it with `EXPLORER_MODEL`). With `EXPLORER_DRIVER=session` there is no API call:
  the Claude running the surrounding Claude Code session is the model, through request/reply files in
  `out/<id>/explorer-session/` (`src/session.ts`, driven with `node scripts/explorer-turn.mjs <id>`). Replay validation is identical. The system prompt and the tool
  definitions are prompt-cached.
* **Snapshot** (`src/snapshot.ts` + `src/browser-script.ts`): lists visible elements, interactive ones
  first, then elements in the viewport. The list is capped at 150 elements and about 14k characters.
  Each element is one line:
  `[n] <role> "text" testid=… value=… selector=… (UNSTABLE|offscreen|disabled)`.
  Candidate selectors are generated in policy order. A candidate is accepted only if
  `locator.count() === 1` **and** the single match is the same DOM node. The explorer checks this with a
  per-element expando (`__svpRef`) and never mutates DOM attributes.
* **Why every step replays in a fresh browser.** The recipe is judged in exactly the state the recorder
  will be in. That state is not the state the model's own exploring left behind.
* A step starts from the validated page. Drift between what the model did and what the recipe says
  can therefore never accumulate across steps.
* **Cost control:**
  * The model is told not to take screenshots unless it is stuck.
  * The history is append-only (Sonnet 5.5 signs thinking blocks over earlier turns); the growing prefix is prompt-cached instead of pruned.
  * Each step is limited to 12 tool calls (`EXPLORER_MAX_TOOL_CALLS`).
  * Token usage and USD cost are logged per step to stderr and to `out/<id>/explorer-log.json`.

### Output
* `out/<id>/recipe.json`, following the contract:
  * viewport 1920×1080
  * `start.url` is the first URL (after login, the landing URL)
  * `voice` is taken from the scenario, or `{provider:"elevenlabs"}` if the scenario has none
  * narration is copied verbatim
  * `hold_after_ms: 800`
  * `expect` comes from `must_show`
  * `app_version` is the ISO date of the run
  * `version` is the previous version + 1
* Scenario step ids that do not match `^s\d{2,3}$` are renumbered `s01…`.
* The start URL is chosen in this order: `--start-url`, then optional `scenario.start_url`, then
  `SLONEEK_DEMO_URL`, then the demo app.
* On failure, `recipe.partial.json` is written with the steps that were accepted, and the command exits 1.

## Selector policy (enforced in code, `src/policy.ts`, not only prompted)

1. `[data-testid=…]` (also `data-test`, `data-cy`, `data-qa`)
2. `role=<role>[name="<exact name>"s]`. The `s` suffix makes the match exact and case-sensitive.
3. `text="<exact text>"`
4. A scoped combination: `[data-testid=absence-form] >> role=button[name="Odeslat"s]`

The following are rejected by code:
* `nth-child`, `nth-of-type`, `nth=`, `:nth-match`
* xpath
* generated or CSS-module class names (`css-…`, `sc-…`, `_hash`, anything containing digits)
* deep absolute css paths

Snapshot lines where only the nth-of-type fallback worked are marked `UNSTABLE`. The model is told to
build a scoped selector instead.

Hidden duplicates count. `text="Absence"` in the demo app matches both the menu item and the hidden
`<h1>`, and the explorer rejects it, just as Playwright strict mode would fail it in the recorder.

## Self-heal (`--heal out/<id>/timing.json`)

1. Read the steps with `status: "failed"` from `timing.json` and load `recipe.json`.
2. Replay the recipe **deterministically, without the LLM**, up to the failed step.
   * If an *earlier* step no longer replays (the recorder was lucky, or the UI changed), that step is
     queued and healed first.
3. Run the LLM loop for that step only. Its context includes the previous actions and expect, the
   recorder's error, and the screenshot path.
   * The intent and `must_show` come from `out/<id>/scenario.json` or `--scenario`. If neither exists,
     the narration is used as the intent.
4. The result goes through the same independent re-validation.
5. `recipe.json` is patched in place: `version` is bumped and `app_version` is set to today's date.
   The healed steps are listed in `explorer-log.json`.

The loop is: record → failed step → heal → record. This is what makes the pipeline converge.

## Login ("step 0")

If `SLONEEK_DEMO_URL`, `SLONEEK_DEMO_USER` and `SLONEEK_DEMO_PASS` are all set:

1. The explorer opens the URL, and the model logs in by typing the **literal placeholders**
   `{{SLONEEK_DEMO_USER}}` and `{{SLONEEK_DEMO_PASS}}`. The tools substitute the real values from env at
   execution time, so credentials never reach the LLM or any output file.
2. The explorer then writes:
   * `out/<id>/storage-state.json` (Playwright storageState; gitignored via `storage-state*.json`),
     which also goes into `recipe.start.storage_state`. The path is relative to the repo root / invocation
     directory, and the file always sits next to `recipe.json`.
   * `out/<id>/login-actions.json`: `{ url, actions[], expect, landing_url }`. The actions are
     recipe-format actions with `{{ENV}}` placeholders in `value`.

**For the recorder:**
* Primary: `browser.newContext({ storageState: recipe.start.storage_state })`, then `goto(start.url)`.
  If the path does not resolve, try `path.join(dirname(recipe.json), 'storage-state.json')`.
* Fallback (the state is missing or expired, or you are redirected to login): open
  `login-actions.url` and run `actions` after replacing each `{{NAME}}` with `process.env.NAME`. Then check
  `expect.visible` and `goto(start.url)`. This happens off-camera, before recording starts.

Heal mode logs in again automatically if the storage-state file is missing and credentials are set.

## Dry run (no `ANTHROPIC_API_KEY`)

`--dry-run` swaps Claude for `ScriptedModel`, which replays `fixtures/<scenario id>.dry-run.json`. It
issues one tool call per turn, and `@ref:` / `@sel:` placeholders are resolved against the *latest real
snapshot*. Everything except the LLM is exercised: the tool loop, the snapshot generator, the selector
derivation and the replay validation.

The fixture deliberately contains:
* an ambiguous `done` in s02
* a policy-violating `done` in s05
* a `login` script for `fixtures/login.html`

## Tests

`pnpm --filter @svp/explorer test` (node:test via tsx, runs against `demo-app` over `file://`).
* For 7 app states, every snapshot element's selector has `count()===1` **and** resolves to that element.
* Every visible `data-testid` wins the priority order.
* Every interactive element gets a stable selector that satisfies the policy.
* There are tests for the policy accept/reject rules, and for ambiguous and missing detection in the
  validator.
* An end-to-end dry run is diffed against `samples/recipe.absence-request.json`: actions are identical in
  all 6 steps, and so is `expect` wherever the sample has one.

## Cost per video (estimate – not yet measured on a real run)

Sonnet 4.5 costs $3 per million input tokens and $15 per million output tokens.
* A typical step takes 3–5 model calls. Each call sends about 3k tokens of cached system prompt and tools,
  1–4k tokens of snapshot and 1k of history, and gets back about 150 output tokens.
* That comes to roughly **$0.04–0.10 per step**, or **$0.3–1 for a 6–10 step video**.
* One heal costs about $0.05–0.15.
* A screenshot adds about 1.5–2k input tokens.

The real numbers go to `explorer-log.json` (`usage[].usd`, `total_usd`). Check them after the first live run.

## Known limitations
* Replay validation re-runs earlier steps many times over (O(n²) actions). That is fine on the demo app.
  On a real tenant, steps that create data (submitting an absence) are executed several times, so use a
  disposable demo tenant or data that tolerates duplicates.
* iframes and shadow DOM are not listed in snapshots.
* Only `must_show` becomes `expect.visible`. Nothing produces `url_contains` automatically; the model may
  set it.
