# absence-cs – recipe notes (2026-10-01)

Recipe: `recipes/cs/absence.json` (id `absence-cs`, 29 steps, 1920×1080, voice external `bF7C2fCv7Zf30iT84wZ1` / `eleven_multilingual_v2`).
Source scenario: `scenarios/cs/absence.json` (updated with the narration changes below, plus intents/notes/preconditions/safety).
Voice to-do: `out/absence-cs/audio/manifest.json` (29 clips, 5,150 TTS chars).

Parts: 1 Úvod (s01–s03) · 2 Nastavení (s04–s13) · 3 Ukázka využití (s14–s25) · 5 Závěr (s26–s29). Part 4 is skipped, so 3 interstitial cards.

Zooms (6, per the brief): type select Volno (s07), Roční nárok (s08), Zdravotní důvody (s09), "Uložit pro všechny uživatele" as a warning (s11), the vacation balance card (s15) and Kontrola události (s18). Everything else the narration points at gets a `highlight`.

**Estimated length:** about 426 s of recording + 2.5 s intro + 2 s outro + 3 × 1.5 s cards ≈ **7.25 min**. This assumes ~14 chars/s of Czech TTS and the recorder's action timings. The brief's 4–6 min target is exceeded, but the checklist's 4–8 min is met. The longest silent stretches are s22 (≈ 22 s actions vs 10.5 s audio), s24 (≈ 19 s vs 16 s) and s23 (≈ 18 s vs 11 s). Trim those first if the cut is too long.

## Replay check (BrowserOS neo, own tab, 1456×868 CSS px, UI Czech)

Method: in a fresh tab at `start.url`, every recipe action was resolved with `__svpResolve` (scripts/explorer-kit/resolve.js, extended to also count matches by `textContent` the way Playwright's `:text-is` does). Then it was acted on at the element centre with a real mouse click, hover or typing (after `scrollIntoView` when the element was off screen, as the recorder's `scrollIntoViewIfNeeded` does). Each `expect` was polled for up to 5 s. Highlight and zoom were resolve-only.

After the replay, 11 zoom actions were turned into highlights to keep 6 zooms. The selectors are identical and both action types resolve the same way, so the replay result stands.

Result: **all 29 steps clean.** Every action selector resolved to exactly 1 element (count 1 / textContent count 1 / visible 1), and every `expect` and `url_contains` matched. The only `expect` with several matches is s12's (`Claver Thomas` cell, 30 rows), and it is an expect, not an action.

Deviations made on purpose during the replay (to keep 23.–25. 11. free for the real recording):
- **s19:** the note was filled and `Vytvořit` resolved 1/1 and enabled (`:not([disabled])`), with Kontrola události green ("Počet dní 3 · Čerpání fondu 3 Dny", from 23. 11. 2026 to 25. 11. 2026). **It was not clicked.** The dialog was closed with `[data-cy=closeButton]` instead.
- **s20** was checked against the existing exploration entry `.upcoming-container span:text-is("09.11.2026 - 11.11.2026")` (1/1). The recipe's own selector for 23.–25. 11. (`…:text-is("23.11.2026 - 25.11.2026")`) uses the same structure. Afterwards it was confirmed that no 23.–25. 11. entry exists.

Fixes found while building and replaying:
- **Zdravotní důvody** on the new-type form disappears when "Roční fond" is ticked and comes back once "Nevyčerpané jednotky se převádí do nového roku" is ticked. The s08 order (fund → 20 → Dny → carry-over) leaves it visible for s09.
- **Datepicker month:** text matching on month cells is unsafe. CSS uppercases them, so innerText is "LIS" while textContent is "lis". The recipe goes view-mode → `nb-calendar-year-cell:text-is("2026")` → `nb-calendar-picker-row:nth-child(3) nb-calendar-month-cell:nth-child(3)` (= listopad) → day. This works in any recording month.
- **Komplexní mzdový report link** wraps onto two lines, so its bounding-box centre falls between the lines and a centre click hits the `td`. The recipe highlights the link and then uses `navigate` to `/app/custom-reports/579`.
- **Fund columns in the bulk grid** are column-virtualised and not in the DOM. s13 clicks the plain-text Jméno cell of row 0 and presses `End`, which scrolls the grid to the last column. All 4 fund headers then resolve 1/1.
- **HubSpot chat bubble** (`#hubspot-messages-iframe-container`) was visible once and then `visibility:hidden` on every page load. It was removed from s29 (see risks).

