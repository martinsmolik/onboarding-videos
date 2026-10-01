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
| `pnpm local:check <recipe>` / `pnpm local <recipe>` | lokální PoC na Macu: pre-flight / tts → record v Neo → mux (sekce 7) |
| `pnpm voice:manifest <recipe> [--id X]` | seznam mp3, které má Claude namluvit (hlas `external`) |

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

## 7. Lokální PoC na Macu s Neo

Celá AI práce (průzkum UI, narace, hlas přes ElevenLabs konektor) běží interaktivně v Claudovi. Mac pouští jen deterministické skripty. Nahrává se **přímo v BrowserOS neo** („Neo“), kde už jsi přihlášený do pre-prod: recorder se připojí přes CDP (Chrome DevTools Protocol, tedy „dálkové ovládání“ Chromia), otevře si **vlastní novou záložku** (tvých záložek se nedotkne), nahraje ji a zase ji zavře. Žádné tokeny se nekopírují.

**Jednou na začátku**

```bash
brew install node@22 ffmpeg          # pokud ještě nemáš
cd hackaton && pnpm i                # Playwright Chromium v CDP režimu není potřeba
```

**Každé video (pořadí dodrž)**

1. Otevři **BrowserOS neo** a zkontroluj, že jsi přihlášený na `https://app-pre-production.sloneek.com`. Okno nech **viditelné** (neminimalizuj ho, nepřesouvej na jinou plochu). Bez viditelného okna Chromium nekreslí snímky.
2. Pre-flight kontrola:
   ```bash
   pnpm local:check recipes/absence-request.en.json
   ```
   Mělo by být ✓ `CDP reachable: http://127.0.0.1:9110` a pod tím seznam tvých otevřených záložek (tak poznáš, že je to Neo). Recipe se kontroluje proti `contracts/recipe.schema.json`. Hlas bude zatím ✗ (chybí mp3) a to je v pořádku.
3. Seznam úkolů pro hlas:
   ```bash
   pnpm voice:manifest recipes/absence-request.en.json
   ```
   → `out/absence-request/audio/manifest.json`. Řekni Claudovi: *„vygeneruj voiceover podle tohoto manifestu“*. Claude přes ElevenLabs konektor vyrobí `s01.mp3 … s10.mp3` (případně i `alignment/sNN.json` pro přesné titulky) a uloží je do `out/absence-request/audio/`. Přijme se i `.wav` / `.m4a`, převede se samo.
4. Znovu `pnpm local:check recipes/absence-request.en.json` → všechno ✓.
5. Nahrání a sestříhání jedním příkazem:
   ```bash
   pnpm local recipes/absence-request.en.json
   ```
   Běží `tts` (jen změří délky mp3) → `record` (Neo, nová záložka 1920×1080) → `mux`. Na konci se `out/absence-request/final.mp4` sám otevře. Volby: `--id <jiné-id>`, `--no-intro`, `--cdp http://127.0.0.1:<port>`, `--no-open`.
6. Kontrola: konec výpisu ukazuje kroky, které nejsou `ok`, spolu s cestou ke screenshotu. Exit kód 2 znamená, že video **není** publikovatelné.

**Na co myslet**

- **Každé nahrání mění data v pre-prod.** `absence-request` vytvoří absenci, takže druhé nahrání se stejnými dny skončí kolizí. Recipe proto má používat `{{DAY:+Nd}}` / `{{DAY:+Nd+2}}` a `{{DATE:+Nd:MM/DD/YYYY}}` (dny počítané od dneška; víkend se posune na pondělí). Start volíme tak, aby padl na pondělí v **aktuálním** měsíci. `pnpm local:check` vypíše konkrétní data a varuje, když vyjdou na víkend nebo do dalšího měsíce. `add-users` vytváří při každém běhu nového uživatele, unikátní e-mail zajistí `{{RUN_ID}}`.
- Při nahrávání na Neo nesahej a nepouštěj Claudovy Neo nástroje (explorer) souběžně se záznamem.
- Přerušení (Ctrl+C) nahrávací záložku zavře.

**Když CDP nejde (✗ u CDP)**

1. `curl -s http://127.0.0.1:9110/json/version`. Neo spouští CDP server na portu 9110 automaticky. Pokud byl port obsazený, Neo si vybralo jiný a zapsalo ho do `~/Library/Application Support/BrowserClaw/Local State`; `--cdp auto` ho tam najde.
2. Restart Nea s pevným portem:
   ```bash
   osascript -e 'quit app "BrowserOS neo"'; sleep 2
   open -a "BrowserOS neo" --args --browseros-cdp-port=9110
   ```
3. Záložní cesta bez CDP: zkopíruj přihlášení do souboru podle `scripts/grab-session.md` (snippet do DevTools konzole → `pbpaste > out/session.json`) a pusť
   ```bash
   pnpm --filter @svp/recorder exec playwright install chromium   # jen poprvé
   pnpm local recipes/absence-request.en.json --session-file out/session.json
   ```
   Recorder pak spustí vlastní Chromium s tvými tokeny. Hodnoty tokenů se nikde nevypisují a `out/session.json` je v `.gitignore`.

