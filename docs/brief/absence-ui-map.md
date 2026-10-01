# Absence module – Czech UI map (admin video, ~5 min)

Explored 2026-10-01 on **pre-prod** `https://app-pre-production.sloneek.com` (Angular, Nebular + AG Grid + PrimeNG popovers), logged in as admin **Thomas Claver** (his own approver, so his requests are auto-approved). Explorer: BrowserOS Neo, own tab only.

Reusable action snippets: `recipes/cs/absence.ui-fragments.json` (29 fragments, recipe action format, `creates_data` flag on each).

**Selector rules used:** plain CSS or `CSS:text-is("…")` only. Each selector below was resolved with `scripts/explorer-kit/resolve.js` at the moment it is used and gave **count 1 / visible 1**, unless the table says otherwise. Afterwards, every non-writing fragment was replayed in order with real mouse clicks. Every action resolved 1/1, and every expect matched in under 120 ms.

**Window:** 1456×868 CSS px, DPR 2 (BrowserOS window; it could not be resized to 1920×1080). This is already the full desktop layout: the left menu is expanded and nothing collapses. At 1080 px height more of each page fits above the fold, but no selector depends on that. Several targets sit below the fold or to the right at 1456×868 (the "Nastavení" menu item, the settings-dashboard cards, the "Nutné schválení" grid column, the calendar legend). The recorder's `scrollIntoViewIfNeeded` handles them, and the replay scrolled them the same way.

---

## 0. UI language (Task 1)

| what | value |
|---|---|
| Where | Header, top right: flag dropdown `nb-select.language_select` (component `slnk-common-translate-bar`), next to the user menu. It is **not** in My profile → Nastavení rozhraní (that page only has notification settings, Google/Microsoft/Jira/MFA integrations and the attendance token). |
| Options | Flag-only `nb-option`s with no text: gb, de, es, it, pl, sk, **cz**, hu. Selectors `.cdk-overlay-pane nb-option:has(.fi-cz)` / `:has(.fi-gb)`, both 1/1. |
| Result | Czech was selected, the page was reloaded, and the menu is Czech ("Plocha", "Moje absence", "Kalendáře", "JÁ", "SPOLEČNOST", "REPORTY A NASTAVENÍ"). Nothing else was changed. |
| Storage | **localStorage `local-translate` = `cs`** (was `en`). It survives reloads and is shared by **every tab of this browser profile**, including Martin's own tab and any other agent's tab, as soon as they reload. Server-side persistence was **not** verified. `<html lang>` stays `en`. |
| Recorder | The Playwright storage state must contain `local-translate: "cs"`, or the recipe must start with fragment `ui_language_to_czech`. |
| **Switch back** | Click the flag top right (`nb-select.language_select`) → click the **British flag** (first option, `.cdk-overlay-pane nb-option:has(.fi-gb)`). Or set `localStorage['local-translate']='en'` and reload. |

---

## a) Where absences live in the menu

Menu `[data-cy=mainNavigationDiv]` has these sections: (top items) · **JÁ** · **SPOLEČNOST** · **REPORTY A NASTAVENÍ**.

