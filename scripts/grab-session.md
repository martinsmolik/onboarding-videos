# Jak vyrobit `out/session.json` (záložní přihlášení bez CDP)

Použij jen když recorder **nejde** připojit k BrowserOS neo přes CDP (`pnpm local:check` hlásí ✗ u CDP).
Recorder pak spustí vlastní Playwright Chromium a do něj vloží tvoje přihlášení ze souboru
`out/session.json` (formát Playwright *storageState*).

Sloneek (Angular SPA) drží přihlášení v `localStorage` pod klíči `sloneek-access-token` a
`sloneek-refresh-token`. Stačí je zkopírovat.

> Tokeny = tvoje přihlášení. Soubor nikam neposílej, necommituj (`out/` i `out/session.json` jsou v
> `.gitignore`), recorder ani `pnpm local` jejich hodnoty nikdy nevypisují (jen počty klíčů).

## Varianta A: konzole DevTools (nejrychlejší)

1. V prohlížeči, kde jsi přihlášený, otevři `https://app-pre-production.sloneek.com` (libovolnou stránku po přihlášení).
2. `⌥⌘J` (Console) a vlož:

```js
copy(JSON.stringify({ cookies: [], origins: [{ origin: location.origin,
  localStorage: ['sloneek-access-token', 'sloneek-refresh-token']
    .filter(k => localStorage.getItem(k) !== null)
    .map(k => ({ name: k, value: localStorage.getItem(k) })) }] }))
```

`copy()` je vestavěná funkce konzole – JSON je teď ve schránce (konzole vypíše jen `undefined`).
Pokud konzole hlásí, že vkládání je blokované, napiš nejdřív `allow pasting` a Enter.

3. V Terminálu v repu:

```bash
pbpaste > out/session.json && chmod 600 out/session.json
pnpm local:check --session-file out/session.json
```

## Varianta B: záložka (bookmarklet)

Vytvoř záložku s touto URL (celé na jeden řádek):

```
javascript:(()=>{const k=['sloneek-access-token','sloneek-refresh-token'].filter(x=>localStorage.getItem(x)!==null);navigator.clipboard.writeText(JSON.stringify({cookies:[],origins:[{origin:location.origin,localStorage:k.map(n=>({name:n,value:localStorage.getItem(n)}))}]})).then(()=>alert('Sloneek session: '+k.length+' klíče ve schránce'),e=>alert('Schránka nedostupná: '+e))})()
```

Na přihlášené stránce Sloneeku na záložku klikni (hláška „2 klíče ve schránce“), pak stejný
`pbpaste > out/session.json` jako výše.

## Použití

```bash
pnpm local recipes/absence-request.en.json --session-file out/session.json
```

Výsledný soubor vypadá takto (hodnoty zkrácené):

```json
{ "cookies": [], "origins": [ { "origin": "https://app-pre-production.sloneek.com",
  "localStorage": [ { "name": "sloneek-access-token", "value": "eyJ…" },
                    { "name": "sloneek-refresh-token", "value": "…" } ] } ] }
```

## Když to nefunguje

- **Video ukazuje login obrazovku** → access token vypršel. Přihlas se v prohlížeči znovu a soubor vyrob znovu
  (životnost tokenů na pre-prod jsme neověřovali; počítej s tím, že soubor je „na dnešek“).
- **`0 localStorage key(s)`** v logu → spustil jsi snippet na jiné doméně (např. na `sloneek.com` místo
  `app-pre-production.sloneek.com`). `origin` v souboru musí přesně odpovídat `start.url` recipe.
- Recorder v tomto režimu potřebuje Playwright Chromium: `pnpm --filter @svp/recorder exec playwright install chromium`.
