---
name: onboarding-video
description: Vyrobí onboardovací video (screencast s hlasem a titulky) pro aplikaci Sloneek z tématu, které zadá kolega. Provede ho rozhovorem, napíše scénář ke schválení, nechá agenta proklikat reálnou aplikaci, namluví, nahraje, sestříhá a vrátí odkaz na video. Použij, když někdo chce nové nebo aktualizované návodné video, napíše /onboarding-video, „udělej video o…“, „natoč návod na…“.
---

# Onboardovací video ze zadání

Uživatelé jsou kolegové ze Sloneeku, většinou **netechničtí**. Mluv s nimi česky (nebo jazykem, kterým píšou), bez žargonu. Nikdy po nich nechtěj terminál, příkazy ani soubory. Všechno spouštíš ty. Technické detaily (logy, cesty, exit kódy) jim neukazuj, jen to, co z nich plyne.

Celá pipeline je popsaná v `README.md` a `docs/TEAM-ONBOARDING.md`. Pořadí stagí: `knowledge > explore > tts > record > mux > upload`. Vše se ukládá do `out/<id>/`.

## 0. Příprava prostředí (vždy, potichu)

Zjisti, kde běžíš: `uname -s` = `Darwin` → **Mac kolegy** (Claude desktop app), jinak **cloud** (claude.ai/code).

**Prefix příkazů.** Na Macu nejsou nástroje v systému, takže každý příkaz s `pnpm` nebo `node` spouštěj s prefixem `source ~/.onboarding-videos/env.sh && …`. Dlouhé běhy (`pnpm video …`) navíc přes `caffeinate -i`, aby Mac během nahrávání neusnul. V textu níž je prefix značený `‹P›`. V cloudu je `‹P›` prázdný.

| | Mac | cloud |
|---|---|---|
| příprava | `bash scripts/local-setup.sh` | `bash scripts/cloud-setup.sh` |
| `‹P›` | `source ~/.onboarding-videos/env.sh && ` | (nic) |
| dlouhý běh | `‹P›caffeinate -i pnpm video …` | `pnpm video …` |

**Aktualizace (vždy jako první, i v cloudu):** `git pull --ff-only`, pak si potichu zapamatuj verzi `git log -1 --format='%h %cs'` (patří do každého hlášení, viz 5). Když pull selže (lokální změny, rozjetá historie, síť): nic nemaž, nepoužívej `reset`, `stash` ani `--force`, pokračuj se stávající verzí, řekni uživateli, že má starší verzi, a nahlas to Martinovi (viz 5). Pak příprava (spouští se pokaždé, stáhne i nové nástroje a brand fonty). První běh stahuje nástroje (pár minut), řekni to uživateli dopředu.

- `SETUP OK` → pokračuj.
- **Mac, exit 3 (`SETUP NEEDS LOGIN`)**: otevři `open -e .env` a požádej uživatele, ať v TextEditu doplní `SLONEEK_DEMO_USER` a `SLONEEK_DEMO_PASS` (svůj účet na pre-prod), uloží a dá vědět. Heslo ať nikdy nepíše do chatu. `.env` nečti. Pak přípravu pusť znovu.
- **Cloud, exit 3 (`SETUP INCOMPLETE`)**: řekni, které proměnné chybí (jen názvy), a že je musí doplnit správce Claude organizace (`docs/CLAUDE-CLOUD.md`). Dál nepokračuj.
- Jiná chyba: na Macu typicky síť nebo místo na disku, v cloudu allowlist. Řekni to lidsky.
- Ověř, že máš nástroje ElevenLabs konektoru (`creative_generate_speech`). Když ne a není ani režim API, řekni uživateli, ať si konektor připojí (viz 3b), ještě před rozhovorem.

Hodnoty tajných proměnných nikdy nevypisuj, necommituj `.env` ani `out/**/storage-state*.json`.

## 1. Rozhovor: co má video ukázat

Zjisti tyhle věci. Na pevné volby použij otázku s možnostmi, zbytek nech popsat volně. Když je uživatel vágní, pomoz mu příkladem („Třeba: zaměstnanec si zažádá o dovolenou na 3 dny a pošle ji ke schválení“).

