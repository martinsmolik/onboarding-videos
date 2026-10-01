# Checklist před publikací – Absence (scénář `scenarios/cs/absence.json`)

Kontrola scénáře podle „Checklistu před publikací“ z `kostra-videonavodu.txt`, stav k 2026-10-01 (scénář hotový, video ještě nenatočené).
Legenda: **✓** splněno ve scénáři · **✗** nesplněno · **needs-recording** ověří se až na nahrávce nebo v živém UI.

## Obsah

| Položka | Stav | Poznámka |
|---|---|---|
| Divák do 30 s ví, o jaký modul jde a k čemu je | ✓ | s01 hook v první větě, modul pojmenovaný ve 2. větě; s02 definice. Do 30 s je řečeno cca 55 slov |
| Každý klik je okomentovaný (co dělám → co to znamená → proč) | ✓ | Každý klikací krok s04–s25 má všechny tři části. Nejslabší je s16 a s17 (proč je jen naznačené); stačí, jde o samovysvětlující kroky |
| Názvy tlačítek a menu odpovídají aktuální verzi aplikace | needs-recording | České popisky z UI 2026 nejsou ověřené: help je z roku 2024 a živé UI bylo prozkoumáno jen v EN. Seznam je v `notes` u s02, s05, s12, s14–s18, s21, s23, s28 |
| Ukázka stojí na reálné situaci, ne na prohlídce menu | ✓ | Eliška si bere dovolenou (s14–s20), Eliška je nemocná (s21–s22), podklady pro mzdy (s24–s25) |
| Všechna fakta a čísla jsou ověřená | ✗ (2 otevřené) | Ověřeno: § 213 ZP (4 týdny), Volno/V práci, Zdravotní důvody, nelze měnit jednotku a fond. **Otevřené:** jednotka ročního fondu (dny, nebo hodiny – s08) a jednotka časového omezení (s09). Tvrzení „V práci + nemocenská“ z briefu je opravené |
| Závěr má jeden jasný další krok a odkaz na další video | ✓ | s27 úkol (projít typy se mzdovou účetní + Fond pro tento rok), s29 most „docházka a příchody“ |

## Technika

| Položka | Stav | Poznámka |
|---|---|---|
| V záběrech nejsou skutečná osobní data | needs-recording | Scénář používá jen fiktivní persony. Na pre-prod je ale vidět jméno admina „Thomas Claver“ a seznam uživatelů (s12, s21–s23). Před publikací zkontrolovat, že jde o demo účty, jinak rozmazat |
| Rozlišení 1080p, čistý prohlížeč, kurzor zvýrazněný | needs-recording | Průzkum proběhl při 1456×868. Coach-mark „Make it yours!“ na Ploše (s01) |
| Vystřižené načítání a pauzy, délka v rámci 4–8 min | ✓ / needs-recording | Text má 795 slov ≈ 5,7 min při 140 wpm. S pauzami po kliknutí vyjde video zhruba na 6,5–7 min, tedy uvnitř 4–8 min. Načítání mzdového reportu (s24) vystřihnout |
| Titulky; čísla a zkratky pro AI hlas; jeden průvodce v jednotném rodu, divák neutrálně | ✓ | `subtitle` = běžný zápis, `narration_tts` = fonetika (há er, sik dej, Sloník, gůgl, autluk, Elí). V textu nejsou číslice. Marie mluví v ženském rodu (administrátorka, napíšu, kliknu). Divák je oslovený neutrálně (vidíte, vyplňte, umíte). Výslovnost „gůgl / autluk / Elí“ poslechnout na první TTS verzi |
| Úvodní a závěrečná karta v brandu Sloneek | needs-recording | Karty jsou předepsané v `zoom` u s01 a s29. Mezititulky 2 / 3 / 4 (část 4 je vynechaná, závěr je proto „4 / Závěr“) |

## Publikace

| Položka | Stav | Poznámka |
|---|---|---|
| Kapitoly s časovými značkami v popisu na YouTube | needs-recording | Kapitoly podle `part`: Úvod (s01), Nastavení (s04), Ukázka využití (s14), Závěr (s26). Časy dodá timing po nahrání |
| Odkazy na nápovědu a onboarding portál v popisu | ✓ (podklad) | Články jsou v `source.references`. Onboarding portál doplní ten, kdo video publikuje |
| Video vložené do správné sekce onboarding portálu | needs-recording | Katalog: `absences` „Nastavte a spravujte absence“ (admin téma, sedí) |
| Schváleno vlastníkem modulu (produkt / customer success) | ✗ | Čeká na schválení. Doporučuji ukázat CS (Anna) hlavně s07 (Volno / V práci) a s11 (Uložit pro všechny) |

## Pravidla z „Obecných pravidel“ briefu (navíc)

| Pravidlo | Stav |
|---|---|
| Vykání, přátelský věcný tón, krátké věty | ✓ |
| Žádné superlativy, žádná citoslovce | ✓ (bez „nejlepší“, „bomba“, „snadno“) |
| Humor 1–2×, jen v úvodu a závěru, ne na účet zaměstnanců | ✓ jeden vtip v s29 („jdu se podívat, kolik dní dovolené mi zbývá“). Vtip briefu „polovina firmy u moře“ jsem vynechala, protože padal doprostřed postupu |
| Průvodce se v úvodu představí jménem a rolí | ✓ s01 („Jsem Marie z týmu Sloneek“). Konkrétní roli Marie brief neuvádí |
| Pokročilá nastavení jen zmínit a odkázat | ✓ (týdenní akrual, import zůstatků a CZ/SK typy jsou jen v knowledge briefu) |
| Část 4 vynechaná a zmíněná jednou větou v závěru | ✓ s27 |
| Podíl částí (10 / 25 / 40 / 10 %) | ~ Úvod 11 %, Nastavení 37 %, Ukázka 37 %, Závěr 15 %. Nastavení je delší, protože video je pro admina a část 4 chybí. Pokud se má zkrátit, první kandidáti jsou s10 a s13 |