| Czech label | route | selector | notes |
|---|---|---|---|
| Schvalování (badge 98) | `/app/events/approvals` → `/absence` | `[data-cy=mainNavigationDiv] a[href="/app/events/approvals"]` | top-level |
| Kalendáře (toggle) | – | `[data-cy=mainNavigationDiv] a.navigation_item:text-is("Kalendáře")` | Collapsed after **every** full load, including a direct load of `/app/events/absence`. A click toggles it, so clicking an expanded section collapses it. |
| Kalendáře → Absence | `/app/events/absence` | `[data-cy=mainNavigationDiv] a[href="/app/events/absence"]` | visible only when expanded. Siblings: Celkový přehled, Příchody / Odchody, Time-tracking a aktivity, Připomínky |
| JÁ → Moje absence | `/app/my-profile/absence-overview` | `[data-cy=mainNavigationDiv] a[href="/app/my-profile/absence-overview"]` | JÁ expanded by default |
| REPORTY A NASTAVENÍ → Nastavení | `/app/settings/dashboard` | `[data-cy=mainNavigationDiv] a[href="/app/settings/dashboard"]` | far down the menu (y≈1580). A click opens the dashboard **and** expands the submenu. |
| Nastavení → Absence | `/app/settings/absence/events` | `[data-cy=mainNavigationDiv] a[href="/app/settings/absence/events"]` | submenu label is just "Absence"; `a.navigation_secondary_item:text-is("Absence")` matches 2 items (calendar and settings), so do not use it |
| Nastavení → Hromadné nastavení absencí | `/app/settings/absence/collective-claims` | `[data-cy=mainNavigationDiv] a[href="/app/settings/absence/collective-claims"]` | |

Settings dashboard (`/app/settings/dashboard`, heading "Nastavení aplikace"), section **Absence**:
- "Nastavení absencí – Vytváření a nastavení typů absencí, které mohou uživatelé zaznamenávat" → `a[href="/app/settings/absence/events"]:text-is("Zobrazit")` (1/1, below the fold)
- "Úvazky a typy spolupráce" (working hours, not used)
- "Hromadné nastavení absencí – Hromadné přiřazování události absencí, které mohou uživatelé čerpat. Nastavení případných fondů k čerpání" → `a[href="/app/settings/absence/collective-claims"]:text-is("Zobrazit")` (1/1)

---

## b) Absence type settings

### List – `/app/settings/absence/events`
Heading **"Události absence"** (`h5:text-is("Události absence")`), back button "Zpět", primary button **"+ Přidat"**. The grid is AG Grid. It had 23 types before exploration and 24 after (`span:text-is("1 do 24 z 24")`).

| selector | element | verified | notes |
|---|---|---|---|
| `a[data-cy=addAbsenceButton]:text-is("Přidat")` | add button → `/app/settings/absence/event/new/general` | 1/1 | **The same data-cy is used by "Nová absence" on the overview and in the calendar.** Always qualify it with the tag/text. |
| `.ag-header-cell[col-id=name]` | "Název absence pro adminy" | 1/1 | |
| `.ag-header-cell[col-id=display_name]` | "Překlad názvu pro uživatele" | – | |
| `.ag-header-cell[col-id=is_enabled]` | "Aktivní" (filter Ano/Ne, default Ano) | 1/1 | |
| `.ag-header-cell[col-id=type]` | "Typ" | 1/1 | |
| `.ag-header-cell[col-id=yearly_fond_units]` | "Objem ročního fondu" | 1/1 | |
| `.ag-header-cell[col-id=yearly_fond_unit_type]` | "Jednotka fondu" | 1/1 | |
| `.ag-row a.redirect_column:text-is("Dovolená")` | row link to edit | 1/1 | |
| `.ag-row a.redirect_column:text-is("Dovolená – ukázka")` | the type created here | 1/1 | |
| `.ag-side-button:text-is("Sloupce")` / `"Filtry"` | grid side bar | 1/1 | also "Nastavení", "Celá obrazovka" |
| `[data-cy=editButton]`, `[data-cy=deleteButton]`, `[data-cy=customAction-toCollectiveClaims-button]` | row actions (edit, delete, people icon → bulk settings) | one per row | not unique, so do not click |

### New type form – `/app/settings/absence/event/new/general`
Heading **"Nová absence"** (`h5:text-is("Nová absence")`, 1/1). Header controls: toggle **"Aktivní"** (on by default), **"Uložit pro všechny uživatele"**, **"Uložit"**. Cards: **Šablony**, **Základní informace**, **Nastavení**.

