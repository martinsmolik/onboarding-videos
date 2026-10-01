---
name: onboarding-video
description: Vyrobí onboardovací video (screencast s hlasem a titulky) pro aplikaci Sloneek z tématu, které zadá kolega. Provede ho rozhovorem, napíše scénář ke schválení, nechá agenta proklikat reálnou aplikaci, namluví, nahraje, sestříhá a vrátí odkaz na video. Použij, když někdo chce nové nebo aktualizované návodné video, napíše /onboarding-video, „udělej video o…“, „natoč návod na…“.
---

# Onboardovací video ze zadání

Uživatelé jsou kolegové ze Sloneeku, většinou **netechničtí**. Mluv s nimi česky (nebo jazykem, kterým píšou), bez žargonu. Nikdy po nich nechtěj terminál, příkazy ani soubory. Všechno spouštíš ty. Technické detaily (logy, cesty, exit kódy) jim neukazuj, jen to, co z nich plyne.

Celá pipeline je popsaná v `README.md` a `docs/TEAM-ONBOARDING.md`. Pořadí stagí: `knowledge > explore > tts > record > mux > upload`. Vše se ukládá do `out/<id>/`.

## 0. Příprava prostředí (vždy, potichu)

```bash
bash scripts/cloud-setup.sh
```

- `SETUP OK` → pokračuj.
- Exit 3 (`SETUP INCOMPLETE`) → řekni uživateli, které proměnné chybí (jen názvy), a že je musí doplnit správce Claude organizace v nastavení cloud prostředí (návod: `docs/CLAUDE-CLOUD.md`). Dál nepokračuj.
- Ověř, že máš nástroje ElevenLabs konektoru (např. `creative_generate_speech`). Když ne a není ani režim API, řekni uživateli, ať si konektor připojí (viz 3b), ještě před rozhovorem.
- Jiná chyba → typicky síť (allowlist). Řekni, která doména asi chybí, a odkaž na `docs/CLAUDE-CLOUD.md`.

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

Ověř: `pnpm --filter @svp/knowledge start -- validate --scenario "$PWD/out/<id>/scenario.json"`. Chyby oprav sám, varování zvaž.

**Se starým videem:** `pnpm pipeline run --id <id> --youtube "<url>" --lang <l> --audience <a> --title "<název>" --to knowledge`. YouTube občas cloudové servery blokuje. Když `knowledge` selže, napiš scénář ručně (viz výše) a starý obsah použij jen jako inspiraci.

**Schválení:** ukaž scénář jako tabulku (krok · co zazní · co se stane na obrazovce) a zeptej se, jestli je v pořádku. Úpravy zapracuj a ukaž znovu. Bez výslovného souhlasu nepokračuj.

## 3. Výroba videa

Výchozí je **režim plánu**: prohlížeč řídíš ty (explorer se tě ptá na každý krok) a hlas generuješ přes **ElevenLabs konektor**. Všechno jde z plánu uživatele, žádné API klíče. Dlouhé příkazy pouštěj na pozadí a průběžně stručně hlas, kde jsi („Absence mám proklikané, teď namlouvám“).

**Režim API** (rychlejší, platí ho firemní klíče) použij jen když `cloud-setup.sh` hlásí `API mode available` a uživatel o něj stojí: `pnpm pipeline run --id <id> --scenario "$PWD/out/<id>/scenario.json" --to mux` a pokračuj krokem 3d.

### 3a. Explorer (proklikání aplikace)

Do `scenario.json` přidej hlas z `config/voices.json` podle jazyka: `"voice": {"provider": "external", "voice_id": "<voice_id>", "model_id": "<model_id>"}`. Pro jazyk bez hlasu se zeptej uživatele, nebo vyber vhodný hlas přes konektor (`creative_list_voices`).

Na pozadí:

```bash
EXPLORER_DRIVER=session SVP_TIMEOUT_EXPLORE_MS=14400000 pnpm pipeline run --id <id> --scenario "$PWD/out/<id>/scenario.json" --to explore
```

Pak opakuj, dokud neuvidíš `FINISHED`:

```bash
node scripts/explorer-turn.mjs <id>                         # vypíše další požadavek explorera
node scripts/explorer-turn.mjs <id> --reply /tmp/reply.json # tvoje odpověď + čekání na další
```

