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

```bash
pnpm pipeline run --id <id> --scenario "$PWD/out/<id>/scenario.json" --to mux
```

Trvá jednotky až desítky minut (explorer prochází aplikaci krok po kroku, pak hlas, nahrávání a střih). Pusť to na pozadí a průběžně stručně hlas, kde jsi („aplikaci mám prošlou, teď nahrávám“). Stav: `pnpm pipeline status --id <id>`. Běh je resumable. Po opravě pokračuj `--from <stage>`, ne od začátku.

Když stage selže, přečti `out/<id>/logs/<stage>.log` a `out/<id>/timing.json`:

- **explore**: krok nejde v aplikaci provést. Zjisti proč (prvek neexistuje, jiný název). Uprav `intent` v `scenario.json`, ukaž uživateli změnu a pusť znovu `--from explore`. Když problém vypadá jako chybějící oprávnění nebo data demo účtu, řekni to uživateli lidsky.
- **record** s `failed` kroky: pipeline se sama 2× pokusí opravit (heal). Když nestačí, postupuj jako u explore.
- **tts**: klíč nebo hlas ElevenLabs (viz `docs/CLAUDE-CLOUD.md`).

Hotovo, když `out/<id>/final.mp4` existuje a v `timing.json` nejsou `failed` kroky. Zkontroluj screenshoty `out/<id>/shots/sNN.png` (podívej se na ně) a uživateli řekni, jestli vše sedí.

## 4. Předání videa

- **YouTube** (když jsou nastavené `YT_*`): `pnpm pipeline upload --id <id>`. Video je neveřejné (`unlisted`), dej uživateli odkaz. Kapitoly jsou v `out/<id>/chapters.txt`.
- **Jinak git větev**: `git checkout -b video/<id>`, `git add -f out/<id>/final.mp4 out/<id>/final.srt out/<id>/scenario.json out/<id>/recipe.json`, commit, push. Dej uživateli odkaz `https://github.com/<repo>/blob/video/<id>/out/<id>/final.mp4` (tlačítko Download). **Repo je veřejné**, upozorni, že video tím uvidí kdokoli s odkazem.

Na konci shrň: název, délka, počet kroků, odkaz, a co případně doporučuješ zkontrolovat.

## Hranice

- Kód pipeline během výroby videa neměň. Když narazíš na chybu v kódu, popiš ji a navrhni, ať ji opraví správce repa.
- Na produkční Sloneek (`app.sloneek.com`) s reálnými daty klientů nenahrávej, jen na demo/pre-prod účet z `SLONEEK_DEMO_URL`.
- Když si nejsi jistý, jak se něco v aplikaci jmenuje nebo kam má video vést, zeptej se uživatele, nehádej.