| Czech label | selector | verified | notes |
|---|---|---|---|
| Aktivní (toggle) | `nb-toggle[data-cy=activityToggle]` | 1/1 | on by default |
| **Uložit pro všechny uživatele** | `button[data-cy=allCompanyButton]:text-is("Uložit pro všechny uživatele")` | 1/1 | **Bulk-assign. Never clicked. Highlight only.** |
| **Uložit** | `button[data-cy=submitButton]:text-is("Uložit")` | 1/1 | Plain save. This is the opt-out from auto-assign, so creating the type was allowed. |
| Zpět | `button:text-is("Zpět")` | 1/1 | leaves without a confirm prompt and discards the form |
| Šablony – "Vyberte předdefinovanou šablonu" | `[data-cy=templateAutocomplete] input` | 1/1 | options: 🏖️ Dovolená (denní fond), 🫖 Ošetřování člena rodiny, 🤒 Sick Day, 🏃 Neplacené volno, 🏥 Nemocenská, 🏖️ Dovolená (hodinový fond, pouze ČR), 🩺 Lékař (opened, not picked) |
| Název | `input[data-cy=nameInput]` | 1/1 | |
| Barva | `[data-cy=colorPicker] input` | 1/1 | readonly. A click opens a PrimeNG popover (`.p-popover`, appended to body, not cdk) with 10 swatches. |
| colour swatch | `.p-popover button.slnk-color-picker__swatch[aria-label="#10B981"]` | 1/1 | aria-labels: #338B85 #FFC94D #10B981 #5A00FF #8F9BB3 #6E003B #FA0 #9E547C #32008C #222B45. The trash icon next to the field clears the colour. |
| Přeložit název - cs | `input[data-cy=translatedNameInput]` | 1/1 | |
| Zobraz překlad | `p.cursor_pointer:text-is("Zobraz překlad")` | 1/1 | expands the other languages |
| Poznámka | `textarea[data-cy=noteTextarea]` | 1/1 | |
| Typ | `nb-select[data-cy=typeSelect] button` → `.cdk-overlay-pane nb-option[data-cy=type_vacation]` "**Volno** (krátí odpracovanou dobu)" / `[data-cy=type_in_work]` "**V práci** (nemá vliv na odpracovanou dobu)" | 1/1 each | |
| Časová jednotka čerpání | `nb-select[data-cy=unitTypeSelect] button` → `nb-option[data-cy=unitType_days_and_half_days]` "Dny a půl dny" / `unitType_days` "Dny" / `unitType_hours` "Hodiny" | 1/1 | |
| Roční fond | `nb-checkbox[data-cy=annualFundCheckbox] .custom-checkbox` | 1/1 | ticking it shows the next four rows |
| Roční nárok | `input[data-cy=yearlyEntitlementInput]` (type=number) | 1/1 | shows as "Roční nárok (Dny)" on the edit page |
| Jednotka fondu | `nb-select[data-cy=fundUnitSelect] button` → `nb-option[data-cy=fundUnit_day]` "Dny" / `fundUnit_hour` "Hodiny" | 1/1 | |
| Zakázat výpočet nároku absence | `nb-checkbox[data-cy=disableAccrueCheckbox]` | 1/1 | |
| Nevyčerpané jednotky se převádí do nového roku | `nb-checkbox[data-cy=unusedUnitsTransferCheckbox]` | 1/1 | |
| **Zdravotní důvody** | `nb-checkbox[data-cy=healthReasonsCheckbox]` (`nb-checkbox:text-is("Zdravotní důvody")` 1/1) | 1/1 (state-dependent) | On the **new** form it appears only after the unit is chosen, and **disappears when Roční fond is ticked**. On the edit page of a saved type it shows together with the fund fields. |
| **Časové omezení pro zápis události** | `nb-checkbox[data-cy=eventTimeoutCheckbox] .custom-checkbox` | 1/1 | Ticking it shows the slider `input[data-cy=eventTimeoutInput]` (type=range, −31…31, caption "v den začátku"). Ticked and unticked again, so it was not saved. |
| Skrýt název absence | `nb-checkbox[data-cy=hideAbsenceNameCheckbox]` | 1/1 | |

