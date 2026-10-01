# Videa bez terminálu: Claude Code na webu

Kolegové vyrábějí videa v prohlížeči na **claude.ai/code**: vyberou repo `onboarding-videos`, napíšou `/onboarding-video` a Claude je provede. Pipeline běží v cloudovém kontejneru Anthropicu. Nic se nikam nenasazuje.

## Pro kolegy (každé video)

1. Otevři [claude.ai/code](https://claude.ai/code).
2. Vyber repozitář **martinsmolik/onboarding-videos** a prostředí **Onboarding videa**.
3. Napiš `/onboarding-video` (nebo jen „chci video o tom, jak…“) a odpovídej na otázky.
4. Schval scénář. Pak počkej na odkaz na hotové video (jednotky až desítky minut).

Potřebuješ účet v Claude Team organizace Sloneek s přístupem ke Claude Code.

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
| `api.anthropic.com` | explorer (agent v prohlížeči) a scenarist |
| `api.elevenlabs.io` | hlas a titulky |
| `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, `playwright.azureedge.net` | stažení Chromia |
| `archive.ubuntu.com`, `security.ubuntu.com` | ffmpeg přes apt |
| `oauth2.googleapis.com`, `www.googleapis.com` | jen pro upload na YouTube |
| `www.youtube.com`, `*.googlevideo.com` | jen pro scénář ze starého YouTube videa |

**Proměnné prostředí:**

| proměnná | povinná | poznámka |
|---|---|---|
| `SLONEEK_DEMO_URL` | ano | **demo / pre-prod**, nikdy produkce s daty klientů |
| `SLONEEK_DEMO_USER`, `SLONEEK_DEMO_PASS` | ano | samostatný demo účet jen pro videa |
| `ANTHROPIC_API_KEY` | ano | vlastní klíč s měsíčním limitem útraty |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | ano | `ELEVENLABS_MODEL_ID` volitelně (default `eleven_multilingual_v2`) |
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` | ne | bez nich jde video do git větve; `YT_PRIVACY` default `unlisted` |

> ⚠️ **Proměnné ve sdíleném prostředí vidí každý, kdo prostředí používá** (Claude je umí vypsat). Proto: dedikovaný demo účet bez přístupu k reálným datům, API klíče s limity, žádné osobní přihlašovací údaje. Při odchodu člověka z týmu klíče rotuj.

### 3. Ověření

Otevři novou session s tímto prostředím a napiš: *„spusť bash scripts/cloud-setup.sh a pak pnpm smoke“*. Má skončit `SETUP OK` a `SMOKE PASS`.

## Náklady na jedno video (orientačně)

- Explorer (Sonnet 5.5): desítky centů až jednotky dolarů podle počtu kroků a oprav. Cena se loguje u každého kroku.
- ElevenLabs: podle počtu znaků narace (typicky 1–5 tisíc znaků).
- Session v Claude Code jde z předplatného Team.