## 7b. Videa podle briefu (4–6 min, čeština, 5 částí)

Brief (`docs/brief/kostra-videonavodu.txt`) chce mezititulek na začátku každé části, kapitoly do popisu na YouTube, zoom na důležitá místa a rychlé psaní. V recipe na to slouží tato pole (všechna jsou volitelná, staré recipe fungují beze změny):

| pole | kde | co dělá | výchozí |
|---|---|---|---|
| `part`, `part_title` | krok | Číslo a název části. Stačí je dát na **první krok části**, další kroky ji zdědí. Při změně části se vloží karta „2 / Nastavení“ (1,5 s) a vznikne kapitola. | – |
| `narration_tts` | krok | Text, který se **namluví** (čísla a zkratky rozepsané pro AI hlas, např. „kej pí áj“). Claude hlasuje pole `tts_text` z manifestu. | `narration` |
| `subtitle` | krok | Text, který divák **čte** v titulcích (např. „KPI“, „24 hodin“). `""` = krok bez titulku. | `narration` |
| `interstitials`, `chapters` | recipe | Vypne mezititulky / `chapters.txt`. | `true` |
| `zoom` | akce | Plynulý zoom na `selector`: `value` = měřítko (`"1.6"`), `hold_ms` = jak dlouho zůstane přiblížený. Kurzor zůstane normálně velký a ukazuje na přiblížený prvek. Celý prvek se musí vejít na obrazovku, jinak se měřítko sníží (v logu `zoom …: scale 1.6 -> …`) – zoomuj spíš menší prvek. | `1.6`, 2500 ms |
| `fill` | akce | Kurzor klikne do pole a celý text se vloží najednou. Na delší texty. | – |
| `type` + `speed: "fast"` | akce | Psaní po znacích: normálně 35 ms/znak, `fast` 15 ms (nahrávání v Neo přes CDP; cloudový smoke zůstává na 80 / 40 ms kvůli synchronizaci). `delay_ms` má přednost. | 35 ms |

Příklad kroku:

```json
{ "id": "s04", "part": 2, "part_title": "Nastavení",
  "narration": "Tady vidíte hlavní KPI docházky.",
  "narration_tts": "Tady vidíte hlavní kej pí áj docházky.",
  "actions": [ { "type": "zoom", "selector": "[data-testid=kpi-hours]", "value": "1.6", "hold_ms": 2500 } ] }
```

Výstupy navíc: `out/<id>/chapters.txt` (např. `0:00 Úvod`, `0:45 Nastavení`, … – vlož do popisu videa; YouTube kapitoly ukáže jen při ≥ 3 kapitolách po ≥ 10 s, mux jinak varuje). Časy sedí na hotové `final.mp4` včetně úvodní karty a mezititulků.

Náhledovky místo generované úvodní / závěrečné karty: `pnpm local <recipe> --intro-image thumb.png --outro-image konec.png` (`--intro-sec` / `--outro-sec`, výchozí 3 s). Vypnutí mezititulků nebo kapitol: `--no-interstitials`, `--no-chapters`. Písmo karet: Inter, pokud najde statické soubory `Inter-Bold.ttf` / `Inter-Regular.ttf` (např. v `~/Library/Fonts`), jinak DejaVu Sans; jiné písmo nastavíš cestou k souboru v `BRAND_FONT` / `BRAND_FONT_BOLD` v `.env`. Barvy: `BRAND_BG` / `BRAND_FG`.

Vyzkoušení bez ElevenLabs: `pnpm demo &` a `pnpm local samples/recipe.parts-demo.json --provider say` (na Macu; v Linuxu `--provider espeak`). Ukázka má 3 části, 2 zoomy, `fill` a rozdílné titulky a hlas.

## 8. Co ještě není ověřeno naživo

Ověřeno offline (demo app + mock hlas + stuby): recorder, mux, orchestrátor, testy. **Nezkoušeno s reálnými službami:**

- **ElevenLabs**: TTS a Scribe (klíč + `ELEVENLABS_VOICE_ID`).
- **Anthropic**: scenarize a explorer s reálným modelem (`ANTHROPIC_API_KEY`).
- **Linear**: stahování změn (`LINEAR_API_KEY`); bez klíče vrátí prázdný seznam a varování.
- **yt-dlp**: ingest reálných videí (titulky, audio).
- **YouTube upload**: OAuth (`node packages/orchestrator/scripts/yt-oauth.mjs`). Pozor: neověřený API projekt nahraje video jako **private**; přepni v YouTube Studiu na unlisted. Nahrazení videa vytvoří nové a staré skryje (`out/video-map.json`).
- Přihlášení do reálného Sloneek tenantu (storage-state).

Doporučení: ještě dnes otestuj své klíče na jednom krátkém videu, ne až na pódiu.

## 9. Troubleshooting

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
