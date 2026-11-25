# Demo script

Every query below was run in the eval (`npm run test:eval`) and in the browser tests (`e2e/demo-path.spec.ts`), in this order. Each returns three picks except the last, which shows the honest "nothing fits" answer.

## 10 minutes before

1. `npm run preflight -- <deployed URL>`: must not be RED. This also wakes a sleeping host.
2. Clean data: `npm run reset-demo` on the host (or locally), then run preflight again: "Demo data … clean slate".
3. Open the URL in Chrome, full screen, zoom 100%. Close other tabs. Turn off notifications.
4. Have `BACKUP_PLAN.md` open on your laptop, and a local copy running (`npm start` → http://localhost:3001) as the fallback.

## 2-minute version

| Time | Do | Say |
| --- | --- | --- |
| 0:00 | Show the Discover list. | "Seattle Food Discovery: 68 real Seattle restaurants, filtered by budget, neighborhood, and how long it takes to get there." |
| 0:10 | Tap **Ask the food assistant**. Type **`pasta under $30`**, press Enter. | "I just say what I want." Point at the three picks: "Every pick is under $30. That limit is enforced in code before the AI sees anything, so it can't suggest something out of budget." |
| 0:30 | Type **`cheap ramen near Capitol Hill`**. | "It understands neighborhoods too, and the list below follows." |
| 0:45 | Tap the **30 minutes** chip (sends **`I have 30 minutes`**). | "Thirty minutes door to table: travel plus the typical wait." |
| 1:00 | Tap the first pick's name → details → **Add to calendar**. The time is already suggested. Tap **Save Dining Plan**. | "Plans are saved to a real backend." Point at the line: "No table reservation was made. We're honest about that." |
| 1:15 | Tap **Continue to my calendar**. | "Here's the plan on the calendar." |
| 1:25 | Back to **Discover**, tap the heart on a card, then open **Saved**. | "Favorites, also saved on the server." |
| 1:35 | Reload the page, open **Plans**. | "Reload: still there. It's not just in the browser." |
| 1:45 | Back to **Discover**, open the assistant, type **`sushi under $5 in Ballard`**. | "And when nothing fits, it says so and tells you which filter to relax, instead of making something up." |
| 1:55 | Stop. | "That's Seattle Food Discovery." |

Spare queries if there's time or one answer looks odd (all return three picks):
- **`date night under $60 in Ballard`**
- **`dumplings in the International District`**
- **`Surprise me`**

## 30-second version

1. Tap **Ask the food assistant**, type **`pasta under $30`**, press Enter. "Three picks, all under $30."
2. Tap the calendar icon on the first pick → **Save Dining Plan** → **Continue to my calendar**. "Saved to the backend. No reservation is made."
3. Done.

## Don'ts on stage

- Don't add `?debug=1` to the URL: it shows source tags.
- Don't click "Sort by my current location" or the mic unless you've tested that room. Both ask for permission, and a denial only shows a friendly note.
- Don't promise reservations, live traffic, real ratings, or real photos. See TALKING_POINTS.md.
