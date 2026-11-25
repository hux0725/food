# Seattle Food Discovery

Pick where to eat in Seattle by budget, neighborhood, and time, ask a food assistant, and save dining plans and favorites.
One Node service (Fastify + SQLite) serves the React app and the API. The assistant uses Google Gemini when a key is set, and falls back to a cache and a local matcher otherwise.

## Run

Needs Node 22.13+.

```bash
npm ci                 # installs the app and server/ packages
npm run build
npm start              # http://localhost:3001
```

Development (hot reload, API proxied): `npm run dev` → http://localhost:5173

Optional AI: copy `server/.env.example` to `server/.env` and set `LLM_API_KEY` and `LLM_MODEL`. Without them everything still works.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit + API tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright: Chrome 1440/1920, mobile 390, Safari) incl. accessibility |
| `npm run test:eval` | 50-query assistant eval (local always; live model 3× if a key is set) |
| `npm run test:chaos` / `test:security` / `test:lighthouse` | Crash, config, load; secrets, logs, audit; Lighthouse (needs a running server) |
| `npm run test:all` | Lint, build, secret scan, and all of the above except Lighthouse |
| `npm run preflight -- <url>` | Backstage check: GREEN / YELLOW / RED |
| `npm run reset-demo` | Remove all plans and favorites for the demo user |

## Demo docs

[DEMO_SCRIPT.md](DEMO_SCRIPT.md) · [BACKUP_PLAN.md](BACKUP_PLAN.md) · [TALKING_POINTS.md](TALKING_POINTS.md) · [DEPLOY.md](DEPLOY.md) · [FINAL_REPORT.md](FINAL_REPORT.md)

Ratings and waits are sample data, travel times are estimates, photos are cuisine stand-ins, and plans do not reserve a table.
