# absence-request.en – explorer log (2026-10-01)

Explored by hand on Sloneek **pre-production** (`app-pre-production.sloneek.com`, Angular 21.2.10, UI language English), logged in as **Thomas Claver** (admin account; he is also his own approver).

## What the UI looks like

- Start `/app/dashboard-v2` ("Welcome Thomas"). Left menu `[data-cy=mainNavigationDiv]`, section **ME** expanded, item **My absences** → `/app/my-profile/absence-overview` (profile tab "Absence overview").
- Absence overview: balance cards per type, **New absence** button (`[data-cy=addAbsenceButton]`), list **Upcoming absences** / **Already finished absences**.
- The **Absence** dialog is a Nebular dialog (`nb-dialog-container`), not a PrimeNG p-dialog. Left side is the form, right side is a month calendar.
  - **Absence** type is a custom autocomplete (`slnk-common-autocomplete[formcontrolname=user_absence_event_uuid]`, readonly input). Clicking it opens an overlay in `.cdk-overlay-pane` with a search box (`[data-cy=autocompleteSearchInput]`) and 11 options (`slnk-common-autocomplete-option`, data-cy `autocompleteOption-N` is index based, so it is not used). Option texts start with an emoji (`🏖️ Vacation (days)`), so `:text-is` on options is brittle. The recipe types `Vacation (days)` into the search box, which leaves exactly 1 option, then clicks it.
  - After a type is picked, the form shows **Half-day / All days** toggle, **From** / **To** (`[data-cy=dateFromInput]` / `[data-cy=dateToInput]`, both **readonly**, so you cannot type into them; you pick dates in the Nebular calendar `nb-datepicker-container`). Picking From also sets To to the same day. Format shown: `MM/DD/YYYY`.
  - **Event check** runs automatically after the dates are set: green check `nb-icon[icon="check"]` + "Number of days 3 / Drawing the fund 3 Days", plus a short green "OK" toast bottom-left. If the days collide with an existing absence, a red alert "There is a collision with another event these days: …" appears, there is no check icon, and **Create** stays disabled.
  - **Absence note** textarea `[data-cy=noteTextarea]`, **Create** `[data-cy=submitButton]`.
- After **Create** the dialog closes, an "OK" toast appears, and the request is listed under **Upcoming absences** as `🏖️ Vacation (days) / 10/26/2026 - 10/28/2026, 3 Days / Approved by superior`.
- **No pending state on this account.** Thomas's requests are auto-approved ("Approved by superior"). The narration says "together with its approval status", so it is also true for a real employee whose request stays pending.

## Replay check

- The whole recipe was replayed in a fresh tab from the start URL, using only the recipe selectors (in-page `__svpResolve` → real mouse click at the element centre → `expect` polled like the recorder does). **It passed end to end on the first run, with no deviation.** Every action selector resolved `count 1 / visible 1`, and every expect matched within about 80 ms.
- The replay used **Oct 19–21**, because 12–14 was already used while exploring. The shipped recipe uses **Oct 26–28**: same selectors, only the day numbers and the expected date range changed. 26–28 were then checked without creating anything: the check icon showed, Create was enabled, and the dialog was closed again.

## Data created in pre-prod (user Thomas Claver, type Vacation (days), all auto-approved)

| dates | why | note |
|---|---|---|
| 10/12/2026 – 10/14/2026 | exploration | "Family trip, back on Thursday." |
| 10/19/2026 – 10/21/2026 | replay check | "Family trip, back on Thursday." |

The Vacation (days) balance went from 21.05 to 15.05. Nothing was deleted and no settings were changed.

## What the recorder must know / risks

1. **Each recording uses up its dates.** A successful run creates the 26–28 Oct absence. Any re-record (heal, retry) then hits the collision alert and fails at s06 (`expect nb-icon[icon="check"]`). Before re-recording, either delete that absence in the UI, or bump the two day numbers plus the date-range string in s05/s06/s09/s10 to a free Mon–Wed in the **current** month. Keep it Mon–Wed so the s08 note "back on Thursday" stays true and the range stays at 3 Days. In October 2026 there is **no other free Mon–Wed left**: 5–7 has the PT holiday on Oct 5, and 12–14 and 19–21 are taken. So a second October recording needs one of the test absences deleted first, or the dates and note changed to Tue–Thu 27–29 with a matching note.
2. **Month bound.** The datepicker opens on the current month, and the day cells are matched by number (`:not(.bounding-month)` excludes days from the next and previous month). The recipe is valid only while the recording runs in **October 2026, before Oct 26**. In another month the cells exist but point to the wrong month, so the expected date string at s09 fails.
3. **Viewport.** Explored at 1456×868 CSS px (BrowserOS window; it could not be resized). At 1920×1080 the left menu is expanded by default, and the 1456 px layout is already the full desktop layout, so nothing should collapse. The new Upcoming entry sits about 780–860 px from the top. It may sit slightly lower at 1080 px height if the cards reflow, but the recorder's `scrollIntoViewIfNeeded` covers that.
4. **Menu state.** The **ME** section must be expanded (it is on this account and session). If a fresh storage state starts with it collapsed, s02 fails (the link is not visible).
5. **Dashboard popovers.** A "Make it yours! You can now reorder and hide dashboard cards." tooltip shows on the dashboard (top right, not over the menu). It does not block anything, but it is visible in s01.
6. **Login:** the recipe has no `storage_state`. The recorder needs a pre-prod Playwright storageState (auth is the localStorage keys `sloneek-access-token` / `sloneek-refresh-token`) for the same user, or another employee with **Vacation (days)** assigned and a balance of at least 3 days.
7. **Voice:** `voice.provider: "say"` was requested, but `contracts/recipe.schema.json` only allows `elevenlabs | mock`, and `packages/assembler` implements `elevenlabs | espeak | mock`. As a result, the recipe **fails ajv on that one field only**. Everything else validates. Either extend the schema and the tts, or switch the provider.
8. Timing: the type filter in s04 has no visible debounce (the filter applies at once). The Event check is a network call, about 0.5–1 s, covered by `wait 1500` in s06. The list refresh after Create is covered by `wait 1500` plus the 5 s expect.