| co | volby / příklad | povinné |
|---|---|---|
| **Téma**: co se divák naučí, od kterého místa v aplikaci po jaký výsledek | „manažer schválí žádost o absenci z přehledu“ | ano |
| **Jazyk** | `cs` / `en` / `sk` | ano (default `cs`) |
| **Publikum** | `employee` (zaměstnanec) / `manager` / `admin` | ano |
| **Název videa** | „Jak schválit absenci“ | ano (navrhni sám) |
| Ukázková data | konkrétní data, jména, poznámky, které se mají psát | ne |
| Staré video na YouTube | URL, pokud existuje starší verze návodu | ne |
| Co nedělat | např. „neodesílej žádost, jen ukaž formulář“ | ne |

Upozorni: **nahrávání probíhá na demo účtu a mění v něm data** (vytvoří absenci, uživatele…). Jestli to vadí, ať řeknou.

`id` = krátký slug z názvu (`schvaleni-absence`). Když `out/<id>/` už existuje, zeptej se, jestli navázat, nebo začít znovu (`--force`).

## 2. Scénář

**Bez starého videa (běžný případ): scénář napíšeš ty** do `out/<id>/scenario.json` podle `contracts/scenario.schema.json`. Vzor stylu: `samples/scenario.absence-request.json`.

- 6–12 kroků, `id` `s01`, `s02`…, `lang`, `audience`, `title`.
- `narration`: co říká hlas, 8–25 slov, přirozeně, oslovuj diváka, žádné čtení tlačítek písmeno po písmenu.
- `intent`: co se má v aplikaci stát, prostými slovy („v levém menu otevři Absence“). Názvy prvků UI nevymýšlej; když si nejsi jistý, popiš záměr („otevři formulář pro novou absenci“) a explorer si prvek najde.
- `must_show`: co musí být na konci kroku vidět („formulář nové absence je otevřený“).
- První krok uvádí téma, poslední shrnuje výsledek.
- **Výslovnost**: v `narration` piš normálně (HR, absence, Sloneek, sick days). Co hlas čte špatně, opravuje automaticky slovník `config/pronunciation.json` (jen v namluveném textu, titulky zůstanou správně). `narration_tts` použij jen pro výjimku v jednom kroku. Narazíš-li na nový problematický výraz, dej pravidlo do `recipe.pronunciation` (jen toto video) a navrhni ho Martinovi do společného slovníku (krok 5).

Ověř: `‹P›pnpm --filter @svp/knowledge start -- validate --scenario "$PWD/out/<id>/scenario.json"`. Chyby oprav sám, varování zvaž.

**Se starým videem:** `‹P›pnpm video run --id <id> --youtube "<url>" --lang <l> --audience <a> --title "<název>" --to knowledge`. YouTube občas cloudové servery blokuje. Když `knowledge` selže, napiš scénář ručně (viz výše) a starý obsah použij jen jako inspiraci.

**Schválení:** ukaž scénář jako tabulku (krok · co zazní · co se stane na obrazovce) a zeptej se, jestli je v pořádku. Úpravy zapracuj a ukaž znovu. Bez výslovného souhlasu nepokračuj.

## 3. Výroba videa

Výchozí je **režim plánu**: prohlížeč řídíš ty (explorer se tě ptá na každý krok) a hlas generuješ přes **ElevenLabs konektor**. Všechno jde z plánu uživatele, žádné API klíče. Dlouhé příkazy pouštěj na pozadí a průběžně stručně hlas, kde jsi („Absence mám proklikané, teď namlouvám“).

**Režim API** (rychlejší, platí ho firemní klíče) použij jen když `cloud-setup.sh` hlásí `API mode available` a uživatel o něj stojí: `pnpm pipeline run --id <id> --scenario "$PWD/out/<id>/scenario.json" --to mux` a pokračuj krokem 3d.

### 3a. Explorer (proklikání aplikace)

Do `scenario.json` přidej hlas z `config/voices.json` podle jazyka: `"voice": {"provider": "external", "voice_id": "<voice_id>", "model_id": "<model_id>"}`. Pro jazyk bez hlasu se zeptej uživatele, nebo vyber vhodný hlas přes konektor (`creative_list_voices`).

Na pozadí:

```bash
‹P›caffeinate -i pnpm video run --id <id> --scenario "$PWD/out/<id>/scenario.json" --to explore   # v cloudu bez caffeinate
```

