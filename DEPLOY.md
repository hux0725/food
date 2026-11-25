# Deploy

**Host: Render.** Why: a `render.yaml` Blueprint makes it one click from the repo. Render also provides HTTPS (needed for location and microphone), a health check on `/api/health`, a secret-value prompt for the API key, a Shell tab for `npm run reset-demo`, and a persistent disk for SQLite. Railway would also work. Fly needs a Dockerfile and its CLI, which is more to go wrong the night before.

## Steps (about 10 minutes)

1. Push the branch (never `main`, never force):
   ```bash
   git push -u origin demo-final
   git push origin demo-ready-v1
   ```
2. In https://dashboard.render.com: **New → Blueprint**, connect GitHub, pick `Food-Plaftform-Project`, branch `demo-final`. Render reads `render.yaml`.
3. When asked for **LLM_API_KEY**, paste your Google (Gemini) API key, or leave it empty: the app works without it, using the cache and local matcher. Click **Apply**.
4. Wait for the deploy to finish (build is about 1–2 minutes). The service URL looks like `https://seattle-food-discovery.onrender.com`.
5. From your laptop:
   ```bash
   npm run preflight -- https://seattle-food-discovery.onrender.com
   ```
   It must not be RED. With a key set, "LLM key configured" is GREEN.

Optional: run the browser tests against the deployed copy:
```bash
E2E_BASE_URL=https://seattle-food-discovery.onrender.com npx playwright test --project=chromium-1920
```
These create and delete plans for the demo user. Run `npm run reset-demo` in the Render Shell afterwards.

## Settings that matter

| Setting | Value | Why |
| --- | --- | --- |
| Build command | `npm ci && npm run build` | Installs both packages (root and `server/`), type-checks, builds `dist/`. |
| Start command | `npm start` | Runs the server with `NODE_ENV=production`, serving `dist/` and `/api`. |
| Node | 22 (`NODE_VERSION`, `.node-version`) | `node:sqlite` needs Node 22.13 or newer. |
| `NODE_ENV` | **do not set** | Setting it to `production` at build time skips dev dependencies (Vite, TypeScript) and the build fails. `npm start` sets it for the server. |
| `LLM_API_KEY` | secret, entered in the dashboard | Only the server reads it. Never in git, never in a `VITE_` variable. |
| `DB_PATH`, `CACHE_PATH` | `/var/data/...` | On the persistent disk. |

## Disk: persistent vs ephemeral

- **Starter plan (in `render.yaml`)**: the disk at `/var/data` keeps plans, favorites, and the warmed assistant cache across deploys and restarts.
- **Free plan**: no disk. Remove the `disk:` block and set `DB_PATH=./data/bite.db` and `CACHE_PATH=./data/assistant-cache.json`. The filesystem is **ephemeral**: every deploy, restart, or spin-down wipes plans and favorites. Places are re-seeded on boot and the demo cache re-warms, so the demo still works, starting from a clean slate.

## Cold starts

- **Starter**: no sleeping. Nothing to do.
- **Free**: the service sleeps after about 15 minutes idle. The first request then takes about 30–60 s. Plan:
  1. Run `npm run preflight -- <url>` 10 minutes before going on stage. It wakes the service, and its first check reports "slow: the host was probably asleep" when that happened.
  2. Load the URL once more in the presenting browser right before you start.
  3. Optional: an uptime monitor (for example UptimeRobot) hitting `/api/health` every 10 minutes during the event.

## Resetting demo data on Render

Dashboard → the service → **Shell**:
```bash
npm run reset-demo
```
It removes all plans and favorites for the demo user and keeps the 68 places.

## Rolling back

Dashboard → **Events** → pick the previous successful deploy → **Rollback**. Or deploy the tag: set the service branch to `demo-ready-v1`.
