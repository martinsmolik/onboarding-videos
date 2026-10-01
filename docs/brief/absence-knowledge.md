# Absence (Řízení času) – knowledge brief pro scénář

Podklad pro `scenarios/cs/absence.json`. Sestaveno 2026-10-01 z Modjo nahrávek (školení a implementační cally Sloneek), z českého help centra a ze vzorového scénáře v `kostra-videonavodu.txt`. Klientské cally jsou jen zdroj znalostí: do scénáře nejdou jména klientů ani osobní data.

Legenda: **✓ ověřeno** (help článek + call, nebo živé UI), **~ částečně** (jen jeden zdroj, nebo popisek z 2024), **? ověřit v UI**.

---

## 1. Nastavení typu absence (admin / HR)

**Cesta:** Nastavení → Absence → **Přidat** (úprava existujícího typu: ikona tužky). ~ Cesta pochází z help článku z roku 2024. Menu 2026 neověřeno.

| # | Klik / pole | Co to znamená | Proč na tom záleží | Doporučení | Zdroj |
|---|---|---|---|---|---|
| 1 | Filtr **Aktivní** nad seznamem | Seznam ukazuje jen aktivní typy | Deaktivované typy se zdají „ztracené“ | Při hledání starého typu přepnout filtr | Investika Onboarding ~00:04:43 ✓ |
| 2 | **Název** (interní), **český / slovenský / anglický název**, **Poznámka** | Interní název vidí admin, jazykové verze vidí uživatelé | Každý vidí aplikaci ve svém jazyce | Pro CZ/SK firmy oddělit typy (např. „Dovolená CZ“) | help 14888168374556 ✓; U lékaře ~00:38:52 |
| 3 | **Typ: Volno / V práci** | Volno **zkracuje** odpracovanou dobu, V práci ji **nemění** | Přímo mění mzdový report: čistý fond = hrubý fond − délka absencí typu Volno. Špatně zvolené V práci = např. stravenky navíc | Dovolená, nemocenská, mateřská = Volno. Sick day placený jako práce = V práci | help ✓; Form Factory ~00:08:01–00:09:36; Investika ~00:07:24 (stravenky); U lékaře ~00:38:15, ~00:43:10 |
| 4 | **Časová jednotka čerpání:** Dny a půl dny / Dny / Hodiny | Po jakých kouscích se absence čerpá | Půlden potřebují lidé u dovolené. Sick day bývá jen po celých dnech | Dovolená: Dny a půl dny | help ✓; U lékaře ~00:38:15 |
| 5 | **Roční fond** ano/ne + počet jednotek | Roční nárok | Bez fondu se jen eviduje (např. mateřská) | Dovolená: fond ano | help ✓ |
| 6 | **Nevyčerpané jednotky se převádí do dalšího roku** | Převod zbytku do dalšího roku | Konec roku bez ručních úprav | U dovolené obvykle ano | help ✓; U lékaře ~00:38:36 |
| 7 | **Zdravotní důvody** | Pro nemocenskou / OČR (ošetřování člena rodiny), počítá se v **kalendářních** dnech | Nemoc běží i přes víkend | U dovolené vypnuto | help ✓; Form Factory ~00:00:57, ~00:13:26 |
| 8 | **Časové omezení** | Do kdy nejpozději lze absenci zadat: kladné číslo = předem, záporné = zpětně | Např. dovolenou zadat aspoň týden předem | Dovolená: 7 (jednotka ? ověřit) | help ✓ |
| 9 | **Uložit** vs **Uložit pro všechny uživatele** | Uložit = uloží jen nastavení typu. Uložit pro všechny = nastaví stav (povoleno) všem uživatelům | Typ se omylem objeví lidem, kterým nepatří (CZ typy u SK lidí) | Pro všechny jen typy, které opravdu platí pro všechny | BDO Latvia ~00:03:51–00:04:52; Reporty mzdy ~00:19:10 ✓ |
| 10 | Stav **aktivní / neaktivní** | Deaktivace skryje typ uživatelům, historie zůstane | Mazání by smazalo historii | Nemazat, deaktivovat | U lékaře ~00:38:05; Investika ~00:00:52 ✓ |

