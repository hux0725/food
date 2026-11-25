# Talking points

## One line

Seattle Food Discovery helps you pick where to eat in Seattle by budget, neighborhood, and how much time you have, and saves the plan.

## What is real

- **A real backend.** One Node service (Fastify + SQLite) serves the app and an API. Plans and favorites are stored on the server and survive reloads and restarts.
- **Hard limits are enforced in code.** Budget, neighborhood, cuisine, and time limits filter the restaurant list *before* the AI sees it. The AI only ranks what already fits.
- **The AI is checked.** It must answer in a strict format and may only pick restaurants from the list it was given. Made-up places are dropped. A reason that gets a price or time wrong is replaced with a factual one.
- **It never shows an error.** If the model is slow (6 s limit), down, or returns junk, the answer comes from a cache or a local rules-based matcher. Same look, same speed.
- **Tested.** Unit, API, browser (Chrome, Safari, mobile), accessibility, timezone, and failure-injection tests, plus a 50-query assistant eval. Numbers are in FINAL_REPORT.md.

## What is sample data (say it if asked, never claim otherwise)

- **Ratings and wait times** are sample data, not live reviews or queues.
- **Travel times** are estimates from Pike Place Market by walking, biking, or driving. There's no live traffic.
- **Photos** are cuisine stand-ins, not photos of the actual restaurants.
- **Plans don't reserve a table.** They're a personal calendar.
- **One demo user, no sign-in.** Accounts are out of scope for this version.
- **Opening hours and dietary info are not in the data.** The assistant says so instead of guessing.

## Likely questions

- **"What if the AI makes something up?"** It can only choose from a list we filtered in code. Anything else is thrown away, and numbers in its explanations are checked against the data.
- **"What if the AI service goes down during the demo?"** You wouldn't notice. It falls back to a cache and a local matcher within 6 seconds.
- **"Can someone trick it with a prompt?"** User text is treated as data, not instructions. Off-topic or "ignore your rules" messages get a polite redirect. This is covered by tests.
- **"Where does the data come from?"** 68 Seattle restaurants collected from public listings. Addresses are geocoded with OpenStreetMap. Ratings and waits are samples.
- **"Is the API key safe?"** It lives only on the server, in an environment variable. It is never sent to the browser, never logged, and never committed. A build check scans the shipped files for keys.
- **"What's next?"** Real accounts, real availability, and live travel times. See "Refactor ideas" in FINAL_REPORT.md.
