# Progress

Read this and DECISIONS.md first after a context reset.

## Current
- All phases done. Tagged `demo-ready-v1`. Remaining items need the user: API key, GitHub/Render login (see FINAL_REPORT.md §1 and §7).
- Phase 5: soak 10/10; clean room (fresh clone, `npm ci`, build, lint, typecheck, 94 tests, eval 50/50, e2e 133/133, start + preflight YELLOW only for the key); FINAL_REPORT.md.

## Done
- Phase 1 audit: AUDIT.md. Commit 90eebff.
- Phase 2 build (server, persistence, assistant, front end). Commit a8c8ed2.
- Phase 2E demo kit: DEMO_SCRIPT.md, BACKUP_PLAN.md, TALKING_POINTS.md, `npm run preflight` (GREEN/YELLOW/RED, exit 1 on RED; verified both ways).
- Phase 3 tests, all run:
  - lint clean; build clean; dist secret scan GREEN
  - Vitest 94/94 (unit + API)
  - eval 50/50 local; live NOT RUN (no key)
  - Playwright 125/125 + crash-card and XSS tests (Chrome 1440/1920, mobile 390, Safari)
  - axe 0 critical/serious on every tab and dialog; keyboard-only flow; 44 px targets on mobile
  - Lighthouse mobile 100/100/100/100, desktop 99/100/100/100
  - chaos 10/10; security 9/9
- Phase 4 deploy prep: render.yaml, DEPLOY.md, .node-version. Not deployed: no Render credentials (blocker).

## Open / blocked
- LLM_API_KEY is empty in server/.env: live-LLM eval and live preflight are NOT RUN.
- Deploy: no host login/credentials. Copy-paste steps in DEPLOY.md.
