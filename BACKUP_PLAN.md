# Backup plan

Rule of thumb: **if preflight is RED, switch to the local copy.** Everything below has been tested unless it says otherwise.

| Problem | What you see | What to do |
| --- | --- | --- |
| Deployed URL down or very slow | Preflight RED, or the page spins | Use the local copy on your laptop: `npm start`, open http://localhost:3001. Same app, same data model. |
| Host was asleep (free tier) | First load takes 30–60 s | Run preflight 10 minutes before; it wakes the host. Open the URL once more right before you start. |
| Venue wifi down | Nothing loads from the deployed URL | Local copy. It works with no internet: fonts are bundled, the assistant uses the cache and local matcher, and weather shows sample data labeled SIMULATED. |
| AI model slow, down, rate-limited, or key revoked | Nothing: answers keep coming | Automatic fallback: cache, then the local matcher, within 6 s. Nothing to say unless asked ("it falls back to a rules-based matcher"). |
| An assistant answer looks odd | Picks that don't fit the story | Use a spare query from DEMO_SCRIPT.md, or tap a suggestion chip. |
| Page shows "Something went wrong" | A card: "Let's reload that." | Click **Reload the app**. Plans and favorites are on the server, so nothing is lost. |
| Leftover rehearsal plans or favorites | Extra cards in Plans or Saved | Local: `npm run reset-demo`. Render: open the service's **Shell** tab and run `npm run reset-demo`, or redeploy (the disk resets). |
| Port 3001 busy on the laptop | `npm start` says the port is in use | It prints the fix: stop the other process (`lsof -tiTCP:3001 -sTCP:LISTEN \| xargs kill`) or run `PORT=3002 npm start`. |
| Projector crops or shrinks the app | The phone frame looks tiny or cut off | Browser zoom (Cmd + / Cmd −). The layout scales; text never shrinks below 11 px. |
| Location or mic permission prompt appears | Browser dialog | Click **Block**. The app shows a friendly note and keeps working. |
| Laptop dies | — | Screenshots of every step: `artifacts/screenshots/chromium-1920/` (01–07). Present them as slides. |

## Setting up the local copy (do this the day before)

```bash
npm ci
npm run build
npm start        # http://localhost:3001
npm run preflight
```

Needs Node 22.13 or newer. No API key is required. With `LLM_API_KEY` and `LLM_MODEL` in `server/.env` the assistant uses the live model.
