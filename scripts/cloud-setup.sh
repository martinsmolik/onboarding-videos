#!/usr/bin/env bash
# Idempotent setup for a Claude Code cloud session (Ubuntu 24.04, Node 22 + pnpm preinstalled).
# Run from anywhere: bash scripts/cloud-setup.sh   (the /onboarding-video skill runs it first)
# Prints only variable NAMES, never values.
set -u
cd "$(dirname "$0")/.."
SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"

echo "== system packages"
if ! command -v ffmpeg >/dev/null 2>&1; then
  ($SUDO apt-get update -qq && $SUDO apt-get install -y -qq --no-install-recommends ffmpeg) >/dev/null 2>&1 \
    && echo "  ✓ ffmpeg installed" || echo "  ✗ ffmpeg install failed (apt mirrors reachable?)"
else echo "  ✓ ffmpeg"; fi
if ! command -v yt-dlp >/dev/null 2>&1; then
  (pip install -q --user yt-dlp || pip install -q --break-system-packages yt-dlp) >/dev/null 2>&1 \
    && echo "  ✓ yt-dlp installed" || echo "  ! yt-dlp not installed (only needed for scenarios from an old YouTube video)"
fi
export PATH="$HOME/.local/bin:$PATH"

echo "== node dependencies"
command -v pnpm >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 || npm i -g pnpm@10 >/dev/null 2>&1
if pnpm install --frozen-lockfile >/tmp/svp-install.log 2>&1; then echo "  ✓ pnpm install"; else tail -15 /tmp/svp-install.log; echo "  ✗ pnpm install failed"; exit 1; fi

echo "== Playwright Chromium"
if pnpm --filter @svp/recorder exec playwright install --with-deps chromium >/tmp/svp-playwright.log 2>&1; then echo "  ✓ chromium"
else tail -15 /tmp/svp-playwright.log; echo "  ✗ chromium install failed (is the Playwright CDN on the network allowlist?)"; exit 1; fi

echo "== environment"
missing=()
for v in SLONEEK_DEMO_URL SLONEEK_DEMO_USER SLONEEK_DEMO_PASS; do
  [ -n "${!v:-}" ] && echo "  ✓ $v" || { echo "  ✗ $v missing"; missing+=("$v"); }
done
# Plan mode (default): Claude in this session drives the explorer and voices via the ElevenLabs connector.
# API mode needs both keys below (billed to those accounts, not to the user's plan).
if [ -n "${ANTHROPIC_API_KEY:-}" ] && [ -n "${ELEVENLABS_API_KEY:-}" ]; then echo "  ✓ API mode available (ANTHROPIC_API_KEY + ELEVENLABS_API_KEY)"
else echo "  · plan mode (no API keys; ElevenLabs connector needed in claude.ai)"; fi
for v in YT_CLIENT_ID YT_CLIENT_SECRET YT_REFRESH_TOKEN; do
  [ -n "${!v:-}" ] && echo "  ✓ $v" || echo "  ! $v missing (no YouTube upload; video goes to a git branch instead)"
done
if [ ${#missing[@]} -gt 0 ]; then echo "SETUP INCOMPLETE: ask an org Owner to add ${missing[*]} to the cloud environment"; exit 3; fi
echo "SETUP OK"
