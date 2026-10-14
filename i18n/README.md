# i18n – jazykové verze videí

Český recept (`recipes/cs/<id>.json`) je master. Jazykovou verzi vyrobí

    node scripts/localize.mjs <id> <lang>      # → recipes/<lang>/<id>.json + out/<id>-<lang>/recipe.json

z `i18n/<id>.<lang>.json`:

| klíč | co to je |
|---|---|
| `steps.sNN.narration` | narace kroku (povinné pro každý krok) |
| `text` | CZ → cizí text pro `:text-is("…")` / `:has-text("…")` v selektorech **a** pro hodnoty, které video píše (`type`/`fill`/`upload` – demo soubor v daném jazyce: název reportu, cíle…) |
| `selectors` | celý CZ selektor → celý cizí selektor (když jedno slovo má v různých místech různé překlady) |
| `urls` | celá URL bloku `cleanup` (i akce `navigate`) z masteru → URL pro daný jazyk (např. karta CZ demo uživatele → karta PL demo uživatele) |
| `cleanup_prepend` | celé bloky už v cílovém jazyce, běží před bloky masteru (např. smazat pozůstatky demo objektů ostatních jazyků) |
| `cleanup_names` / `teardown_names` | volitelné nové názvy (log) bloků `cleanup` / `teardown` z masteru, podle pořadí |
| `teardown_prepend` / `teardown_append` | volitelné bloky `teardown` už v cílovém jazyce, před / za bloky masteru |
| `ids` | podřetězce ve `navigate` URL a `expect.url_contains` (např. uuid CZ demo uživatele → uuid PL demo uživatele) |
| `steps.sNN.narration_tts` | volitelná mluvená varianta narace (např. „1.0“ → „jeden kropka zero“); titulky berou `narration` |
| `keep` | texty stejné ve všech jazycích (data tenanta, jména – např. typ absence „Dovolená“) |
| `parts`, `title`, `thumbnail_title` | názvy částí, titulek videa a náhledu |

UI texty se neberou z hlavy: aplikace stahuje překlady z
`https://slo-dev-ec1-service-s3-content-preprod.s3.eu-central-1.amazonaws.com/translate/translate_fe/<cs|pl|en>`
(gzip JSON, 11 515 klíčů). Stejné CZ slovo má často víc překladů podle kontextu (např. „Vymazat“ = „Usuń“ u mazání,
ale „Jasne“ u zrušení seskupení), proto se každý selektor po lokalizaci **ověří naživo** v daném jazyce UI
(`localStorage["local-translate"] = "pl"`) – viz `verified` v i18n souboru.

Jazyk UI nastavuje recorder sám z `recipe.start.local_storage` (`{"local-translate": "pl"}`) – recorder jede
v reálném profilu prohlížeče, takže **každý recept** (i český) uvádí svůj jazyk, jinak by po PL běhu zůstalo UI polsky.

Narace v cizím jazyce je strojová – před publikací ji musí zkontrolovat rodilý mluvčí.

`teardown` (úklid po nahrávání, mimo video – např. smazat demo odkaz / fázi náboru, aby nezůstaly vidět ostatním uživatelům) se lokalizuje stejně jako `cleanup`: `urls`, `selectors`, `text` (vč. `:has-text`, `[aria-label=…]`, `[placeholder=…]`) a psané hodnoty; chybějící překlad je chyba jako u kroků. Recept bez `teardown` v masteru (a bez `teardown_prepend/append`) ho nedostane – ostatní PL/EN výstupy se přidáním podpory nezměnily (ověřeno 12. 10. 2026 přegenerováním všech 20 PL/EN receptů). Hodnoty v `[data-cy="tag-<název>"]` text map nepokrývá – patří do `selectors` (viz `out/ats-setup/_work/build_i18n.py`).
