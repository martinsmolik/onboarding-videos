# Scenarios – batch 1 (Czech, regenerate 2026-10-01)

Hand-written `scenario.json` files for the first 8 onboarding-portal videos. They are ready for the explorer as soon as demo-tenant credentials exist:

```
mkdir -p out/<id> && cp scenarios/<id>.json out/<id>/scenario.json
node scenarios/validate.mjs            # all files, exits 1 on any error
```

Researched 2026-09-30 from the Czech help center (`help.sloneek.com/hc/cs-cz`), the onboarding portal (`sloneek.com/cs/onboarding-portal/`) and release logs 3.49–3.54. Old videos were **not** transcribed (YouTube returned 429), so the teaching order follows the portal description and the help articles.

## Conventions (same as `packages/knowledge` scenarist)

- `narration`: spoken Czech, 8–25 words, imperative, no digits or quotes, first step = intro, last step = one-sentence wrap-up.
- `intent`: English, UI labels verbatim in single quotes in Czech. Never contains uncertainty words.
- `notes` (extra per-step field): where a label is not confirmed, marked with **pravděpodobně**. The explorer should treat these labels as hints and look for the closest control.
- `preconditions` (extra top-level field): demo-tenant state the scenario assumes.
- `source.references` (extra field): help articles used, with their `updated` date.
- Shared demo data: `add-users` creates **Petra Ukázková**; `user-folders`, `org-chart`, `working-hours`, `onboarding-checklists`, `documents` and `dashboard` reuse her.
- `fixtures/dohoda-o-provedeni-prace.docx`: Word file for the Word import in `documents` (s04), with the placeholder `JMÉNO ZAMĚSTNANCE`.

## Recommended batch order

1. **absences**: simplest UI, one dialog; employee login needed.
2. **add-users**: creates Petra Ukázková, which the later scenarios need.
3. **user-folders**: mostly tab clicks; confirms the user-folder labels that working-hours relies on.
4. **working-hours**: needs Petra without working hours. Assigned working hours get locked, so a rerun needs a new name.
5. **org-chart**
6. **documents**: needs the .docx fixture available to the file chooser.
7. **onboarding-checklists**: the module was redesigned on 29. 9. 2026 (release 3.54); check the demo tenant has it.
8. **dashboard**: Plocha 2.0 labels are unknown, so run it last, after a human has had a look.

## Scenario → old video → sources

