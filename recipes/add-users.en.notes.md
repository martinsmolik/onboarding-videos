# add-users (en) – explorer notes

Explored 2026-10-01 on `app-pre-production.sloneek.com`, signed in as an admin (Thomas Claver), UI in English, in BrowserOS Neo.
Explorer window was **1456x868**, not 1920x1080 (see risks).

## Flow found

Dashboard → left menu **COMPANY › Users** (accordion, collapsed by default) → **Management** (`/app/settings/users`, page title "Management of users") → **Add** (`/app/company-details/member/new`, full page "Create a new user", not a dialog) → **Create user** → the new user's profile opens on `/app/company-details/member/<uuid>/work-data` ("Basic and work data" tab). The header shows `Example Petra (Inactive)` (surname first).

Required fields: activation radio (neither option is selected by default), Name, Surname, Email. Everything else is optional.
The "Team" field is a **Nebular `nb-select`**, not PrimeNG. Its options are `nb-option[data-cy="team-<name>"]` inside the cdk overlay.

## Selectors (all checked: count 1 / visible 1 in the recipe's state)

| step | selector | kind |
|---|---|---|
| s01 expect | `#navigation_company_staff` | static id |
| s02 | `#navigation_company_staff` → expect `#navigation_settings_users` | static id |
| s03 | `#navigation_settings_users` → expect `.slnk-h1:text-is("Management of users")` | id, design-system class + text |
| s04 | `[data-cy="addUserButton"] button` → expect `[data-cy="usersCreateForm"]` | data-cy |
| s05 | `[data-cy="userInactiveRadio"]` → expect `[data-cy="hirePacketSelect"]` | data-cy |
| s06 | `[data-cy="firstNameInput"]`, `[data-cy="surnameInput"]` | data-cy |
| s07 | `[data-cy="emailInput"]` (value `video.demo+{{RUN_ID}}@example.com`) | data-cy |
| s08 | `[data-cy="teamsSelect"] button` → `nb-option[data-cy="team-Marketing"]` → expect `[data-cy="teamsSelect"] button:text-is("Marketing")` | data-cy |
| s09 | `[data-cy="submitButton"]` → expect `slnk-common-header-autocomplete .user_name:text-is("Example Petra (Inactive)")` + url `/work-data` | data-cy + text |
| s10 | highlight the same header selector | |

Other stable hooks you can use: `#users_add_create_new_user` (the same Create user button), `#stonly-add-new-user` (the Add p-button host), `[data-cy="userActiveRadio"]`, `[data-cy="positionSelect"]`, `[data-cy="joinDateInput"]`, and `[data-cy="companyMemberWorkDataSaveButton"]` on the profile.
The page has no `formcontrolname` attributes.

## Replay check

I opened a fresh tab on the start URL and replayed every step using only the recipe selectors (resolved with `__svpResolve`, scrolled into view, then a real click at the element's centre; typing went to the focused element), with RUN_ID `rmupa7btz`. All 10 steps and all expects passed on the **first clean pass**, with no retries and no extra steps. Screenshot of the final state: `recipes/add-users.en.replay-final.jpg`.
The sidebar accordion state is **not** persisted (it was collapsed again in the fresh tab), so s02 always expands it.

## Test users created (all inactive, team Marketing, no new hire packet)

| name | email | id | how |
|---|---|---|---|
| Petra Example | video.demo+20261001x1@example.com | f5f13a9a-c2ae-465b-a1e8-1b6c1f5e1803 | exploration |
| Petra Example | video.demo+rmupa7btz@example.com | ca14a98b-46df-4674-89c5-293f79324c77 | replay check |

Every recorder run adds one more "Petra Example". The app shows **no duplicate-name warning**. Clean up the test users from time to time (I did not delete anything).

## Invitation / email behaviour

- The create form has **no "send invitation" option**. Inviting is a separate **Invite** button on the Management page, which the recipe never touches.
- The recipe picks **The user is not active**, so the user cannot log in and no access is granted. Choosing it reveals "Choosing a new hire packet template" (left empty) and "Choose language". A new hire packet is the pre-boarding flow and would probably email the new hire, so **keep it empty**.
- I did not test whether choosing *The user is active* sends a welcome or activation email. `example.com` is a reserved domain, so nothing could reach a person either way. If the video should show an active user, swap the s05 selector to `[data-cy="userActiveRadio"]`, change the s05 expect (`hirePacketSelect` only appears for inactive users), set the s09/s10 text to `Example Petra`, and re-verify.

## Replay risks at 1920x1080

1. **Viewport difference.** I verified at 1456x868. At 1920x1080 the sidebar is still expanded (it is expanded from 1456 px up). The COMPANY › Users item sits lower in the scrollable sidebar (`[data-cy="mainNavigationDiv"]`), and the recorder's `scrollIntoViewIfNeeded` handles that. Do one recorder dry run to confirm.
2. **`{{RUN_ID}}` substitution.** I could not find RUN_ID handling in `packages/recorder/src` (grep found nothing). If the recorder types the placeholder literally, the second run fails because the email `video.demo+{{RUN_ID}}@example.com` already exists, and the braces may also fail email validation. The recorder needs to replace it with `[a-z0-9]` only (the `+` tag works, I tested it).
3. **Voice provider.** The recipe uses `voice: {provider: "say", voice_id: "Samantha"}` as instructed. `contracts/recipe.schema.json` only allows `elevenlabs|mock`, so **ajv rejects the recipe on that one field**. `assembler tts` also only knows elevenlabs/espeak/mock. The schema and assembler need `say` added (and `espeak`, which the schema is missing too). The scenario validates cleanly.
4. **Layout shift in s05.** Choosing "not active" pushes Basic information about 240 px down. The recorder works out each element's position again just before acting, so this is fine, but do not cache coordinates.
5. **Team dropdown overlay.** It is a cdk overlay that can open above or below the field depending on the room left. The option selector does not depend on position. If the "Marketing" team is renamed or deleted on pre-prod, s08 breaks.
6. **Dashboard coach-mark.** "Make it yours! You can now reorder…" shows on the dashboard. It does not overlap the sidebar, but it appears in the s01 frame. Nothing in localStorage dismisses it.
7. **The header name is surname-first** (`Example Petra`), while the narration says "Petra". The s09/s10 text selector depends on the `(Inactive)` badge text.
8. **Clock-in timer widget** in the top bar is live. It is harmless.
