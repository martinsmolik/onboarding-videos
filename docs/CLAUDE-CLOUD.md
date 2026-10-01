# Videa bez terminálu: Claude Code na webu

> Hlavní cesta pro kolegy s Macem je **[lokálně v Claude desktop app](MAC.md)** (bez nastavování u správce, video rovnou na disku). Cloud níže je záloha, např. když si někdo nemůže nic stáhnout.

Kolegové vyrábějí videa v prohlížeči na **claude.ai/code**: vyberou repo `onboarding-videos`, napíšou `/onboarding-video` a Claude je provede. Pipeline běží v cloudovém kontejneru Anthropicu. Nic se nikam nenasazuje.

## Pro kolegy (každé video)

1. Otevři [claude.ai/code](https://claude.ai/code).
2. Vyber repozitář **martinsmolik/onboarding-videos** a prostředí **Onboarding videa**.
3. Napiš `/onboarding-video` (nebo jen „chci video o tom, jak…“) a odpovídej na otázky.
4. Schval scénář. Pak počkej na odkaz na hotové video (jednotky až desítky minut).

Potřebuješ (jednou):

- účet v Claude Team organizace Sloneek s přístupem ke Claude Code,
- **ElevenLabs konektor**: claude.ai → Settings → Connectors → ElevenLabs, přihlas se svým ElevenLabs účtem,
- v ElevenLabs přidaný hlas z `config/voices.json` (Voice Library → Add to my voices), jinak ti Claude nabídne jiný.

**Co to stojí:** všechno jde z tvého plánu. Claude sám prokliká aplikaci a namluví video (kredity tvého ElevenLabs účtu). Delší video spotřebuje znatelnou část týdenního limitu, protože Claude čte stránku u každého kroku.

## Pro správce (jednou)

Nastavuje **Owner** Claude Team organizace. Postup podle [Configure cloud environments](https://code.claude.com/docs/en/cloud-environments). Názvy položek v UI se mohou lišit.

### 1. GitHub

V admin nastavení organizace povol GitHub konektor. U veřejného repa stačí, aby si ho kolega vybral. Aby šlo pushovat výstupy do větví (`video/<id>`), musí mít Claude k repu zápis (GitHub App nainstalovaná na repo).

### 2. Sdílené cloud prostředí „Onboarding videa“

**Setup script** (zrychlí start, skill ho stejně spouští sám):

```bash
bash scripts/cloud-setup.sh || true
```

**Síť: Custom allowlist** (navíc k výchozím registrům balíčků):

| doména | proč |
|---|---|
| doména z `SLONEEK_DEMO_URL` (např. `app-pre-production.sloneek.com`) | demo aplikace, kterou agent prokliká a nahraje |
| `storage.googleapis.com` | stažení namluvených mp3 z ElevenLabs konektoru |
| `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, `playwright.azureedge.net` | stažení Chromia |
| `archive.ubuntu.com`, `security.ubuntu.com` | ffmpeg přes apt |
| `oauth2.googleapis.com`, `www.googleapis.com` | jen pro upload na YouTube |
| `www.youtube.com`, `*.googlevideo.com` | jen pro scénář ze starého YouTube videa |
| `api.anthropic.com`, `api.elevenlabs.io` | jen pro režim API (viz níže) |

**Proměnné prostředí:**

| proměnná | povinná | poznámka |
|---|---|---|
| `SLONEEK_DEMO_URL` | ano | **demo / pre-prod**, nikdy produkce s daty klientů |
| `SLONEEK_DEMO_USER`, `SLONEEK_DEMO_PASS` | ano | samostatný demo účet jen pro videa |
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` | ne | bez nich jde video do git větve; `YT_PRIVACY` default `unlisted` |

> ⚠️ **Proměnné ve sdíleném prostředí vidí každý, kdo prostředí používá** (Claude je umí vypsat). Proto dedikovaný demo účet bez přístupu k reálným datům a žádné osobní přihlašovací údaje. Při odchodu člověka z týmu heslo změň.

**Režim plánu vs. režim API.** Výchozí je režim plánu: explorer řídí Claude v session a hlas jde přes ElevenLabs konektor, takže v prostředí **nejsou žádné API klíče**. Režim API (`ANTHROPIC_API_KEY` + `ELEVENLABS_API_KEY` v prostředí) je rychlejší, ale platí ho ty klíče a vidí je všichni uživatelé prostředí. Používej ho jen v samostatném prostředí pro pár lidí, ne ve sdíleném.

### 3. Ověření

Otevři novou session s tímto prostředím a napiš: *„spusť bash scripts/cloud-setup.sh a pak pnpm smoke“*. Má skončit `SETUP OK` a `SMOKE PASS`.

## Náklady na jedno video (orientačně)

- Režim plánu: session (včetně exploreru) jde z týmového plánu daného kolegy, hlas z jeho ElevenLabs kreditů (typicky 1–5 tisíc znaků na video).
- Režim API: explorer (Sonnet 5.5) desítky centů až jednotky dolarů podle počtu kroků a oprav (loguje se u každého kroku), ElevenLabs podle znaků.