Pre-prod data after the replay: unchanged. There are still 24 absence types, one "Dovolená – ukázka", and the Thomas upcoming list still has only 12.–14. 10., 19.–21. 10. and 09.–11. 11. Nothing was saved, approved or toggled. The only state touched was column filters and grid focus, which are not persisted.

## Narration changes (narration = subtitle; narration_tts updated the same way)

| step | change | why |
|---|---|---|
| s11 | "…Proto kliknu jen na Uložit." → "…Proto stačí kliknout jen na Uložit. Já už mám typ uložený, takže formulář zavřu a tady v seznamu ho vidíte." | The type is never saved during the recording: the form is closed with Zpět and the existing "Dovolená – ukázka" is shown in the list |
| s12 | "Každý člověk tu má svůj řádek. Políčkem Povolit… Nutným schválením…" → "Každý člověk tu má řádek pro každý typ absence. Ve sloupci Povolená… ve sloupci Nutné schválení…" | Grid row = user × type; the column is labelled "Povolená" |
| s22 | "Vyberu Elišku, …" → "V poli Uživatel vyberu kolegyni, typ Nemocenská a dnešní den. Tlačítkem Vytvořit nemocenskou uložíte a hned je v kalendáři i v podkladech pro mzdy." | No user named Eliška on pre-prod (demo user Nová Kristýna is used) |
| s24 | "V Reportech otevřu…" → "Ve Vlastních reportech otevřu…" | The menu item is "Vlastní reporty" |
| s25 | "…hodnotu Ano zvolte v řádku filtrů nad tabulkou." → "…hodnotu Ano zvolte přes ikonu filtru u sloupce Aktivní v tabulce." | The report table has no filter row; the filter is a funnel icon in the column header |
| s28 | "v profilu si propojte Sloneek s kalendářem Google nebo Outlook. Schválené absence se vám tam propíšou samy…" → "v Nastavení rozhraní si v části Propojené účty připojte Google nebo Microsoft. Schválené absence se vám pak propíšou do kalendáře Google nebo Outlook…" (TTS: gůgl / majkrosoft / autluk) | The real location and labels |

Vykání, Marie's first person and female forms are kept. The s20 narration was left as it was: "Jako administrátorka mám schválení automaticky" is true for Thomas ("Schváleno nadřízeným"). The dialog has no "Automaticky schválit / Poslat ke schválení" switch.

## What each step assumes (data)

- **Login / profile:** CDP into Martin's BrowserOS neo, logged in as **Thomas Claver**, with localStorage `local-translate=cs`. Section JÁ is expanded and Kalendáře is collapsed after a full load (s23 clicks Kalendáře once to expand it).
- **s04:** the settings dashboard has the card "Úvazky a typy spolupráce" (`a[href="/app/settings/working-hours"]:text-is("Zobrazit")`).
- **s05:** the list has the type "Dovolená". **s11:** the type **"Dovolená – ukázka" exists** (the edit link in the list). Do not delete it before recording.
- **s12–s13:** the bulk grid has rows for "Claver Thomas" (30 today). Column ids: `allowed`, `approval_needed`, `transformed_first_yearly_claim`, `transformed_yearly_claim`, `transformed_claimed`, `transformed_transferred_from_previous_year`.
- **s15 / s29:** Thomas has the balance card "🏖️ Dovolená (denní fond)". The selector uses the type name, not the balance (12.05 Dny today, 9.05 after the recording).
- **s16–s19:** "🏖️ Dovolená (denní fond)" is enabled for Thomas, **23.–25. 11. 2026 is free**, and the balance is ≥ 3 days. **s19 creates the absence** (auto-approved). s19/s20 expect `.upcoming-container span:text-is("23.11.2026 - 25.11.2026")`.
- **s22:** demo user **"Nová Kristýna"** (search "Kristýna"; "Nová" would also match "Novák …"), who has "🏥 Nemocenská" (admin name "Sick leave") enabled. "Od" = `nb-calendar-day-cell.today` (the picker opens on the current month). Nothing is created; the dialog is closed with X. Pre-prod currently shows an info line about replacing the "Default break" segment, which is harmless.
- **s23:** the November calendar is opened via URL `…/app/events/absence?view=resourceTimelineMonth&from=01.11.2026` (a full reload, so the menu collapses again). The highlighted row is "Claver Thomas".
- **s24–s25:** report **id 579** = "Komplexní mzdový report" (preset report, period "Minulý měsíc"). Header data-cy: `crDetail.grid.header.salary_summary_working_fund_gross_hour` / `…absence_vacation_duration_hour` / `…working_fund_net_hour`, filter icon `crDetail.grid.filterIcon.employee_active`.
- **s28:** "Nastavení rozhraní" → section "Propojené účty" with "Sign in with Microsoft" (nothing is clicked there).