Pak opakuj, dokud neuvidíš `FINISHED`:

```bash
‹P›node scripts/explorer-turn.mjs <id>                                                  # další požadavek explorera
‹P›node scripts/explorer-turn.mjs <id> --reply out/<id>/explorer-session/reply-<n>.json  # odpověď + čekání
```

- Požadavek (`TURN n`) obsahuje snapshot stránky a výsledky nástrojů. První tah obsahuje i systémový prompt explorera a popis nástrojů. **Ten prompt dodržuj** (selektory, minimální akce, `verify_visible`, pak `done`).
- Odpověď: soubor `{"calls":[{"name":"click","input":{"ref":5}},{"name":"snapshot","input":{}}]}`. Každý tah zapiš (Write tool) do nového souboru `out/<id>/explorer-session/reply-<n>.json` a předej ho přes `--reply`.
- `REJECTED n`: oprav odpověď podle důvodu. `WAITING`: explorer zrovna přehrává předchozí kroky v čistém prohlížeči, zavolej znovu bez `--reply`.
- Po `done` explorer krok sám nezávisle ověří replayem. Odmítnutí (`REJECTED by independent replay`) přijde jako výsledek dalšího tahu: oprav jen to, co je špatně.
- Limit je 12 volání nástrojů na krok. Šetři: snapshot jen po změně stránky, screenshot jen když se zasekneš (uloží se jako soubor, otevři ho Read toolem).
- `FINISHED` → `‹P›pnpm pipeline status --id <id>`. Selhal-li explore, viz 3e.

### 3b. Hlas přes ElevenLabs konektor

```bash
‹P›pnpm voice:manifest "$PWD/out/<id>/recipe.json" --id <id>
```

Pro každý krok v `out/<id>/audio/manifest.json` vygeneruj řeč nástrojem konektoru `creative_generate_speech`: **přesně `tts_text`** (nikdy `subtitle`), `voice_id` a `model_id` z receptu, `generations_count: 1`. `tts_text` už má použitý výslovnostní slovník (HR → „ejč ár“, absence → „apsence“…), nic v něm neupravuj a jazyk hlasu nevynucuj. Všechny kroky dej do jednoho flow (`creative_create_flow` nejdřív), pak se dotazuj `creative_get_flow_run_status`, dokud nejsou hotové. Generování neopakuj kvůli retry, každé volání stojí kredity. Do `out/<id>/audio/urls.json` zapiš:

```json
{ "voice_id": "…", "model_id": "…", "elevenlabs_flow": "<url flow>", "clips": { "s01": "<url mp3>", … }, "texts": { "s01": "<tts_text>", … } }
```

Pak `‹P›node scripts/fetch-voice.mjs <id>` (stáhne mp3 a zkontroluje, že sedí text). Podepsané odkazy brzy vyprší, takže stahuj hned.

Když konektor ElevenLabs v session není: řekni uživateli, ať si ho připojí v claude.ai → Settings → Connectors (přihlásí se svým ElevenLabs účtem) a session spustí znovu. Když hlas z `config/voices.json` v jeho účtu není dostupný: ať si ho přidá z Voice Library, nebo s ním vyber jiný.

### 3c. Nahrání a střih

Na pozadí (`pnpm video` = pipeline v režimu plánu; při selhaných krocích se sama 2× pokusí opravit a zeptá se tě):

```bash
‹P›caffeinate -i pnpm video run --id <id> --from tts --to mux   # v cloudu bez caffeinate
```

Dokud běží, volej `‹P›node scripts/explorer-turn.mjs <id>` a obsluž případné tahy (oprava kroku). `WAITING` je v pořádku. Konec poznáš podle doběhnutí příkazu na pozadí.

### 3d. Kontrola

Hotovo, když `out/<id>/final.mp4` existuje a v `out/<id>/timing.json` nejsou `failed` kroky. Otevři i `out/<id>/thumbnail.png` (YouTube náhled): screenshot v něm nesmí mít otevřený dialog se ztmaveným pozadím a titulek má mít nejvýš 2–3 řádky. Jinak nastav v receptu `"thumbnail": {"shot": "sNN", "title": "kratší název"}` a pusť jen střih (`--mux-only`). Hlasitost scén srovnává střih sám (log `[mux] loudness`). Projdi screenshoty `out/<id>/shots/sNN.png` (otevři je) a řekni uživateli, jestli všechno sedí. Titulky mají v režimu plánu rovnoměrné časování v rámci kroku (konektor nevrací časy znaků).