**Častá chyba (do videa):** **Časovou jednotku a roční fond nelze po vytvoření změnit** (help ✓). Typ, který už je přiřazený, se nedá upravit (Investika ~00:03:05). Postup: deaktivovat starý typ → založit nový (duplikovat) → znovu přiřadit lidem. Jen budoucí absence, minulé nechat kvůli mzdám (Investika ~00:11:08).

**Další poznatky (do videa se nevešly):**
- Fond je **roční nebo týdenní** (týdenní akrual „Accrual weekly“), ne měsíční (Form Factory ~00:04:29; BDO ~00:25:13). Když se typ změní, akrual začne znovu od nuly → doplnit Fond pro tento rok (BDO ~00:25:39).
- Pozor u hodinového fondu: filtr S ročním fondem / Bez ročního fondu se u hodinových fondů choval chybně. Anna ho označila jako bug (Form Factory ~00:15:42).
- Služební cesta a home office jsou **aktivity**, ne absence (U lékaře ~00:43:20). Školení na půldny je lepší jako absence než jako hodinová aktivita, jinak vzniká „8,5 h“ (Reporty mzdy ~00:15:16–00:17:21).
- U typu **V práci** se zaměstnanec musí „odpípnout“ v příchodech a odchodech (help 14888168374556).

## 2. Přiřazení lidem a nároky

**Individuálně:** Uživatelé → karta uživatele → záložka **Přehled absencí** → **Zobrazit nastavení pro absence a roční fondy** → sloupec **Povolení / Povolit** + **Nutné schválení** → **Uložit**. (help 14888143255708, 14888167593372 ~ 2024; BDO ~00:05:57 tuto cestu preferuje.)

**Hromadně:** Nastavení → **Hromadné nastavení absencí**. Sloupce:
- **Individuální fond:** přepíše roční fond u jednoho člověka. „Nejsilnější volba.“ Jen pro výjimky (např. vedení s 25 dny), ne pro senioritu (BDO ~00:08:15, ~00:09:50).
- **Fond pro tento rok:** letošní nárok (poměrná část při nástupu během roku). **Při migraci vyplnit hlavně tohle** (BDO ~00:24:45, ~00:34:29).
- **Vyčerpáno:** čerpání mimo kalendář.
- **Převedeno z loňska:** zbytek z minulého roku.

? Ověřit: zda je **Nutné schválení** i v hromadném nastavení (brief to tvrdí, help ho uvádí jen v kartě uživatele).
Omezení: import zůstatků z Excelu ani hromadné zapínání/vypínání přes Sloneek Intelligence zatím neexistuje, je to na roadmapě (BDO ~00:27:28–00:29:44). Migrace se dělá skriptem přes podporu. Název typu v importu musí přesně odpovídat názvu v Sloneeku (U lékaře ~00:01:25).

## 3. Žádost zaměstnance (UI 2026, ověřeno na pre-prod v EN)

Já → **Moje absence** (`/app/my-profile/absence-overview`, záložka Přehled absencí) → karty zůstatků → **Nová absence** → pole **Absence** (vyhledávání) → **Půlden / Celé dny** → **Od / Do** (jen přes datepicker) → automatická **Kontrola události** („Počet dní“, „Čerpání fondu“; při kolizi červené upozornění a **Vytvořit** zůstane neaktivní) → **Poznámka k absenci** → **Vytvořit** → záznam v **Nadcházející absence** se stavem.
- EN popisky jsou ✓ (recipes/absence-request.en.notes.md). České popisky jsou ? překlad, ověřit v CZ UI.
- Starý help (2024) popisuje tlačítko **Zkontrolovat**. V novém UI běží kontrola sama.
- Stav: čeká na schválení = **oranžová**, schváleno = **zelená**. **Zůstatek se sníží až po schválení** (Úvodní školení HRIS ~00:08:45). ? barvy v UI 2026.
- Zrušení: neschválenou absenci zrušíte rovnou, schválenou musí zrušení schválit manažer (Úvodní školení HRIS ~00:09:52; TL školení ~00:17:46).
- Zadat ji jde i z **Plochy** (panel Nová absence), z kalendáře (tažením myší) a z mobilní aplikace (help 14888080081436; TL školení ~00:04:57).