**Not on this form:** "Schvalování" / "Nutné schválení". Approval is configured **per user × type**: in the bulk grid (column "Nutné schválení"), and in a user's Přehled absencí → "Zobrazit nastavení pro absence a roční fondy". A button labelled "Uložit a automaticky povolit pro všechny uživatele" does not exist. The equivalent is "Uložit pro všechny uživatele".

Edit page of a saved type: `/app/settings/absence/event/edit/<uuid>/general`, with tabs **"Obecné nastavení"** (`…/general`) and **"Výpočet nároku absence"** (`…/accruals`). It was opened but nothing was saved.

**Wait:** after picking "Časová jednotka čerpání", wait about 900 ms before clicking "Roční fond". The layout shifts when "Zdravotní důvody" is inserted, and the first exploration click missed because of it.

**Save result:** a toast "Vytvořeno" shows for less than 3 s (do not expect on it), then the app redirects to the list with the new row. The new type is **not enabled for anyone**: in the bulk grid all 45 rows have "Povolená" unticked, and it is not offered in the Nová absence dialog.

---

## c) Hromadné nastavení absencí – `/app/settings/absence/collective-claims`
Heading **"Hromadné nastavení událostí absence"** (`*:text-is(…)` 1/1). The button top right "Kalkulačka nároku na dovolenou" is a **Userflow launcher** (`div.userflowjs-launcher`), not app UI. The AG Grid is server-side, 100 rows per page, **2,130 rows** in total (one row per user × type). Nothing was saved. The page has no Save button, so cell checkboxes probably save on click (**not verified**, not clicked).

| selector | element | verified | notes |
|---|---|---|---|
| `.ag-header-cell[col-id="absence_event.name"]` | "Název absence" | 1/1 | |
| `.ag-header-cell[col-id=allowed]` | "Povolená" | 1/1 | cells are per-row `nb-checkbox` with no unique selector |
| `.ag-header-cell[col-id="user.full_name"]` | "Jméno" | 1/1 | |
| `.ag-header-cell[col-id=approval_needed]` | "Nutné schválení" | 1/1 | off-screen right at 1456 px, so the recorder scrolls |
| `input[aria-label="Název absence Filter Input"]` | text filter | 1/1 | **"ukázka" → 45 rows. The full "Dovolená – ukázka" (en dash) → 0 rows.** Debounce plus server load ≈ 1–2 s (wait 2500). |
| `input[aria-label="Jméno Filter Input"]`, `…"Tým Filter Input"`, `…"Štítky Filter Input"` | text filters | 1/1 each | |
| `.ag-header-row-column-filter .ag-header-cell[aria-colindex="2"] select.common_select` | Povolená Ano/Ne | 1/1 | native `<select>`, so use the recorder `select` action (label "Ano"/"Ne") |
| `… [aria-colindex="4"] select.common_select` | Aktivní (default **Ano**) | 1/1 | |
| `… [aria-colindex="7"] select.common_select` | Nutné schválení Ano/Ne | – | |
| `.ag-cell[col-id="user.full_name"]:text-is("Claver Thomas")` | a row once filtered | 1/1 | |
| `.ag-paging-row-summary-panel:text-is("1 do 45 z 45")` | pager | 1/1 | data-dependent |
| `.ag-side-button:text-is("Sloupce")` | column panel | 1/1 | |

All columns (Sloupce panel): Název absence, Povolená, Jméno, Aktivní, Tým, Štítky, Nutné schválení, Má roční fond, Jednotka fondu, Jednotka čerpání fondu, Roční fond, Individuální fond, Fond pro tento rok, Vyčerpáno letos, Převedeno z loňska. The "Nastavení" side panel holds saved grid views ("Moje uložené pohledy", none saved). Nothing was saved there.

---

## d) Employee absence overview

