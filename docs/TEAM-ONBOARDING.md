# Hackathon: pipeline onboardovacích videí — rychlý start

## 1. Quickstart (10 minut)

```bash
cd hackaton
bash scripts/setup.sh      # nebo: make setup / pnpm run setup
```

Skript je idempotentní (klidně spusť znovu). Zkontroluje Node ≥ 22, doinstaluje pnpm, `pnpm install`, Playwright Chromium, vytvoří `.env` a na konci pustí smoke test. Na konci vypíše souhrn ✓ / ✗.

Co musíš mít ručně: **Node 22** (`brew install node@22`) a **ffmpeg** (`brew install ffmpeg`). Volitelně `brew install yt-dlp` (jen pro import ze YouTube).

`.env`: vznikne z `.env.example`. Pro smoke test a offline demo **nepotřebuješ žádné klíče** (hlas `mock`). Klíče doplň až pro ostré běhy (viz sekce „Co není ověřeno naživo").

Smoke test sám: `pnpm smoke` (~1 min). Hotovo = `SMOKE PASS` a soubor `out/smoke/final.mp4` (~37 s, 1 audio stopa).

## 2. Jak pipeline funguje (8 řádků)

1. **knowledge**: starý YouTube popis/titulky + změny z Linearu → `scenario.json` (+ `scenario.review.md`).
2. Člověk scénář schválí (30 s čtení).
3. **explorer**: LLM v prohlížeči projde scénář a vyrobí `recipe.json` s ověřenými selektory.
4. **tts**: namluví každý krok *dřív* než se nahrává → `audio/sNN.mp3` + `durations.json`.
5. **record**: deterministický Playwright replay bez LLM → `raw.webm`, `timing.json`, `shots/`.
6. **mux**: ffmpeg složí video + audio + titulky → `final.mp4`, `final.srt`.
7. Selhané kroky (`failed` v `timing.json`) → explorer je sám opraví (heal) → znovu tts + record (max 2×).
8. **upload**: volitelně na YouTube (unlisted/private). Vše komunikuje přes soubory v `out/<id>/`.

Pořadí stagí: `knowledge > explore > tts > record > mux > upload`.

## 3. Který příkaz co dělá

| příkaz | co |
|---|---|
| `pnpm run setup` / `make setup` | instalace všeho + smoke |
| `pnpm smoke` | offline test celé pipeline (demo app + mock hlas) |
| `pnpm demo` | spustí demo app na http://localhost:4173 |
| `pnpm typecheck` / `pnpm test` | kontrola typů / testy všech balíčků |
| `pnpm pipeline run --id X ...` | celá pipeline pro video `X` (resumable) |
| `pnpm pipeline status --id X` / `pnpm pipeline ls` | stav jednoho / všech videí |
| `pnpm batch` | všechna videa z `videos.csv` po sobě, report `out/batch-report.md` |
| `pnpm --filter @svp/knowledge start -- ingest\|transcribe\|changes\|scenarize ...` | jednotlivé kroky knowledge |
| `pnpm --filter @svp/explorer start -- --scenario ... --out out/X` | jen explorer |
| `pnpm --filter @svp/recorder start -- --recipe ... --out out/X [--headed]` | jen nahrávání (`--headed` ukáže prohlížeč) |
| `pnpm --filter @svp/assembler start -- tts\|mux --out out/X` | jen hlas / jen sestříhání |

Make: `make run ID=x RECIPE=samples/recipe.absence-request.json ARGS="--to mux"`.

## 4. Kde jsou výstupy

Vše v `out/<id>/` (složka je v `.gitignore`): `scenario.json`, `scenario.review.md`, `recipe.json`, `audio/`, `raw.webm`, `timing.json`, `shots/`, `final.mp4`, `final.srt`, `state.json`, `logs/<stage>.log`. Batch report: `out/batch-report.md`.

## 5. Jak přidat nové video

1. Přidej řádek do `videos.csv` (`id,youtube_url,lang,audience,title`) — nebo použij příkaz níže.
2. **Scénář**: `pnpm pipeline run --id moje-video --youtube "https://youtu.be/XXXX" --lang cs --audience employee --title "Název" --to knowledge`
   → otevři `out/moje-video/scenario.review.md`, případně uprav `scenario.json`.
3. **Explorer + zbytek**: `pnpm pipeline run --id moje-video --scenario out/moje-video/scenario.json --to mux`
   (nejdřív `--to mux`, upload až když jsi spokojený: `--from upload`).
4. Hotový recipe ze samples (bez LLM): `pnpm demo &` a `pnpm pipeline run --id x --recipe samples/recipe.absence-request.json`.

Na reálném Sloneek tenantu jsou potřeba `SLONEEK_DEMO_URL/USER/PASS` v `.env`.

## 6. Jak video zkontrolovat

- `scenario.review.md`: tabulka kroků (narace / záměr / must_show), co se změnilo oproti starému videu, varování, checklist. Čti **před** nahráváním.
- `shots/sNN.png`: screenshot na konci každého kroku; rychle zjistíš, jestli je UI ve správném stavu.
- `timing.json`: u každého kroku `status` (`ok` / `failed` / `skipped`), `t_start`, `t_end`. Hledej `failed`.
- `final.mp4` + `final.srt`: finální pohled; zkontroluj sync hlasu s kliky.
- `pnpm pipeline status --id X`: tabulka stagí a počet pokusů.

## 7. Co ještě není ověřeno naživo

Ověřeno offline (demo app + mock hlas + stuby): recorder, mux, orchestrátor, testy. **Nezkoušeno s reálnými službami:**

- **ElevenLabs**: TTS a Scribe (klíč + `ELEVENLABS_VOICE_ID`).
- **Anthropic**: scenarize a explorer s reálným modelem (`ANTHROPIC_API_KEY`).
- **Linear**: stahování změn (`LINEAR_API_KEY`); bez klíče vrátí prázdný seznam a varování.
- **yt-dlp**: ingest reálných videí (titulky, audio).
- **YouTube upload**: OAuth (`node packages/orchestrator/scripts/yt-oauth.mjs`). Pozor: neověřený API projekt nahraje video jako **private**; přepni v YouTube Studiu na unlisted. Nahrazení videa vytvoří nové a staré skryje (`out/video-map.json`).
- Přihlášení do reálného Sloneek tenantu (storage-state).

Doporučení: ještě dnes otestuj své klíče na jednom krátkém videu, ne až na pódiu.

## 8. Troubleshooting

| problém | řešení |
|---|---|
| `Executable doesn't exist ... chromium` | `pnpm --filter @svp/recorder exec playwright install chromium` |
| port 4173 je obsazený | `lsof -i :4173` → `kill <PID>` (často zapomenutý `pnpm demo`). Recipe má 4173 napevno. |
| `ffmpeg`/`ffprobe` nenalezen | `brew install ffmpeg`, pak nový terminál |
| `pnpm: command not found` | `corepack enable && corepack prepare pnpm@10 --activate` (nebo `npm i -g pnpm`) |
| Node < 22 | `brew install node@22` a přidej do PATH |
| chci přegenerovat od kroku | `--from record` = znovu record a vše po něm; `--from tts` po změně narace |
| chci přegenerovat vše | `--force` (pozor: pokud rozsah zahrnuje `upload`, nahraje se znovu; při ladění dávej `--to mux`) |
| run se tváří jako hotový | dokončené stage se přeskakují; použij `--force` nebo `--from` |
| „lock" chyba | běží jiný run na stejném `--id`; nebo smaž `out/<id>/.lock` po pádu |
| stage padá, balíček se změnil | přepiš příkaz bez úpravy kódu: `SVP_CMD_RECORD='...' pnpm pipeline run ...` (viz README orchestrátoru) |
| logy | `out/<id>/logs/<stage>.log` |