**Admin za jiného:** Nová absence → přepínač **Jiný uživatel** → vybrat člověka (admin nebo manažer). Help 14888167593372 ~, v UI 2026 ? ověřit.
**Self-approval adminů:** admin má v dialogu volbu **Automaticky schválit / Poslat ke schválení**. Doporučení: u vlastní dovolené poslat ke schválení (TL školení ~00:22:57–00:24:13). Na pre-prod se žádosti Thomase Clavera schvalují samy („Approved by superior“).

## 4. Manažer (pro větu v závěru / budoucí video)

Plocha → sekce **Schvalování** (absence i aktivity) → **Schválit / Zamítnout**, komentář před rozhodnutím. Jde schvalovat i hromadně. Notifikace e-mailem, na webu a v mobilu. Týmový přehled na Ploše: **Kdo dnes čerpá absenci**, **Kdo bude chybět v následujících 14 dnech**. Absence podřízenému jde naplánovat z jeho profilu (TL školení ~00:08:37–00:18:24; Školení pro manažery 30. 9. 2026).
**Nejčastější problém zavádění:** manažeři se nepřihlásí a nic neschvalují → frustrace zaměstnanců. Řešení: oznámení na Ploše, AI asistent, admin dočasně zastoupí (TL školení ~00:27:27). Schvalovatel docházky a manažer můžou být v organizační struktuře různé osoby (~00:25:16).

## 5. Kalendář a reporty pro mzdy

- **Kalendáře → Absence:** měsíc / týden / timeline, filtr událostí a uživatelů. **Celkový přehled** ukazuje vždy jen jednoho uživatele (help 14888149308060 ~). Filtr podle týmu ? ověřit.
- **Reporty → Vlastní reporty → Komplexní mzdový report:** **Hrubý pracovní fond**, **Délka absencí** (typ Volno), **Čistý pracovní fond**, volitelně Celková hodnota stravenek. **Přehled absencí:** Stav, Typ (Volno / V práci), Začátek, Konec, Délka. Export **Excel / CSV**. **Uložit jako report**, **Zveřejnit report** → záložky **Vytvořeno mnou / Veřejné** (Reporty mzdy ~00:04:16–00:33:50).
- **Častá chyba:** zaškrtnutí sloupce **Aktivní** v levém panelu jen zobrazí sloupec. Filtr se nastavuje v řádku filtrů nad tabulkou (Aktivní = Ano) (Reporty mzdy ~00:04:52–00:05:20).
- **Propojení kalendáře:** schválené absence se propíšou do Outlooku (Úvodní školení HRIS ~00:12:14) nebo do Google kalendáře (TL školení ~00:18:24). Outlook vyžaduje IT (Školení – změna HR systému, 2026-05-05). Formulaci briefu „propíšou se jako Mimo kancelář“ zdroje **nepotvrzují**, proto je ze scénáře vynechaná.

## 6. Fakta k ověření – rozhodnutí