Routes: own **`/app/my-profile/absence-overview`** (profile tab "Přehled absencí", menu "Moje absence"). Another user's: **`/app/company-details/member/<uuid>/absence-overview`**, reached from Uživatelé → click a row → tab "Přehled absencí" (checked on Besocki Eva, view only). Both use the same component and the same selectors.

| selector | element | verified | notes |
|---|---|---|---|
| `button[data-cy=addAbsenceButton]:text-is("Nová absence")` | opens the dialog | 1/1 | |
| `button[data-cy=absenceSettingsButton]:text-is("Zobrazit nastavení pro absence a roční fondy")` | toggles an inline table | 1/1 | label changes to "Skrýt nastavení pro absence a roční fondy" |
| `th:text-is("Nutné schválení")` | column of that table | 1/1 | columns: Název absence, Povolená, Nutné schválení, Má roční fond, Jednotka fondu, Jednotka čerpání fondu, Roční fond, Individuální fond, Fond pro tento rok, Vyčerpáno letos, Převedeno z loňska. They are **editable for an admin**, so do not click them. |
| `.remaining-absence-container` | balance cards (11 for Thomas) | 11/11 | "Zůstatek : N Dny/Hodiny", or "Vyčerpáno letos : N" for types without a fund |
| `.remaining-absence-container:text-is("🏖️ Dovolená (denní fond) Zůstatek : 12.05 Dny")` | the vacation card | 1/1 | **data**: 15.05 before, 12.05 after this exploration |
| `h6:text-is("Nadcházející absence")` / `h6:text-is("Již ukončené absence")` | list headings | 1/1 | `*:text-is` matches 2, so use h6 |
| `.upcoming-container div:text-is("09.11.2026 - 11.11.2026, 3 Dny")` | an entry | 1/1 | entry = type / `DD.MM.YYYY - DD.MM.YYYY, N Dny` / status ("Schváleno nadřízeným", or "Čeká se na schválení" for a pending request) |

Empty state: "Žádné absence" under Nadcházející absence (Besocki Eva). A year label "2026" and a 12-month mini calendar (Leden…Prosinec) sit below. Legend: Schváleno nadřízeným / Čeká se na schválení.

---

## e) Nová absence dialog (Czech)

Nebular dialog `nb-dialog-container`, title **"Absence"**. Left side = form, right side = month calendar (`[data-cy=fullCalendar]`, view select "Měsíc", "Dnes", checkbox "Zobrazit státní svátky země firmy (PT-11)"). The calendar shows existing absences and PT-11 holidays.

| Czech label | selector | verified | notes |
|---|---|---|---|
| Pro mě / **Jiný uživatel** | `nb-dialog-container nb-toggle[data-cy=differentUserToggle]` | 1/1 | ON adds **"Uživatel"** `nb-dialog-container [data-cy=usersAutocomplete] input` (1/1, 45 users) and a link-button "Správa uživatelů". Toggled on and off again. |
| Absence * – "Vyberte absenci" | `nb-dialog-container [data-cy=absenceEventsAutocomplete] input` | 1/1 | readonly, opens a cdk overlay. Link-button "Správa absencí" (`nb-dialog-container button:text-is("Správa absencí")` 1/1). |
| search in overlay | `.cdk-overlay-pane [data-cy=autocompleteSearchInput]` | 1/1 | typing "Dovolená (denní fond)" leaves exactly 1 option |
| option | `.cdk-overlay-pane slnk-common-autocomplete-option` | 1/1 after search | Thomas has 11 types. EN "Vacation (days)" = CZ "🏖️ Dovolená (denní fond)". The clear button is `[data-cy=autocompleteClearButton]`. |
| Půlden / Celé dny | `nb-dialog-container nb-toggle[formcontrolname=fullDay]` | 1/1 | default Celé dny |
| Od / Do | `nb-dialog-container [data-cy=dateFromInput]` / `[data-cy=dateToInput]` | 1/1 | **readonly**, format `9. 11. 2026`. Opens `nb-datepicker-container` with header button "říj 2026"/"lis 2026" and `button.next-month` / `button.prev-month` (1/1). |
| day cell | `nb-datepicker-container nb-calendar-day-cell:not(.bounding-month):text-is("9")` | 1/1 | Picking Od also sets Do. The Do picker opens on Od's month. The Od picker disables days after Do. |
| summary | text "Typ Absence · Jednotka Dny a půl dny · Fond Roční" | – | |
| **Kontrola události** | `nb-dialog-container .info:has(nb-icon[icon="check"])`, icon `nb-dialog-container nb-icon[icon="check"]` | 1/1 | "Počet dní 3 · Čerpání fondu 3 Dny". The event check is a network call of about 0.5–1 s (wait 1500). |
| collision | `nb-dialog-container .p-message-text` | 1/1 | "V těchto dnech je kolize s jinou událostí: 09.11.2026, 10.11.2026, 11.11.2026". No check icon appears, and Vytvořit stays disabled. |
| Poznámka k absenci (veřejně viditelná, např. V mé nepřítomnosti prosím kontaktujte Petra Nováka) | `nb-dialog-container [data-cy=noteTextarea]` | 1/1 | |
| **Vytvořit** | `nb-dialog-container [data-cy=submitButton]:text-is("Vytvořit")` | 1/1 | enabled check: `…[data-cy=submitButton]:not([disabled])` |
| close (X) | `nb-dialog-container [data-cy=closeButton]` | 1/1 | closes without a confirm prompt |

