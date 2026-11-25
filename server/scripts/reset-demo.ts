import { serverPath } from '../src/app.js'
import { Db } from '../src/db/index.js'
import { EXPECTED_PLACE_COUNT, seedPlaces } from '../src/db/seed.js'
import { loadEnv } from '../src/env.js'

/**
 * Clears every plan and favorite and re-seeds places, so the demo starts from a known state.
 * Safe while the server is running (SQLite handles the locking); the app shows the empty state on next load.
 * The assistant cache is kept on purpose: it holds the warmed demo answers.
 */
const env = loadEnv()
const db = new Db(serverPath(env.DB_PATH))
const removed = db.resetUserData()
seedPlaces(db)
const counts = db.counts()
db.close()
console.log(`Reset ${serverPath(env.DB_PATH)}: removed ${removed.plans} plans and ${removed.favorites} favorites.`)
console.log(`Now: places=${counts.places} (expected ${EXPECTED_PLACE_COUNT}), plans=${counts.plans}, favorites=${counts.favorites}`)
if (counts.places !== EXPECTED_PLACE_COUNT || counts.plans !== 0 || counts.favorites !== 0) process.exit(1)
