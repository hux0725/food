import { serverPath } from '../src/app.js'
import { Db } from '../src/db/index.js'
import { EXPECTED_PLACE_COUNT, seedPlaces } from '../src/db/seed.js'
import { loadEnv } from '../src/env.js'

/** Inserts or updates every place from src/data/places.ts. Safe to run any number of times. */
const env = loadEnv()
const db = new Db(serverPath(env.DB_PATH))
const count = seedPlaces(db)
const counts = db.counts()
db.close()
console.log(`Seeded ${serverPath(env.DB_PATH)}: places=${counts.places} (expected ${EXPECTED_PLACE_COUNT}), plans=${counts.plans}, favorites=${counts.favorites}`)
if (count !== EXPECTED_PLACE_COUNT) process.exit(1)