| Scenario | Audience | Steps | Old video (cs) | Help sources (updated) | UI naming confidence |
|---|---|---|---|---|---|
| `absences` | employee | 10 | [dEb04tZJdSU](https://www.youtube.com/watch?v=dEb04tZJdSU) | [Jak zadat absenci](https://help.sloneek.com/hc/cs-cz/articles/14888080081436) (2024-08), [Zobrazení absencí](https://help.sloneek.com/hc/cs-cz/articles/14888149308060) (2024-07), [Přiřazení událostí absence](https://help.sloneek.com/hc/cs-cz/articles/14888143255708) (2024-07), [Release 3.51](https://help.sloneek.com/hc/cs-cz/articles/28523258354972) | **medium**: 'Nová absence' and 'Zkontrolovat' confirmed; the submit button, dashboard widget name and calendar path are not |
| `add-users` | admin | 10 | [Bgq7l81i5_o](https://www.youtube.com/watch?v=Bgq7l81i5_o) | [Vytvoření nového uživatele](https://help.sloneek.com/hc/cs-cz/articles/14888164615324) (2024-08), [Přehled uživatelů](https://help.sloneek.com/hc/cs-cz/articles/14888167971356) (2024-07), [Google Workspace](https://help.sloneek.com/hc/cs-cz/articles/14888111626524) (2026-05), [Entra ID](https://help.sloneek.com/hc/cs-cz/articles/14888093550620) (2026-05), [Pravidla pro import](https://help.sloneek.com/hc/cs-cz/articles/14888034785692) (2025-07), [Hromadný import](https://help.sloneek.com/hc/cs-cz/articles/14888035279132) (2024-07) | **medium-high**: 'Uživatelé → Přehled a správa → Import uživatelů' (2026), 'Přidat' and 'Pozvat' confirmed; form field names and the save button are not; s09 needs a connected integration |
| `user-folders` | admin | 10 | [pqELX50ERKc](https://www.youtube.com/watch?v=pqELX50ERKc) | [Karta uživatele](https://help.sloneek.com/hc/cs-cz/articles/14888150991516) (2024-08), [Uživatelské role](https://help.sloneek.com/hc/cs-cz/articles/14888101294876) (2025-02), [Vlastní pole](https://help.sloneek.com/hc/cs-cz/articles/14888082631964) (2025-07) | **medium**: tab names come from a 2024 article; the absence tab has two names in the help center; the s04 edit field is a guess |
| `working-hours` | admin | 11 | [6YtpAv_9j3o](https://www.youtube.com/watch?v=6YtpAv_9j3o) | [Typy spolupráce, pracovní doba](https://help.sloneek.com/hc/cs-cz/articles/14888114487964) (2024-08), [Úprava/smazání pracovní doby](https://help.sloneek.com/hc/cs-cz/articles/14888057385244) (2024-07), [Kde najdu nastavení](https://help.sloneek.com/hc/cs-cz/articles/15774085849500) (2024-09), [Docházka 2.0](https://help.sloneek.com/hc/cs-cz/articles/24879546533276) (2026-01) | **medium**: 'Nastavení / Úvazky a typy spolupráce', 'PŘIDAT', 'BĚŽNÁ', 'VLASTNÍ', 'ULOŽIT' and the user-card tab are confirmed, but only in 2024 articles; the assignment control is not |
| `org-chart` | admin | 11 | [NNtvzKEEN7U](https://www.youtube.com/watch?v=NNtvzKEEN7U) | [Týmy a organizační struktura](https://help.sloneek.com/hc/cs-cz/articles/14888059312796) (2024-08), [Mezinárodní složení týmu](https://help.sloneek.com/hc/cs-cz/articles/14888026718236) (2024-07), [Uživatelské role](https://help.sloneek.com/hc/cs-cz/articles/14888101294876) (2025-02) | **medium-low**: 'Společnost / Týmy' and 'Rozbalit vše' confirmed (2024); the add button is only an image; field labels and drag and drop (s09) are unconfirmed |
| `documents` | admin | 11 | [gynX5OLrssI](https://www.youtube.com/watch?v=gynX5OLrssI) | [Práce s modulem Dokumenty](https://help.sloneek.com/hc/cs-cz/articles/18502089103900) (2026-02), [Jaké dokumenty podepíšete](https://help.sloneek.com/hc/cs-cz/articles/14888025000988), [Elektronický podpis a potvrzení](https://help.sloneek.com/hc/cs-cz/articles/14888131526172), [Release 3.52](https://help.sloneek.com/hc/cs-cz/articles/29187621291548) | **high**: almost every label is confirmed in a 2026 article ('Šablony', '+ Přidat novou šablonu', 'Importovat z Wordu', 'Proměnné', 'Podepisující', 'Žádost o podpis', 'Potvrzení'); only the final send button and the variable name are open |
| `onboarding-checklists` | admin | 11 | [6hmAQC_vn5A](https://www.youtube.com/watch?v=6hmAQC_vn5A) | [Checklisty](https://help.sloneek.com/hc/cs-cz/articles/30575223342364) (2026-09-29), [Moje úkoly](https://help.sloneek.com/hc/cs-cz/articles/14888120847772) (2026-09-29), [Release 3.54](https://help.sloneek.com/hc/cs-cz/articles/30575134117660) | **high** for labels ('+ Vytvořit šablonu', '+ Přidat nový úkol', 'Spustit checklist', 'Režim dokončení', 'Uložit a spustit checklist', 'Kanban zobrazení'). **Risk:** the module shipped yesterday, so check the demo tenant has it. The portal still links the old articles |
| `dashboard` | admin | 11 | [G_mvggoF4Hc](https://www.youtube.com/watch?v=G_mvggoF4Hc) | [Firemní nástěnka na Ploše](https://help.sloneek.com/hc/cs-cz/articles/14888114515996) (2024-07), [Release 3.51 (Plocha 2.0)](https://help.sloneek.com/hc/cs-cz/articles/28523258354972), [Release 3.54](https://help.sloneek.com/hc/cs-cz/articles/30575134117660) | **low**: Plocha 2.0 (6/2026) has no help article. Widget names are from 2024; the personalisation and mandatory-widget controls (s09, s10) are unknown |

## Needs a human glance before the explorer runs

- **dashboard**: s02, s05, s07, s09, s10 (Plocha 2.0 labels). Best done with one screenshot of the current Plocha.
- **absences**: this video swaps the catalog topic. The catalog title "Nastavte a spravujte absence" and its portal description are an **admin** topic (create absence types, entitlements). As instructed, this batch makes the **employee** flow (request a vacation). The portal video still needs an admin scenario based on [Vytvoření nové události absence](https://help.sloneek.com/hc/cs-cz/articles/14888168374556) (`Nastavení / Absence`) and [Nastavení absencí uživatelům](https://help.sloneek.com/hc/cs-cz/articles/14888167593372) (`Hromadné nastavení absencí`).
- **onboarding-checklists**: confirm the 3.54 module is live on the demo tenant.
- **org-chart** s09 (drag and drop) and **add-users** s09 (needs a connected integration). Drop the step if the tenant cannot show it.
- `Uživatelé → Přehled a správa`: help articles from 2024 say `Seznam a správa`. Every scenario that opens a user relies on this label.

## Not covered in this batch (for later)

`collect-data`, `work-assets`, the time-management videos other than working-hours and absences, and ATS, performance, surveys, workflows, AI, wiki and trust box. The help center has current articles for most of them (see the English index at help.sloneek.com; the article ids are the same under `/hc/cs-cz/articles/<id>`).