### 3e. Když něco selže

Přečti `out/<id>/logs/<stage>.log` a `out/<id>/timing.json`. Běh je resumable: po opravě pokračuj `--from <stage>`, ne od začátku.

- **explore**: krok nejde provést (prvek neexistuje, jiný název, chybí oprávnění či data demo účtu). Uprav `intent` ve `scenario.json`, ukaž uživateli změnu a pusť znovu `pnpm video run … --from explore`.
- **record** s `failed` kroky po 2 opravách: postupuj jako u explore.
- **tts**: chybí mp3 (manifest říká které) → dogeneruj je podle 3b.

## 4. Předání videa

- **Mac**: hotové video je v repu ve složce `videa/<id>/`: `<id>.mp4` (video), `<id>-nahled.png` (náhled pro YouTube), `<id>.srt` (titulky) a `youtube.txt` (název a popis s kapitolami ke zkopírování). `open videa/<id>` ji otevře ve Finderu. Řekni uživateli, kde je, a ukaž mu náhled.
- **YouTube** (když jsou nastavené `YT_*`, Mac i cloud), jen když o to uživatel stojí: `‹P›pnpm pipeline upload --id <id>`. Video je neveřejné (`unlisted`). Nahraje se i náhled, titulky a kapitoly v popisu (vlastní náhled YouTube přijme jen u ověřeného kanálu; když ne, log to řekne a video je v pořádku). Dej uživateli odkaz.
- **Cloud bez YouTube**: git větev. `git checkout -b video/<id>`, `git add -f out/<id>/final.mp4 out/<id>/final.srt out/<id>/scenario.json out/<id>/recipe.json`, commit, push. Dej uživateli odkaz `https://github.com/<repo>/blob/video/<id>/out/<id>/final.mp4` (tlačítko Download). **Repo je veřejné**, upozorni, že video tím uvidí kdokoli s odkazem.

Na konci shrň: název, délka, počet kroků, odkaz, a co případně doporučuješ zkontrolovat.

## 5. Hlášení Martinovi (změny, chyby, nápady)

Martin Smolík (martin.smolik@sloneek.com) spravuje pipeline. Změny repa dělá jen on, kolegové si je stáhnou při dalším spuštění (krok 0). Nahlas mu:

- chybu v kódu pipeline nebo krok, který nejde opravit úpravou scénáře či receptu,
- slovo, které hlas čte špatně (navrhni rovnou pravidlo do `config/pronunciation.json`, např. `{ "match": "ATS", "say": "á té es" }`; pro aktuální video ho mezitím dej do `recipe.pronunciation`),
- nepovedený `git pull` (krok 0),
- přání nebo nápad kolegy (nové video, jiný vzhled, chybějící funkce).

Jak: napiš krátkou zprávu česky, nejdřív ji ukaž uživateli a pošli až s jeho souhlasem. Když je v session Slack konektor, pošli ji Martinovi do DM, jinak ji dej uživateli ke zkopírování (Slack nebo e-mail). Obsah:

```
[onboarding-videos] <video id> · <jméno kolegy> · verze <hash datum>
Co se stalo: <1–2 věty>
Kde: <stage / krok sNN>, chyba: <1 řádek z logu bez tajných údajů>
Návrh: <oprava / pravidlo / nápad>
```

Do zprávy nikdy nedávej hesla, obsah `.env` ani `storage-state*.json`.

## Hranice

- Kód pipeline během výroby videa neměň a do gitu nic necommituj ani nepushuj (výjimka: větev `video/<id>` v cloudu, krok 4). Chyby a návrhy hlas Martinovi (krok 5).
- Na produkční Sloneek (`app.sloneek.com`) s reálnými daty klientů nenahrávej, jen na demo/pre-prod účet z `SLONEEK_DEMO_URL`.
- Když si nejsi jistý, jak se něco v aplikaci jmenuje nebo kam má video vést, zeptej se uživatele, nehádej.
