# Final report: Seattle Food Discovery, `demo-final`

## 1. Status

**Demo-ready on a laptop. Not deployed, and AI runs without a live model, because of two blockers that need you:**

1. **No LLM API key** in `server/.env`. The assistant works (cache plus local matcher, 3 picks with reasons), but the live-model eval and live preflight are NOT RUN. To fix it, add your Google (Gemini) key as `LLM_API_KEY`, with `LLM_MODEL=gemini-2.5-flash-lite`, to `server/.env` (or to Render), then run `npm run test:eval` and `npm run preflight`.
2. **No deploy credentials.** `git push -u origin demo-final` failed with `fatal: could not read Username for 'https://github.com': terminal prompts disabled`. No Render, Fly or Railway login is available either. DEPLOY.md has copy-paste steps (about 10 minutes).

Everything else below was run, and the output is pasted.

## 2. What changed

| Commit | Phase |
| --- | --- |
| `90eebff` | 1: audit (AUDIT.md), decisions, progress log |
| `a8c8ed2` | 2: Fastify + SQLite server, plans/favorites API, assistant with cache → LLM → local fallback, front-end hardening |
| `e399580` | 3a: unit, API, eval, e2e, accessibility tests and the bugs they found |
| `f90d63d` | 3b + 2E + 4: chaos, security, Lighthouse, demo kit, preflight, Render files |
| (this commit) | 5: final report; tag `demo-ready-v1` |

Bugs the tests found and fixed:
- assistant filters leaked into the next question;
- plans on other days looked lost after a reload;
- stale cached rankings;
- "anything open late?" was treated as off-topic;
- Safari's time field blocked keyboard users;
- 7 accessible-name mismatches;
- touch targets under 44 px;
- an unhandled rejection when the server dies mid-request;
- a double close of the database.

All decisions are listed in DECISIONS.md (items 1–38).

## 3. Test evidence

All of these were run on commit `f90d63d`. The clean-room rows are from a fresh `git clone` into `/tmp/sfd-cleanroom`, with no `.env` and on Node v22.23.5.

| Check | Command | Real output |
| --- | --- | --- |
| Clean install | `npm ci` | `added 95 packages` (server), `added 297 packages` (root) |
| Build | `npm run build` | `✓ built in 406ms`, JS 96.40 kB gzip |
| T1 static | `npm run lint`, `npm run typecheck`, `npm run scan:dist` | no errors; `GREEN  no secrets in dist/ (4 text files scanned)` |
| T2+T3 unit + API | `npm test` | `Test Files  8 passed (8)` / `Tests  94 passed (94)` |
| T4 eval | `npm run test:eval` | `local: 50 queries, 0 failed, p50 0 ms, p95 2 ms` / `live model: NOT RUN` |
| T5+T6 e2e + axe + keyboard + touch | `npm run test:e2e` (Chrome 1440 and 1920, Safari/WebKit 1440, mobile 390) | `133 passed (2.2m)`, 0 flaky |
| Start + preflight | `npm start`, then `npm run preflight -- http://localhost:3200` | `YELLOW: 17 green, 1 yellow, 0 red in 0.1s` (the yellow is the missing key) |
| T7 Lighthouse | `npm run test:lighthouse` | mobile `performance 100, accessibility 100, best-practices 100, seo 100`; desktop `99, 100, 100, 100` |
| T8 chaos | `npm run test:chaos` | `10/10 chaos checks passed` (kill -9 mid-writes: `72 acknowledged before the kill, 72 stored, integrity ok`; SIGTERM with a stalled request: `exit 0 in 1515 ms`) |
| T9 security | `npm run test:security` | `9/9 security checks passed` (npm audit: 0 vulnerabilities for root and server) |
| T10 soak | `npm run test:soak` | 10 of 10 consecutive runs, each `94 passed` plus `33 passed`; ends `soak exit=0` |
| Preflight RED path | preflight against a dead port | prints RED and exits 1 |
| Dev mode | `npm run dev`, then `/api/health` through Vite | `{"status":"ok",…,"places":68,"db":true,"llmConfigured":false}`; the "AI is off… not a bug" banner appears (dev only) |

