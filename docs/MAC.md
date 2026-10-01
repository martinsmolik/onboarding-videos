# Videa na vlastním Macu (Claude desktop app)

Video vyrobí Claude přímo na tvém Macu. Nepotřebuješ terminál, admin práva ani nic instalovat ručně. Hotové video skončí na disku.

## Jednou na začátku (asi 10 minut)

1. **Claude desktop app**: stáhni z [claude.ai/download](https://claude.ai/download), přihlas se firemním účtem (Claude Team Sloneek, s přístupem ke Claude Code).
2. **ElevenLabs konektor**: v aplikaci Settings → Connectors → ElevenLabs → Connect, přihlas se svým ElevenLabs účtem.
3. **Hlas**: v ElevenLabs → Voice Library najdi hlas z `config/voices.json` (česky „Warm Czech Female Voice – Jana“) a dej *Add to my voices*. Když ho nepřidáš, Claude ti nabídne jiný.
4. **Stažení projektu**: v aplikaci otevři záložku **Code**, vyber libovolnou složku (např. Dokumenty) a napiš:

   > Stáhni projekt https://github.com/martinsmolik/onboarding-videos do složky ~/onboarding-videos.

   Když macOS nabídne instalaci „vývojářských nástrojů“ (kvůli gitu), potvrď ji a počkej, až doběhne.

## Každé video

1. V Claude desktop app → **Code** → nová session ve složce **~/onboarding-videos**.
2. Napiš `/onboarding-video` (nebo „chci video o tom, jak…“).
3. Poprvé si Claude stáhne nástroje (Node, ffmpeg, prohlížeč; pár minut, ~500 MB v `~/.onboarding-videos`). Pak otevře soubor `.env` v TextEditu: doplň svůj **login na pre-prod** (`SLONEEK_DEMO_USER`, `SLONEEK_DEMO_PASS`), ulož a napiš Claudovi, že je hotovo. Heslo nikdy nepiš do chatu.
4. Odpovídej na otázky, schval scénář a počkej. Mac nech zapnutý a připojený k síti (uspání Claude během nahrávání sám blokuje).
5. Hotové video ti Claude ukáže ve Finderu: `out/<název>/final.mp4`, vedle titulky `final.srt` a kapitoly `chapters.txt`.

## Dobré vědět

- **Nahrávání mění data na pre-prod** pod tvým účtem (vytvoří absenci, uživatele…). Claude se zeptá, než začne.
- **Co to stojí:** jde to z tvého Claude plánu a ElevenLabs kreditů. Delší video spotřebuje znatelnou část týdenního limitu.
- **Aktualizace:** Claude si na začátku každé session stáhne nejnovější verzi projektu.
- **Úklid:** nástroje jsou v `~/.onboarding-videos`, videa v `~/onboarding-videos/out`. Obojí můžeš kdykoli smazat.
- Něco nefunguje: popiš to Claudovi. Když si neporadí, pošli správci repa, co Claude napsal.
