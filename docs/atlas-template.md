# Šablona záznamu modulu – Produktový atlas

Odvozeno z návrhu „Produktový atlas – jak vytěžit průchody agenta produktem“ (Notion, 8. 10. 2026).
Jeden záznam = jeden modul (od 12. 10. 2026 anglicky, navigace UI po jazycích EN / CZ / PL). Soubory leží v `atlas/`:

- `atlas/<modul>.md` – čitelný záznam v angličtině, primární (sekce 1–8 níže, pevné pořadí a názvy nadpisů – v angličtině: Header, Where it is, Objects and states, User flows, Rules and gotchas, UI glossary, Differences from the help centre, Technical traces – aby šly strojově číst a diffovat),
- `atlas/<modul>.cs.md` – původní český záznam, jen pro referenci (hlavička „Superseded by <modul>.md“), dál se neaktualizuje,
- `atlas/<modul>.flows.json` – stejné user flows strojově (pro regresní přehrání nebo nové video bez dalšího průchodu).

Zdroj pravdy je repo. Sekce 1–7 se zrcadlí do Notionu (stránka „Product Atlas“ → jedna podstránka na modul), sekce 8 zůstává jen v repu.

## Obecná pravidla

- Píše se anglicky, popisky UI **doslova** tak, jak jsou v aplikaci (včetně překlepů a nekonzistencí – ty se označí). Kde se popisuje navigace (cesta v menu, tlačítka, pole), uvádí se popisek po jazycích, např. `Company → Teams` (EN) / `Společnost → Týmy` (CZ) / `Firma → Zespoły` (PL), z `labels` ve `<modul>.flows.json`; neověřený jazyk = „n/a (not verified)“ (nikdy nedomýšlet). Česká demo data (jména, názvy) zůstávají doslova.
- Uvádí se jen to, co podkládá zdroj (recept ověřený replayem, UI mapa, i18n soubor s `verified`, scénář s referencemi). Co ověřené není, má poznámku **„not verified“**.
- Datum a verze se píší vždy (atlas popisuje pre-prod k danému dni, ne produkci obecně).
- Klientská data a jména z callů se do atlasu nepíšou; demo uživatelé pre-produ ano.

---

## 1. Hlavička

Tabulka: modul (id + název v UI), jazyk UI, verze aplikace (`app_version` z receptu), datum průchodu (+ datum ověření dalších jazyků), účet a role, prostředí, viewport, zdroje v repu.

## 2. Kde to je

Položky levého menu (sekce ME / COMPANY / REPORTS AND SETTINGS…), routy, nadpisy stránek, kdo položku vidí (role/oprávnění). Tabulka: cesta v menu EN | CZ | PL | route | nadpis stránky | poznámka.

## 3. Objekty a stavy

Co modul spravuje (typ absence, žádost, cíl, report…), jeho důležité vlastnosti, stavy a přechody (A → B), kdo smí přechod udělat. Stavy se píší přesnými popisky z UI.

## 4. User flows

Pojmenované průchody („Zaměstnanec zažádá o dovolenou“). Každý flow:

- krátká hlavička: role, výchozí stránka, zda zapisuje data (**zapisuje data** / bez zápisu),
- číslované kroky ve tvaru **kliknu – vidím – vedlejší efekt** (vedlejší efekt = co se uloží, změní nebo odešle; „–“ když nic),
- odkaz na id kroků v `<modul>.flows.json` (např. `s14–s20`).

## 5. Pravidla a chytáky

Chování, které není v dokumentaci nebo je neintuitivní (např. „zaškrtnutí sloupce jen přidá sloupec, filtruje se ikonou v záhlaví“). Jeden bod = jedno pravidlo + zdroj (recept, UI mapa, call, help).

## 6. Slovník UI

Tabulka **EN | CZ | PL** s přesnými popisky. Jen ověřené popisky; neznámý překlad = „–“. Chyby překladu se označí (a sepíšou do `atlas/README.md` → „Chyby překladů pro dev tým“).

## 7. Rozdíly oproti help centru

Tabulka: článek (odkaz) | aktualizace článku | co článek říká | co dělá aplikace. Patří sem i rozdíly proti release notes, onboarding portálu a marketingovému webu, pokud jsou ze zdrojů známé.

## 8. Technické stopy

Jen pro agenty (do Notionu se nepřenáší, tam je odkaz na repo): routy, `data-cy`, stabilní selektory, localStorage klíče (např. `local-translate`), čekání, overlaye, data vytvořená při průchodu a cleanup, rizika pro opakované přehrání.

---

## Formát `atlas/<modul>.flows.json`

Generuje se programově z `recipes/cs/<modul>.json` (narace a časování se vynechávají).

```json
{
  "module": "absence",
  "lang": "cs",
  "lang_primary": "en",
  "generated_from": "recipes/cs/absence.json",
  "recipe_id": "absence-cs",
  "app_version": "preprod-2026-10-01",
  "viewport": {"width": 1920, "height": 1080},
  "start": {"url": "https://app-pre-production.sloneek.com/app/dashboard-v2", "local_storage": {"local-translate": "cs"}},
  "generated": "2026-10-09",
  "flows": [
    {
      "id": "zamestnanec-zada-dovolenou",
      "title": "Employee requests vacation",
      "creates_data": true,
      "steps": [
        {
          "id": "s19",
          "actions": [
            {"action": "fill", "selector": "nb-dialog-container [data-cy=noteTextarea]", "value": "Zastupuje mě Petr."},
            {"action": "click", "selector": "nb-dialog-container [data-cy=submitButton]:text-is(\"Vytvořit\")"}
          ],
          "expect": {"visible": ".upcoming-container span:text-is(\"23.11.2026 - 25.11.2026\")"},
          "creates_data": true,
          "writes": "creates an absence"
        }
      ]
    }
  ],
  "cleanup": [
    {"name": "…", "url": "…", "if_visible": "…", "deletes_data": true, "actions": [{"action": "click", "selector": "…"}]}
  ]
}
```

| pole | význam |
|---|---|
| `lang_primary` | `"en"` – volné texty (`title`, `note`, `writes`, `todo`, názvy a poznámky `cleanup`) jsou anglicky; `labels` a selektory zůstávají doslova |
| `flows[].steps[].id` | id kroku receptu (`sNN`) – páruje se se sekcí 4 v `.md` |
| `actions[].action` | `click`, `type`, `fill`, `press`, `hover`, `navigate`, `wait` (ms), `assert_visible` (= `highlight`/`zoom` z receptu) |
| `actions[].selector` | CSS nebo `CSS:text-is("…")` (Playwright), ověřeno replayem count 1 / visible 1 |
| `labels` | volitelné: seznam `{cs, pl, en}` – přesné popisky UI, na které krok cílí, ve všech ověřených jazycích (páruje se pozičně z `recipes/<lang>/<modul>.json`; demo data se neuvádějí; `null` = překlad neznámý). Může být i u položek `cleanup`. |
| `expect` | stav po kroku: `visible` (selektor), `url_contains` |
| `creates_data` | `true` = krok zapisuje na pre-prod (vytvoří/změní data); `writes` popisuje co |
| `cleanup` | kroky, které vrací pre-prod do výchozího stavu před dalším přehráním; `deletes_data` = maže |