Gotchas:
- The datepicker opens on the **current month** (October 2026), so November needs one `button.next-month` click on Od.
- **Do not press Escape** to close an autocomplete overlay inside the dialog, because it may close the dialog. Click an empty part of the dialog instead (that worked).
- In the replay, re-picking Od in an already-filled dialog did not register on the first click. Always start from a fresh dialog.
- Submit: the dialog closes at once, and the list refreshes within about 2 s.

---

## f) Kalendář absencí – `/app/events/absence?view=resourceTimelineMonth&from=01.MM.YYYY`

Heading **"Absence"** (`h5:text-is("Absence")` 1/1). Top right: Microsoft and Google calendar buttons, and **"Nová absence"** (`[data-cy=mainContentCenterDiv] button[data-cy=addAbsenceButton]` 1/1, opens the same dialog). The month is in the URL, so `navigate` to `from=01.11.2026` is deterministic.

| Czech label | selector | verified | notes |
|---|---|---|---|
| view (Timeline) | `[data-cy=mainContentCenterDiv] [data-cy=activeViewSelect]` (button inside for clicking) | 1/1 | options Měsíc, Týden, Timeline, Den |
| Dnes | `[data-cy=mainContentCenterDiv] button:text-is("Dnes")` | 1/1 | |
| Zobrazit státní svátky země firmy (PT-11) | `[data-cy=mainContentCenterDiv] nb-checkbox:text-is("Zobrazit státní svátky země firmy (PT-11)")` | 1/1 | on by default. The grid also shows each user's own-country holidays (CZ, SK, PL, BR, AT, GB-SCT…). |
| ‹ / › month | `[data-cy=mainContentCenterDiv] button:has(nb-icon[icon="angle-left"])` / `…angle-right` | 1/1 | URL `from=` updates |
| event types filter "(30) Vybraných událostí" | `input[placeholder="Vyhledej události..."]` | 1/1 | |
| **team filter – "Rychlý pohled"** | `input[placeholder="Rychlý pohled"]` → `.cdk-overlay-pane slnk-common-autocomplete-option:text-is("Tým")` | 1/1 | options **Moje, Tým, Podřízení, Všichni**. Thomas is in **no team** ("Bez týmu"), so "Tým" shows only him. It was reverted to "Všichni". |
| users filter "(45) Vybrané uživatele" | `[data-cy=filterUsersAutocomplete] input` (placeholder "Najít uživatele") | 1/1 | with Tým/Moje it shows "Claver Thomas (GB-GLG)" |
| resource row | `full-calendar .fc-datagrid-cell.fc-resource:text-is("Claver Thomas")` | 1/1 | rows are grouped by team (Back Office, Bez týmu, Development, …) |
| created absence | `full-calendar .fc-timeline-event:text-is("10:00 - 18:30 Claver Thomas - 🏖️ Dovolená (denní fond)")` | 1/1 in Nov 2026 | data-dependent text |
| **state holiday** | `full-calendar .holiday_cell:text-is("CZ: Den boje za svobodu a demokracii SK: Deň boja za slobodu a demokraciu")` | 1/1 in Nov 2026 | full-height background column (2166 px tall), so use highlight rather than zoom. October: "CZ: Den vzniku Československa" (Oct 28, shared with other countries' labels). |
| legend | `.caption:text-is("Čekají na schválení")` | 1/1 | also "Automaticky schválené", "Schválené", "Absence", "Částečná absence" (bottom of the page) |

Wait about 2.5 s after opening the calendar, changing month or changing the quick view. FullCalendar re-renders, with no spinner element to wait on.

---

## g) Schvalování – `/app/events/approvals` → `/app/events/approvals/absence` (map only, nothing approved)

Heading **"Schvalování"** (`h5:text-is("Schvalování")` 1/1). Tabs (`a[href=…]`): **Absence 32** (`/app/events/approvals/absence`), Aktivity 49, Docházka 7, Změna osobních údajů 5, Dokumenty 5. The counts are data and are part of the tab text.

| Czech label | selector | verified | notes |
|---|---|---|---|
| Všichni uživatelé | `nb-select:text-is("Všichni uživatelé")` | 1/1 | |
| Všechny stavy | `nb-select:text-is("Všechny stavy")` | 1/1 | options: Všechny stavy, Čeká na schválení, Čeká na zrušení |
| Všechny absence | `nb-select:text-is("Všechny absence")` | 1/1 | |
| Seřadit podle data sestupně | `nb-select:text-is("Seřadit podle data sestupně")` | 1/1 | |
| select all | `nb-checkbox[data-cy=masterCheckbox]` | 1/1 | **do not click** |
| Schválit všechny vybrané / Odmítnout všechny vybrané | `button[data-cy=multipleApproveButton]` / `button[data-cy=multipleRejectButton]` | 1/1 | **do not click** |
| table | `table.mat-mdc-table` | 1/1 | columns: Jméno, Název absence (+ "Čeká na schválení"), Datum, Doba trvání, Zažádáno dne, Akce |
| per row Schválit / Odmítnout | `button[data-cy=singleApproveButton]` / `button[data-cy=singleRejectButton]` | 25/25 | not unique, so **do not click** |
| Načíst více výsledků | `button:text-is("Načíst více výsledků")` | 1/1 | |

Thomas's own requests skip this list because they are auto-approved. The pending rows come from other demo users (Ouancia Maria, Jasper Casper, …) plus old Lékař requests of Thomas. For a video that shows approving, a separate employee account would have to create a pending request.

---

## Data created in pre-prod

| what | details | how to undo |
|---|---|---|
| Absence type **"Dovolená – ukázka"** | Volno (krátí odpracovanou dobu), Časová jednotka čerpání Dny, Roční fond ✓, Roční nárok 20, Jednotka fondu Dny, colour #10B981, Přeložit název - cs "Dovolená – ukázka", Aktivní ✓. Saved with **"Uložit"**, so it is **enabled for nobody**. Edit URL `/app/settings/absence/event/edit/c8f93f03-bc56-4da3-a49a-72d7504d80b8/general` | Události absence → row → trash (`[data-cy=deleteButton]`) |
| Absence for **Thomas Claver** | 🏖️ Dovolená (denní fond), **09.11.2026 – 11.11.2026** (Mon–Wed), 3 Dny, note "Rodinná dovolená, ve čtvrtek jsem zpět.", **auto-approved** ("Schváleno nadřízeným"). The balance went 15.05 → 12.05 Dny. Collision check was done first (green). | Moje absence → entry → delete/cancel (not explored) |
| UI language of this browser profile | localStorage `local-translate`: `en` → `cs` | see section 0 |

Not changed: no existing type was edited or deleted. No bulk/"pro všechny" control and no grid checkbox was clicked. Nothing was approved or rejected. The calendar quick view was reverted to "Všichni". The bulk grid filter is not persisted.

**Checked free and left free for the real recording:** **23.–25. 11. 2026** (Mon–Wed). The event check was green with 3 Dny, and the dialog was closed without creating anything.

## Screens seen (descriptions)
1. Interface settings page (EN, before the switch): notification matrix only, with the language flag in the header.
2. Události absence list (CZ): purple "+ Přidat" top right, AG Grid with edit/trash/people icons per row, side bar Nastavení/Sloupce/Filtry/Celá obrazovka.
3. Nová absence (type) form: left cards Šablony and Základní informace (Název, Barva + trash, Přeložit název - cs, Zobraz překlad, Poznámka). Right card Nastavení. Header has toggle Aktivní, outlined "Uložit pro všechny uživatele" and filled "Uložit".
4. The same form with Roční fond ticked (Roční nárok + Jednotka fondu side by side, two more checkboxes) and Časové omezení ticked (slider −31…31).
5. Hromadné nastavení událostí absence: filtered to "ukázka", 45 rows, all with Povolená unticked.
6. Přehled absencí with the settings table expanded (Povolená/Nutné schválení checkboxes per type) above the balance cards.
7. Absence dialog: toggle Pro mě/Jiný uživatel, field Absence, calendar on the right with Oct 12–14 and Oct 19–21 vacations and PT holidays.
8. Absence calendar, Timeline, October: rows grouped by team, holiday columns in yellow, filter inputs, and legend at the bottom.

## Waits summary
| situation | wait |
|---|---|
| route change inside the app (menu click) | 2000–2500 ms |
| bulk grid first load | 3500 ms |
| grid text filter | 2500 ms |
| nb-select / autocomplete overlay open | 500–700 ms |
| unit select → layout shift before Roční fond | 900 ms |
| Od/Do pick → event check (network) | 1500 ms |
| Vytvořit / Uložit → list refresh | 2000 ms |
| calendar month / quick view change | 2500 ms |
Overlays: Nebular selects and autocompletes render in `.cdk-overlay-pane`, and the datepicker renders in `nb-datepicker-container`. The colour picker is a PrimeNG `.p-popover` appended to `body`. No blocking spinners were seen, and no product tour or popover blocked the mapped routes. The dashboard itself was not mapped.

## Risks for the recording
1. **Language is per browser profile (localStorage).** Every tab in Martin's BrowserOS, including other agents' tabs, is Czech after their next reload. The CDP recorder attaches to that browser, so it will record in Czech. A fresh Playwright storage state needs `local-translate=cs`.
2. **Dates are used up.** Nov 9–11 is now taken, and every successful recording consumes its dates. Use 23–25 Nov next, and update the expect string. The datepicker fragment assumes the recording runs in October 2026.
3. **Duplicate type.** Re-recording `new_type_save` creates a second "Dovolená – ukázka". Delete it first or add a suffix.
4. **Data-dependent text:** balance "12.05 Dny", tab counts ("Absence 32"), pager "1 do 45 z 45", the calendar event text with "10:00 - 18:30". Prefer structural selectors for anything that must survive a re-record.
5. **"Tým" quick view is empty-ish for Thomas** (no team). The approval flow cannot be shown with Thomas's own request, because it is auto-approved.
6. `data-cy=addAbsenceButton` is reused on three pages (Přidat / Nová absence), and the Kalendáře menu is a toggle. Both are handled in the fragments, but be careful when stitching.
7. Bulk-grid and per-user settings checkboxes probably save instantly. A stray click in a recording changes real assignments.
