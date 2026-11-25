# Phase 1 audit

Audited on branch `demo-final` at commit d789786 (baseline). Line numbers refer to that commit.
Legend: OK · PROBLEM (file:line, priority) · UNSURE. Every P0/P1 PROBLEM is fixed in Phase 2; the fix is noted.

Note: the brief describes 35 places in 9 neighborhoods. The repo already has **68 places in 18 neighborhoods**
(added from the Seattle Times list in an earlier session, kept at the owner's request). All numbers below use 68.

## Build and repo

| Item | Status |
|---|---|
| `npm install`, `npm run build` | OK. Zero errors, zero warnings (tsc, server typecheck, vite build 286 KB JS / 88 KB gzip). |
| `.gitignore` | PROBLEM P1: no `*.db`, test artifacts. Fixed in baseline commit (`*.db*`, `artifacts/`, `test-results/`, `playwright-report/`, `coverage/`, `.tmp/`). |
| Secrets in git history | OK. `git log -p --all` has no `sk-ant`, `sk-…` or `API_KEY=value` strings. `server/.env` is ignored and has an empty key. |
| Nested gitlink `Food-Plaftform-Project` (mode 160000, no .gitmodules) | PROBLEM P1: breaks clones. Removed in baseline commit. |
| Node engines | OK: `>=22.12` in both package.json files; tested on Node 22.23.5. |
| ESLint | PROBLEM P1: no config. Added in T1. |

## index.html and metadata

| Item | Status |
|---|---|
| `#test` before `<html>` | PROBLEM P0 (index.html:2): visible text at the top of every page. Fixed. |
| lang, title, viewport, favicon | OK (favicon.svg exists). |
| meta description, theme-color, Open Graph | PROBLEM P2: missing. Added. |
| Google Fonts from CDN | PROBLEM P1 (index.html:9-14): venue wifi risk. Fonts self-hosted via @fontsource, fallback stacks kept. |

## Assistant contract (src/ai/provider.ts, src/ai/types.ts)

Request today (`AssistantRequest`): `{ message, location, neighborhood|null, mode: 'walk'|'bike'|'car', budget|null, mealMoment, places: AssistantPlace[] }`.
Response today (`AssistantResponse`): `{ reply, preference|null, neighborhood|null, maxTravelMinutes|null, maxBudget|null, rankedIds: string[], reasons: Record<id,string>, source: 'local'|'remote', error? }`.

| Item | Status |
|---|---|
| No URL set | OK: uses the local matcher (the default today). |
| Failure / non-2xx | PROBLEM P0 (provider.ts:27-32): falls back, but sets `error`, which App.tsx:403 renders as a red alert to the audience. Fixed: fallback is silent. |
| Timeout | PROBLEM P0 (provider.ts:15): no timeout; a hung server hangs "Looking through Seattle places…" forever. Fixed: 8 s client timeout (server has its own 6 s LLM timeout). |
| Malformed response | OK: `normalizeRemote` rejects it and falls back (with the visible error above). |
| Request sends the full place list from the browser | PROBLEM P1: the server must not trust client-supplied places. Fixed: the server uses its own DB rows; the request sends context only. |

New contract (in `shared/types.ts`): request adds `seattleTime`, `cuisine`, `userLocation`; drops `places`. Response `source` becomes `'llm' | 'cache' | 'local'`; `error` removed. The visible UI behaviour is unchanged (reply text + up to 3 picks + reasons), so this was not a blocker.

## Data (src/data/places.ts)

Checked by script (68 records): no missing fields, no duplicate ids, all 18 neighborhoods spelled consistently, 25 cuisines, all photo paths exist.

| Item | Status |
|---|---|
| Two "Bakery Nouveau" entries (ids already distinct) | PROBLEM P1 (places.ts:134, 502): identical names. Renamed "Bakery Nouveau Capitol Hill" / "Bakery Nouveau West Seattle". |
| How to Cook a Wolf `$$$` with a $28 serving | PROBLEM P2: tier/price mismatch. Tier set to `$$`. |
| No coordinates | PROBLEM P1: "Use my current location" cannot rerank. Coordinates added to all 68 (see DECISIONS.md). |
| Ratings only for some places | OK: null shown as "no public score". |

## travel.ts

| Item | Status |
|---|---|
| Division by zero / NaN | OK: divides by constants; `miles` is always > 0 (checked). |
| Absurd values | UNSURE→OK: walking estimates reach 166 min (Tomo, 8.3 mi). Honest for walking; labeled as estimates. |
| Rounding | OK (whole minutes, minimums 5/3/6). |

## Meal-time and timezone

| Item | Status |
|---|---|
| Meal moment uses Seattle time | OK (App.tsx:37-45, `Intl` with America/Los_Angeles; DST handled by Intl). |
| "Today" uses Seattle date | OK (App.tsx:28-35). |
| `today`/`moment` never update after load | PROBLEM P2: a tab left open past an hour boundary shows a stale meal moment. Fixed (re-evaluated each minute). |

## Calendar

| Item | Status |
|---|---|
| Month grid | OK: built from `new Date(y, m, 1)` in local time and string keys; leap years and every start weekday come out right. |
| Date string → Date shifting a day | OK: all formatting uses `T12:00:00` local noon, which cannot cross a date line. |
| Clearing the date input | PROBLEM P0 (App.tsx:821, 327): `new Date('T12:00:00')` is Invalid Date, then `Array(NaN)` throws "Invalid array length" and the whole app white-screens. Fixed. |
| Past dates | PROBLEM P1: `min=today` in inputs only; nothing enforced. Decision: API rejects new plans in the past; edits of existing plans cannot move them into the past. |
| Duplicate plans | PROBLEM P1 (App.tsx:350): saving a place again silently overwrites its other plan. Now one plan per place per date; duplicate returns 409 with a clear message. |
| Plan for a place that no longer exists | PROBLEM P2 (App.tsx:833): hidden but still counted. FK constraint now prevents it; the UI skips orphan rows in the count. |

## UI and UX — controls that do nothing or little

| Control | Status |
|---|---|
| "Use my current location" | PROBLEM P0: only checks permission. Now reranks by distance with a visible note. |
| Date chip / filter-sheet "Date" | PROBLEM P1: only affects plans. Relabeled "Plan date". |
| Weather "Overcast · 52°F SIMULATED" | PROBLEM P1: hardcoded. Now Open-Meteo with fallback label. |
| "Alex Morgan" / "Hello Alex!" / "AM" | PROBLEM P1: hardcoded in 3 places. One constant now. |
| Profile "Taste profile: adventurous…" | PROBLEM P1: an invented claim. Removed. |
| Search "GO" button | PROBLEM P1 (App.tsx:642): does nothing when the box is empty (search is live). Now focuses the input; label is "Search". |
| Assistant header button | PROBLEM P2 (App.tsx:486): re-opens an already open panel. Now collapses the panel. |
| Mic | PROBLEM P1: shown where unsupported; failure posts a chat message. Hidden when unsupported; permission denial gets a friendly note. |
| Assistant "AI is off" banner/prompt (added earlier at the owner's request) | PROBLEM P0 on stage: tells the audience the AI is off. Shown only in development (see DECISIONS.md). |
| "You: " text prefix on user chat bubbles | PROBLEM P2: debug-looking. Removed (styled bubble instead). |

## Loading, empty, error states

| State | Status |
|---|---|
| Assistant thinking | OK-ish: text "Looking through Seattle places…". Made a typing indicator with aria-live. |
| Zero search results / filters match nothing | OK (`empty-results` with Clear filters). |
| Plans empty / favorites empty | OK. |
| Plans/favorites API errors | N/A before (localStorage). Added error + retry. |
| Top-level error boundary | PROBLEM P0: none, so any render error is a white screen. Added. |

## Responsive and projector

| Item | Status |
|---|---|
| 390x844 | OK layout (full-bleed under 500 px). |
| 1440x900, 1920x1080 | PROBLEM P1: the app is a 430 px phone frame; text from 6 px (`.context-pick span`) to 11 px is unreadable from a distance. Minimum text raised to 11–12 px and the frame scales up on large screens. |
| Tap targets | PROBLEM P1: several under 44 px (chips 36 px, icon buttons 38–42 px, suggestion pills). Raised on touch layouts. |

## Accessibility

| Item | Status |
|---|---|
| Alt text | OK (stand-in photo alts). |
| Icon button labels | OK for heart, close, send, mic, calendar. PROBLEM: chat input and search input have no label (search reads as "GO"). Fixed. |
| Modals/sheet focus trap, Esc, focus return | PROBLEM P1: none for filters, schedule, details, confirmation. Fixed with one shared hook. |
| Chat updates announced | PROBLEM P2: no live region. Fixed. |
| Contrast | UNSURE: measured by axe in T6. |

## Assets

| Item | Status |
|---|---|
| Photo sizes | OK: largest 241 KB (all ≤ 300 KB), but 900 px wide for 400 px slots. Recompressed. |
| width/height, lazy loading | PROBLEM P1: none; layout shift. Added. |

## State and storage

| Key | Shape | Validated on read |
|---|---|---|
| `bite-saved` | `string[]` | Yes (array of strings). |
| `bite-plans` | `{placeId, date, time}[]` | PROBLEM P1 (App.tsx:248-251): only `placeId` checked; a bad `date` renders "Invalid Date". Fixed (full validation), and both keys become a one-time migration source. |

Corrupted JSON falls back to empty (OK). Other risks: `sendMessage` awaits a status check before setting busy, so a double Enter sends twice (App.tsx:375, P1, fixed). `confirmPlan` has no in-flight guard (P1 once it is a network call, fixed).

## Security

| Item | Status |
|---|---|
| Secrets in front end | OK: only `VITE_FOOD_ASSISTANT_URL` (a public URL, now removed). No key is read in `src/`. |
| `dangerouslySetInnerHTML` / innerHTML | OK: none. All user text renders as React text. |
| `POST /api/ai/key` on a public URL | PROBLEM P0: anyone could set the first key. Disabled in production. |