- Požadavek (`TURN n`) obsahuje snapshot stránky a výsledky nástrojů. První tah obsahuje i systémový prompt explorera a popis nástrojů. **Ten prompt dodržuj** (selektory, minimální akce, `verify_visible`, pak `done`).
- Odpověď: soubor `{"calls":[{"name":"click","input":{"ref":5}},{"name":"snapshot","input":{}}]}`. Každý tah píšeš do nového souboru (Write tool) a předáš ho přes `--reply`.
- `REJECTED n`: oprav odpověď podle důvodu. `WAITING`: explorer zrovna přehrává předchozí kroky v čistém prohlížeči, zavolej znovu bez `--reply`.
- Po `done` explorer krok sám nezávisle ověří replayem. Odmítnutí (`REJECTED by independent replay`) přijde jako výsledek dalšího tahu: oprav jen to, co je špatně.
- Limit je 12 volání nástrojů na krok. Šetři: snapshot jen po změně stránky, screenshot jen když se zasekneš (uloží se jako soubor, otevři ho Read toolem).
- `FINISHED` → `pnpm pipeline status --id <id>`. Selhal-li explore, viz 3e.

### 3b. Hlas přes ElevenLabs konektor

```bash
pnpm voice:manifest "$PWD/out/<id>/recipe.json" --id <id>
```

Pro každý krok v `out/<id>/audio/manifest.json` vygeneruj řeč nástrojem konektoru `creative_generate_speech`: **přesně `tts_text`** (nikdy `subtitle`), `voice_id` a `model_id` z receptu. Všechny kroky dej do jednoho flow, pak se dotazuj `creative_get_flow_run_status`, dokud nejsou hotové. Do `out/<id>/audio/urls.json` zapiš:

```json
{ "voice_id": "…", "model_id": "…", "elevenlabs_flow": "<url flow>", "clips": { "s01": "<url mp3>", … }, "texts": { "s01": "<tts_text>", … } }
```

Pak `node scripts/fetch-voice.mjs <id>` (stáhne mp3 a zkontroluje, že sedí text). Podepsané odkazy brzy vyprší, takže stahuj hned.

Když konektor ElevenLabs v session není: řekni uživateli, ať si ho připojí v claude.ai → Settings → Connectors (přihlásí se svým ElevenLabs účtem) a session spustí znovu. Když hlas z `config/voices.json` v jeho účtu není dostupný: ať si ho přidá z Voice Library, nebo s ním vyber jiný.

### 3c. Nahrání a střih

Na pozadí (`EXPLORER_DRIVER=session`, protože při selhaných krocích se pipeline sama 2× pokusí opravit a zeptá se tě):

```bash
EXPLORER_DRIVER=session SVP_TIMEOUT_EXPLORE_MS=14400000 pnpm pipeline run --id <id> --from tts --to mux
```

Dokud běží, volej `node scripts/explorer-turn.mjs <id>` a obsluž případné tahy (oprava kroku). `WAITING` je v pořádku. Konec poznáš podle doběhnutí příkazu na pozadí.

### 3d. Kontrola

Hotovo, když `out/<id>/final.mp4` existuje a v `out/<id>/timing.json` nejsou `failed` kroky. Projdi screenshoty `out/<id>/shots/sNN.png` (otevři je) a řekni uživateli, jestli všechno sedí. Titulky mají v režimu plánu rovnoměrné časování v rámci kroku (konektor nevrací časy znaků).

### 3e. Když něco selže

Přečti `out/<id>/logs/<stage>.log` a `out/<id>/timing.json`. Běh je resumable: po opravě pokračuj `--from <stage>`, ne od začátku.

- **explore**: krok nejde provést (prvek neexistuje, jiný název, chybí oprávnění či data demo účtu). Uprav `intent` ve `scenario.json`, ukaž uživateli změnu a pusť znovu `--from explore` (v režimu plánu s `EXPLORER_DRIVER=session …`).
- **record** s `failed` kroky po 2 opravách: postupuj jako u explore.
- **tts**: chybí mp3 (manifest říká které) → dogeneruj je podle 3b.

## 4. Předání videa

- **YouTube** (když jsou nastavené `YT_*`): `pnpm pipeline upload --id <id>`. Video je neveřejné (`unlisted`), dej uživateli odkaz. Kapitoly jsou v `out/<id>/chapters.txt`.
- **Jinak git větev**: `git checkout -b video/<id>`, `git add -f out/<id>/final.mp4 out/<id>/final.srt out/<id>/scenario.json out/<id>/recipe.json`, commit, push. Dej uživateli odkaz `https://github.com/<repo>/blob/video/<id>/out/<id>/final.mp4` (tlačítko Download). **Repo je veřejné**, upozorni, že video tím uvidí kdokoli s odkazem.

Na konci shrň: název, délka, počet kroků, odkaz, a co případně doporučuješ zkontrolovat.

## Hranice

- Kód pipeline během výroby videa neměň. Když narazíš na chybu v kódu, popiš ji a navrhni, ať ji opraví správce repa.
- Na produkční Sloneek (`app.sloneek.com`) s reálnými daty klientů nenahrávej, jen na demo/pre-prod účet z `SLONEEK_DEMO_URL`.
- Když si nejsi jistý, jak se něco v aplikaci jmenuje nebo kam má video vést, zeptej se uživatele, nehádej.
