# Handoff — SMC Research Engine

**Обновлено:** 2026-08-01

**Статус:** research platform; production claims require explicit gates.

This file is the general entry point. Use the specialized documents instead of treating this as a second specification:

- `docs/CONTEXT.md` — current repository map and working protocol.
- `SPEC.md` — active mechanical system, confirmed research and negative knowledge.
- `docs/INDICATOR-RESEARCH-HANDOFF.md` — full Zonda Apex/Reversal reconstruction handoff.
- `ci-results/README.md` — canonical research artifact index.
- `docs/V0-CLAUDE-PROMPT.md` — ready-to-paste prompt for Claude Fable 5 in v0.app.
- `docs/DESIGN-SYSTEM.md` — canonical visualizer UI contract.

## Current priorities

1. Preserve a clean `main` with the accepted shadcn/Vercel/Geist visualizer.
2. Keep indicator reconstruction isolated in a `research/*` branch with exact exports, tests and machine-readable reports.
3. Do not promote any V1–V6 Reversal research detector; the strict critic rejects all of them.
4. Keep Apex `apex-1.2-cross-oos-sigma-4` protected by exact OOS regression.
5. Treat the open real-data chart restore bug as open until user QA confirms a fix.

## Completion gate

```bash
npm test
npx tsc --noEmit
node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs
npm run research:integrity
```

Commits for UI, production logic, research and documentation must remain separate. A failed result is recorded as negative knowledge, not silently discarded or reframed as success.