Reports and screenshots are in `artifacts/` (gitignored):
- `playwright/` holds the HTML report.
- `screenshots/<viewport>/01–07` shows the demo path at each viewport.
- `eval/`, `chaos/`, `security/` and `lighthouse/` hold their suites' reports.

## 4. Not run

| Item | Why | Covered instead by |
| --- | --- | --- |
| Live LLM eval (3× each, p50/p95) | no API key | fake-Google (Gemini) API tests (timeouts, retries, 401, 429, bad JSON, invented IDs); local eval 50/50 |
| Preflight against the deployed URL | not deployed | preflight GREEN apart from the key, locally and in the clean room |
| Deployed-URL e2e (`E2E_BASE_URL=…`) | not deployed | full suite locally |
| Firefox | not one of the configured Playwright projects | Chrome and Safari engines |
| Real phone, projector, microphone | needs hardware | mobile-390 emulation, projector zoom CSS; see the manual checklist |

## 5. Deploy

- **Host:** Render, using `render.yaml` (Blueprint). It provides HTTPS, a health check on `/api/health`, a secret prompt for the key, and a Shell for `npm run reset-demo`.
- **Starter plan:** a persistent disk at `/var/data` holds the database and assistant cache, so data survives restarts and redeploys.
- **Free plan:** works, but the disk is ephemeral (plans reset on every restart) and the app sleeps after 15 minutes. Cold-start plan: open the URL and run preflight 10 minutes before going on stage, and keep the tab open.
- **Steps:** DEPLOY.md.

## 6. Known risks and limits

- **Sample data on screen.** Ratings and waits are sample data, travel times are estimates, photos are cuisine stand-ins, and plans don't reserve a table. The UI labels all four; e2e checks the labels.
- **One shared demo user.** There are no accounts (out of scope); `TODO(auth)` marks both places to change.
- **Burst test limit.** Chaos sends 100 concurrent connections. At 300 simultaneous connects, macOS (`somaxconn` = 128) reset 1 connection; that's a laptop kernel limit, not the server. The rate limiter returns 429s, never 5xx.
- **Weather.** Weather comes from Open-Meteo. If it's slow or down, the chip shows sample weather labeled SIMULATED (tested).
- **Zero picks on purpose.** "sushi under $5 in Ballard" returns 0 picks with an honest "nothing fits, relax this filter" answer. This is intentional and is part of DEMO_SCRIPT.md.
- **Voice input** uses the browser's speech recognition (Chrome and Safari only). It is not automatically testable, and typing always works.

## 7. MANUAL CHECKLIST (before going on stage)

- [ ] Add `LLM_API_KEY` and `LLM_MODEL` (Render → Environment), then run `npm run test:eval` and confirm the live rows pass 3/3.
- [ ] Deploy with DEPLOY.md, then run `npm run preflight -- https://<your-app>.onrender.com` and expect GREEN.
- [ ] Run e2e against the deployed URL: `E2E_BASE_URL=https://<your-app>.onrender.com npx playwright test --project=chromium-1440`.
- [ ] Projector: open at 1920×1080, check that text reads from the back row, and walk the DEMO_SCRIPT 2-minute path once.
- [ ] Real phone (iOS Safari and Android Chrome): open the URL, ask one query, save a plan, and check that it appears in Plans.
- [ ] Microphone: on the stage laptop, tap the mic in the assistant once and allow access (or skip voice and type).
- [ ] Venue Wi-Fi: run preflight on the venue network. If it's bad, switch to the local copy (BACKUP_PLAN.md, "Venue wifi down").
- [ ] `npm run reset-demo` (Render Shell) right before going on stage, then preflight again.
- [ ] Keep the backup laptop running `npm start` locally.

## 8. Refactor ideas (after the demo, not done)

- Split `src/App.tsx` (1,429 lines) into screens (Home, Assistant, Plans, Profile) and hooks (`usePlans`, `useFavorites`, `useAssistant`).
- Move inline view state into a reducer; the assistant's "applied filters" logic is a good first candidate.
- Add real authentication and per-user rows (the schema already keys by `user_id`).
- Move places to an editable admin source instead of `travelData.ts` plus a seed.
- Serve responsive photo sizes (`srcset`), and real photos with licensing.
- Use a hosted database (Postgres or Turso) if the app ever runs more than one instance.
- Add Firefox to CI, and run the soak and Lighthouse in CI on every pull request.
