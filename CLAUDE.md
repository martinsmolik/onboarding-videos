# onboarding-videos

Pipeline for Sloneek onboarding screencasts: `knowledge > explore > tts > record > mux > upload`, all state in `out/<id>/`. Design rules and stage contracts: `README.md`; team quickstart (Czech): `docs/TEAM-ONBOARDING.md`.

- Someone wants a video made → use the `/onboarding-video` skill (`.claude/skills/onboarding-video/SKILL.md`). Users are usually non-technical colleagues in a Claude Code web session; cloud setup: `docs/CLAUDE-CLOUD.md`.
- Checks before committing code: `pnpm typecheck && pnpm test && pnpm smoke`.
- Never commit `.env`, `out/` or `storage-state*.json`; credentials come only from env.