| Tvrzení | Verdikt | Zdroj |
|---|---|---|
| Brief: „V práci … nemocenská“ (původní skript) | **Nesedí.** Nemocenská = **Volno** + **Zdravotní důvody** (kalendářní dny). V práci = typ, který odpracovanou dobu nemění (help: návštěva lékaře, sick hour; v praxi i placený sick day) | help 14888168374556; U lékaře ~00:39:02, ~00:43:10; Form Factory ~00:13:26 |
| Vzor briefu: „V práci – hodí se pro návštěvu lékaře“ | **Záleží na firmě.** Help ho uvádí jako V práci, Form Factory má Lékaře jako Volno se zdravotními důvody. Ve videu je proto příkladem sick day a v závěru zazní výzva projít typy se mzdovou účetní | help; Form Factory ~00:21:18 |
| Vzor briefu: „roční fond dvě stě hodin“, „zbývá osmdesát hodin“ | **Jednotka fondu ? ověřit.** Pre-prod „Vacation (days)“ má zůstatek ve dnech. Ve scénáři je 20 dní, s alternativou 160 hodin | EN notes; U lékaře ~00:38:15 |
| „Uložím a rovnou povolím pro všechny“ | Funkce existuje, ale je to častý zdroj chyb → ve videu jen vysvětlena, kliká se na **Uložit** | BDO, Reporty mzdy |
| Bez pracovní doby absenci zadat nejde | ~ brief + README preconditions. Ověřit na uživateli bez pracovní doby | brief |
| Zákon: dovolená nejméně 4 týdny ročně | ✓ § 213 odst. 1 zákoníku práce (pracovní poměr) | zákon č. 262/2006 Sb. |
| Eliška je nemocná → admin zadá „za jiného uživatele“ | ✓ funkce (help 2024), ? popisek přepínače v UI 2026 | help 14888167593372 |

## 7. Zdroje

**Modjo (kliknutí a vysvětlení prezentují lidé ze Sloneeku: Anna, Patrik, Alexandra):**
1. *Sloneek/U lékaře: sync*, 2026-05-14 (call 7826). Nastavení typů: 00:37:17–00:44:30.
2. *Form Factory: Q&A*, 2026-09-18 (call 26698). Volno / V práci a mzdy: 00:07:20–00:09:59. Zdravotní důvody a fond: 00:00:37–00:16:01. Lékař a pauza: 00:21:18.
3. *Sloneek/BDO Latvia: absence check*, 2026-09-03 (call 23365). Save vs Save for all users: 00:03:00–00:04:52. Fondy: 00:05:57–00:25:39. Import a AI: 00:27:28–00:29:44.
4. *Investika & Sloneek | Onboarding*, 2026-04-08 (call 2608). Deaktivace místo úprav, filtr Aktivní, Uložit pro všechny: 00:00:52–00:12:24.
5. *Reporty mzdy - Sloneek*, 2026-09-14 (call 25477). Mzdový report, filtry, export: 00:04:16–00:33:50. Chyba s Uložit pro všechny: 00:19:10.
6. *Sloneek - školení pro TL a manažment*, 2026-06-23 (call 13829). Žádost, schvalování, self-approval, chyby při zavádění: 00:04:57–00:29:00.
7. *Úvodní školení HRIS systém Sloneek*, 2026-09-25 (call 28117). Stavy žádosti, zrušení, Outlook: 00:08:17–00:13:25.
8. Doplňkově: *Školení Sloneek - ukázka školení pro manažery* (2026-09-30, call 29074), *Školení - změna HR systému: přechod na Sloneek* (2026-05-05, call 6370), oba jen ze souhrnu.

**Help centrum (cs-cz):**
- Vytvoření a nastavení nové události absence: https://help.sloneek.com/hc/cs-cz/articles/14888168374556 (2024-07-28)
- Nastavení absencí uživatelům: https://help.sloneek.com/hc/cs-cz/articles/14888167593372 (2024-07-28)
- Přiřazení a povolení událostí absence: https://help.sloneek.com/hc/cs-cz/articles/14888143255708 (2024-07-28)
- Jak zadat absenci: https://help.sloneek.com/hc/cs-cz/articles/14888080081436 (2024-08-21)
- Zobrazení absencí uživatele: https://help.sloneek.com/hc/cs-cz/articles/14888149308060

**Repo:** `docs/brief/kostra-videonavodu.txt` (vzorový scénář Absence), `recipes/absence-request.en.notes.md` (živé UI 2026 v EN), `scenarios/absences.json`, `scenarios/README.md`.
