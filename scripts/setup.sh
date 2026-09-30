#!/usr/bin/env bash
# Idempotent setup for macOS + Linux. Usage: bash scripts/setup.sh  (or: pnpm run setup / make setup)
set -u
cd "$(dirname "$0")/.."

OK=(); WARN=(); FAIL=()
ok()   { OK+=("$1");   echo "  ✓ $1"; }
warn() { WARN+=("$1"); echo "  ! $1"; }
bad()  { FAIL+=("$1"); echo "  ✗ $1"; }
OS="$(uname -s)"

echo "== 1/7 Node"
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -ge 22 ]; then ok "node $(node -v)"; else
    bad "node $(node -v) je moc stary (potreba >=22). macOS: brew install node@22  |  nebo https://nodejs.org"; fi
else
  bad "node neni nainstalovan. macOS: brew install node@22"
fi
if [ ${#FAIL[@]} -gt 0 ]; then echo; echo "Bez Node >=22 nelze pokracovat."; exit 1; fi

echo "== 2/7 pnpm"
if ! command -v pnpm >/dev/null 2>&1; then
  (corepack enable && corepack prepare pnpm@10 --activate) >/dev/null 2>&1 || true
fi
if ! command -v pnpm >/dev/null 2>&1; then
  npm i -g pnpm@10 >/dev/null 2>&1 || true
fi
if command -v pnpm >/dev/null 2>&1; then ok "pnpm $(pnpm -v)"; else
  bad "pnpm se nepodarilo nainstalovat. Zkus: sudo npm i -g pnpm@10  (nebo brew install pnpm)"; echo; exit 1; fi

echo "== 3/7 pnpm install"
if pnpm install --frozen-lockfile >/tmp/svp-install.log 2>&1 || pnpm install >/tmp/svp-install.log 2>&1; then
  ok "zavislosti nainstalovany"
else
  tail -20 /tmp/svp-install.log; bad "pnpm install selhal (log: /tmp/svp-install.log)"
fi

echo "== 4/7 ffmpeg / ffprobe"
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  ok "ffmpeg + ffprobe"
else
  if [ "$OS" = "Darwin" ]; then bad "ffmpeg chybi -> brew install ffmpeg"; else bad "ffmpeg chybi -> sudo apt install ffmpeg"; fi
fi

echo "== 5/7 yt-dlp (jen pro krok knowledge z YouTube; pro smoke neni potreba)"
if command -v yt-dlp >/dev/null 2>&1; then ok "yt-dlp"; else
  if [ "$OS" = "Darwin" ]; then warn "yt-dlp chybi -> brew install yt-dlp"; else warn "yt-dlp chybi -> pipx install yt-dlp  (nebo pip install --user yt-dlp)"; fi
fi

echo "== 6/7 Playwright chromium"
if [ -n "${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}" ]; then
  ok "preskoceno (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD je nastaveno, prohlizece uz existuji)"
else
  # recorder i explorer maji stejnou verzi playwright (1.56.0) -> sdileny cache, staci jednou
  if pnpm --filter @svp/recorder exec playwright install chromium; then ok "chromium nainstalovan (recorder + explorer)"; else bad "playwright install chromium selhal"; fi
fi

echo "== 7/7 .env"
if [ -f .env ]; then ok ".env uz existuje"; else cp .env.example .env && ok ".env vytvoren z .env.example (doplň klice; pro smoke netreba)"; fi

echo
if [ ${#FAIL[@]} -eq 0 ]; then
  echo "== smoke test"
  if pnpm smoke; then ok "smoke PASS"; else bad "smoke FAIL (viz vystup vyse)"; fi
else
  warn "smoke preskocen kvuli chybam vyse"
fi

echo
echo "================ SOUHRN ================"
for m in "${OK[@]:-}";   do [ -n "$m" ] && echo "✓ $m"; done
for m in "${WARN[@]:-}"; do [ -n "$m" ] && echo "! $m"; done
for m in "${FAIL[@]:-}"; do [ -n "$m" ] && echo "✗ $m"; done
[ ${#FAIL[@]} -eq 0 ]