## Risks

1. **The recording uses up 23.–25. 11.** A retry or heal after a successful s19 hits the collision ("V těchto dnech je kolize…"), and s17's `expect nb-icon[icon="check"]` fails. Before re-recording, cancel the 23.–25. 11. absence, or move the day numbers in s17 and the date string in s19/s20 to another free Mon–Wed. 30. 11.–2. 12. needs a second month and is not mapped. Nov 16–18 was not checked.
2. **Zoom/highlight geometry was verified at 1456×868, not 1920×1080.** Every selector is structural, so no selector depends on it. Layouts get wider at 1920 (for example, the bulk-grid columns after `End`), but nothing should collapse.
3. **"Ellie vpravo dole" (s29) is not verified.** The bottom-right bubble is the HubSpot chat widget. It loaded visibly once and was then hidden on every load, so the recipe does not point at it. If it is not visible in the recording, change the first sentence of s29 (for example, "zeptejte se nás v chatu nebo mrkněte do Centra nápovědy"), or have Product confirm the name "Ellie".
4. **s28's claim is not verified.** That connecting Google/Microsoft in "Propojené účty" makes approved absences appear in the calendar comes from the scenario (Modjo calls), not from the UI. The absence calendar also has unlabelled Microsoft/Google icon buttons whose function is unknown. Product/CS should confirm.
5. **Report id 579** is tenant-specific. On another tenant the s24 highlight and navigate need the new id. The report can also load slowly (wait 3500 ms, then 5 s expect).
6. **s13 clicks a grid cell** (Jméno, row 0, plain text) to give the grid keyboard focus. It is not a checkbox, but a misplaced click in the neighbouring "Povolená" column could toggle an assignment. That column is pinned left and 200 px away.
7. The dashboard coach-mark "Přizpůsobte si to!" is visible in s01–s03. It is not closed, on purpose, because closing it may persist.
8. The `fill` on the range slider (s09) relies on Playwright's `locator.fill` support for `input[type=range]`. The replay set the value with the native setter plus input/change events, and the caption showed "7 dny před začátkem". The recorder's preceding centre click first moves the slider to 0.
9. Pacing: s14 has `before_ms 4500` so that the "Moje absence" click lands near the end of its narration. s02/s03/s29 also have longer `before_ms`.

## Clean-up after recording

- **Moje absence → the 23.–25. 11. 2026 vacation of Thomas Claver** (note "Zastupuje mě Petr."): cancel/delete it if the dates are needed again. The balance drops by 3 days.
- Older test data (not from this recipe): the type "Dovolená – ukázka" (enabled for nobody; deactivate or delete when the video series is done) and Thomas's vacations 12.–14. 10., 19.–21. 10. and 9.–11. 11. 2026.
- Nothing else is written. The form in s06–s11 is discarded, s22 is closed without saving, and the grid filters are not persisted.
