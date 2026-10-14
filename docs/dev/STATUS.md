# Onboarding videa – pracovní stav

Čti na začátku každého chatu. Na konci každého videa aktualizuj sekce **Fronta** a **Měření**. Stav videí téma × jazyk je v `docs/dev/VIDEO-STATUS.md` (generuje skript, ručně neupravovat).

## Jak to funguje
- Postup řídí skill `onboarding-video` uložený v účtu (instrukce pro Clauda). Kód v repu spouští stage: knowledge → explore → tts → record → mux.
- **Cowork (Martinův běžný režim):** shell ve virtuálu nedosáhne na BrowserOS ani na pre-prod. Claude proto proklikává aplikaci nástroji BrowserOS neo, recept píše ručně a nahrání se střihem spouští Martin jedním příkazem v terminálu na Macu.
- Model je potřeba jen na scénář, proklikání, hlas přes ElevenLabs, opravy selhaných kroků a kontrolu. Nahrávání a střih běží bez modelu.
- Všechno, co Claude v chatu přečte (snapshoty BrowserOS, screenshoty, logy), zůstává v historii. Proto jedno video = jeden chat a proklikání v subagentech.

## Model
| Práce | Režim | Model |
|---|---|---|
| Jazyková verze převzetím receptu | Cowork | Sonnet 5.5 Medium |
| Nové téma (scénář + explorer) | Cowork | Sonnet 5.5 Medium; když explorer opakovaně selže na stejném kroku, High |
| Změna kódu pipeline, ladění | Cowork, samostatný chat | Opus 5.5 High |
| Dotaz, plánování | Chat (bez složky) | Sonnet 5.5 |

Fable a Opus se na výrobu videí nepoužívají.

## Konektory ve video chatu
| Konektor | Jazyková verze (převzetí) | Nové téma |
|---|---|---|
| ElevenLabs | zapnutý | zapnutý |
| Notion | zapnutý | zapnutý |
| BrowserOS neo | jen když nahrávání selže a je potřeba opravit krok | zapnutý |
| Modjo | vypnutý | jen když je potřeba produktový kontext |

Ostatní vypnuté: Slack, Gmail, Drive, web search, Research, Claude in Chrome.

## Pravidla výroby
- Jedno video = jeden chat.
- Žádné zkušební běhy `rehearse-*`. Nahrává se rovnou finální id, opravuje se jen první selhaný krok a nahrává znovu.
- **Jazyková verze** tématu s hotovou češtinou: převzít `out/<téma>/recipe.json`, přeložit naraci (narration, subtitle, narration_tts) s názvy UI z `docs/ui-glossary.md`, nastavit `lang` a hlas, jazyk aplikace jako v existujících `-en`/`-pl` receptech, pak tts → record → mux. Explorer jen na kroky, které selžou. Když název v glosáři chybí (`?`), popsat akci bez přesného názvu tlačítka.
- **Kontrola (3d):** otevřít jen `thumbnail.png` a screenshoty kroků, které selhaly nebo byly opravené. Ne všechny.
- Logy číst jen konec (`tail -50`), ne celé.
- **Notion:** jeden zápis na konci videa. Najít řádek podle Catalog ID, zapsat stav jazykové verze a odkaz.
- **Na konci videa:** `node scripts/video-status.mjs > docs/dev/VIDEO-STATUS.md`, přidat řádek do Měření, posunout Frontu a napsat „Uloženo: <cesty>".

## Poučení
- Názvy z dat demo účtu (aktivity, složky, šablony, jména) se nepřekládají, patří do `keep` v i18n.
- ag-grid: připnutý sloupec není v `.ag-center-cols-container`, řádek hledej podle textu, který v center kontejneru je.
- Text z hlavičky tabulky (`thead`) v řádcích `tbody` není.
- U highlightu stačí kontejner (karta, řádek), ne vnořený div přes přímé potomky.
- clockins-vs-tracking s11/s12 potřebují data v minulém měsíci (v demu září, říjen je prázdný). Od listopadu před nahráním ověřit.

## Fronta
1. Ostatní jazykové verze převzetím, seznam v `VIDEO-STATUS.md`. Před `surveys-en`/`-pl` ověřit v Notionu, proč je surveys v To Do, když česká verze existuje.
2. Nová témata: nejdřív cs plnou výrobou, pak en/pl převzetím. collect-data, onboarding-checklists, ats-candidates, okr-kpi, feedback-360, ai-agent, ai-features, integrations.

## Měření
| datum | video | režim | model | usage před | usage po | poznámka |
|---|---|---|---|---|---|---|
| 2026-10-14 | clockins-vs-tracking-en | Cowork, příprava s hlasem (recept z CS, BrowserOS na 7 názvů UI, ElevenLabs 37 klipů, 4 409 znaků) | Sonnet 5.5 | 0 % | doplnit | Martin doplní „po přípravě“ |
| 2026-10-14 | clockins-vs-tracking-en | Cowork, oprava 4 kroků (s04, s11, s12, s20; 3 subagenti na BrowserOS) a kontrola | Sonnet 5.5 | doplnit | doplnit | nahrání doběhlo bez failed kroků, 5:16 |

## Otevřené otázky
- Běhy `rehearse-*` (23×) byly zkušební nahrávky ručně psaných receptů. Nový skill je zakazuje.
- surveys: česká verze existuje, Notion ji má v To Do.
- Režim API (Sonnet, čistý kontext na každý krok, cena logovaná po krocích) vs. režim plánu. Rozhoduje Jan s Filipem.
- Připravená změna kódu: explorer po krocích v subagentech (`system.md`, `explorer-turn --peek`). Zatím nenasazená.
