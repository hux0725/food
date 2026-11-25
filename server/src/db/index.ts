import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Favorite, Plan, PlaceRecord } from '../../../shared/types.js'

/**
 * SQLite through Node's built-in `node:sqlite` (no native build step on the deploy host).
 * All calls are synchronous, so concurrent requests are serialized by the event loop and cannot interleave mid-write.
 */

const MIGRATIONS: string[] = [
  `CREATE TABLE places (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     cuisine TEXT NOT NULL,
     price TEXT NOT NULL CHECK (price IN ('$', '$$', '$$$', '$$$$')),
     serving INTEGER NOT NULL CHECK (serving > 0),
     neighborhood TEXT NOT NULL,
     address TEXT NOT NULL,
     street TEXT NOT NULL,
     miles REAL NOT NULL CHECK (miles > 0),
     lat REAL NOT NULL,
     lon REAL NOT NULL,
     wait_minutes INTEGER NOT NULL CHECK (wait_minutes >= 0),
     rating REAL,
     image TEXT NOT NULL,
     note TEXT NOT NULL,
     dishes TEXT NOT NULL
   );
   CREATE INDEX places_neighborhood ON places (neighborhood);
   CREATE INDEX places_cuisine ON places (cuisine);

   CREATE TABLE plans (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     place_id TEXT NOT NULL REFERENCES places (id),
     date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     arrival_time TEXT NOT NULL CHECK (arrival_time GLOB '[0-2][0-9]:[0-5][0-9]'),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (user_id, place_id, date)
   );
   CREATE INDEX plans_user_date ON plans (user_id, date);

   CREATE TABLE favorites (
     user_id TEXT NOT NULL,
     place_id TEXT NOT NULL REFERENCES places (id),
     created_at TEXT NOT NULL,
     PRIMARY KEY (user_id, place_id)
   );`,
]

type Row = Record<string, unknown>

function toPlace(row: Row): PlaceRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    cuisine: String(row.cuisine),
    price: row.price as PlaceRecord['price'],
    serving: Number(row.serving),
    neighborhood: String(row.neighborhood),
    address: String(row.address),
    street: String(row.street),
    miles: Number(row.miles),
    lat: Number(row.lat),
    lon: Number(row.lon),
    wait: Number(row.wait_minutes),
    rating: row.rating == null ? null : Number(row.rating),
    image: String(row.image),
    note: String(row.note),
    dishes: JSON.parse(String(row.dishes)) as string[],
  }
}

function toPlan(row: Row): Plan {
  return {
    id: String(row.id),
    placeId: String(row.place_id),
    date: String(row.date),
    time: String(row.arrival_time),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export type PlaceFilters = { q?: string; neighborhood?: string; cuisine?: string; maxPrice?: number }

export class UniqueViolation extends Error {}
export class ForeignKeyViolation extends Error {}

function rethrowConstraint(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (/UNIQUE constraint failed/.test(message)) throw new UniqueViolation(message)
  if (/FOREIGN KEY constraint failed/.test(message)) throw new ForeignKeyViolation(message)
  throw error
}

export class Db {
  readonly #db: DatabaseSync
  #closed = false

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.#db = new DatabaseSync(path)
    this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')
    if (path !== ':memory:') this.#db.exec('PRAGMA journal_mode = WAL;')
    this.#migrate()
  }

  #migrate() {
    const { user_version: version } = this.#db.prepare('PRAGMA user_version').get() as { user_version: number }
    for (let index = version; index < MIGRATIONS.length; index++) {
      this.#transaction(() => {
        this.#db.exec(MIGRATIONS[index])
        this.#db.exec(`PRAGMA user_version = ${index + 1}`)
      })
    }
  }

  #transaction<T>(work: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.#db.exec('COMMIT')
      return result
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  /** Safe to call more than once (shutdown signal plus server close). */
  close() {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }

  ping(): boolean {
    try {
      return (this.#db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1
    } catch {
      return false
    }
  }

  /** Inserts new places and updates changed ones by id. Never deletes, so plans keep their foreign keys. Safe to run on every boot. */
  upsertPlaces(places: PlaceRecord[]): number {
    const statement = this.#db.prepare(
      `INSERT INTO places (id, name, cuisine, price, serving, neighborhood, address, street, miles, lat, lon, wait_minutes, rating, image, note, dishes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, cuisine = excluded.cuisine, price = excluded.price, serving = excluded.serving,
         neighborhood = excluded.neighborhood, address = excluded.address, street = excluded.street, miles = excluded.miles,
         lat = excluded.lat, lon = excluded.lon, wait_minutes = excluded.wait_minutes, rating = excluded.rating,
         image = excluded.image, note = excluded.note, dishes = excluded.dishes`,
    )
    this.#transaction(() => {
      for (const p of places) {
        statement.run(p.id, p.name, p.cuisine, p.price, p.serving, p.neighborhood, p.address, p.street, p.miles, p.lat, p.lon, p.wait, p.rating, p.image, p.note, JSON.stringify(p.dishes))
      }
    })
    return this.countPlaces()
  }

  countPlaces(): number {
    return Number((this.#db.prepare('SELECT COUNT(*) AS n FROM places').get() as { n: number }).n)
  }

  listPlaces(filters: PlaceFilters = {}): PlaceRecord[] {
    const where: string[] = []
    const params: Array<string | number> = []
    if (filters.neighborhood) {
      where.push('neighborhood = ? COLLATE NOCASE')
      params.push(filters.neighborhood)
    }
    if (filters.cuisine) {
      where.push('cuisine = ? COLLATE NOCASE')
      params.push(filters.cuisine)
    }
    if (filters.maxPrice != null) {
      where.push('serving <= ?')
      params.push(filters.maxPrice)
    }
    if (filters.q) {
      where.push(`(name || ' ' || cuisine || ' ' || neighborhood || ' ' || address || ' ' || note || ' ' || dishes) LIKE ? ESCAPE '\\' COLLATE NOCASE`)
      params.push(`%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
    }
    const sql = `SELECT * FROM places ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY rowid`
    return (this.#db.prepare(sql).all(...params) as Row[]).map(toPlace)
  }

  getPlace(id: string): PlaceRecord | null {
    const row = this.#db.prepare('SELECT * FROM places WHERE id = ?').get(id) as Row | undefined
    return row ? toPlace(row) : null
  }

  listPlans(userId: string): Plan[] {
    return (this.#db.prepare('SELECT * FROM plans WHERE user_id = ? ORDER BY date, arrival_time, created_at').all(userId) as Row[]).map(toPlan)
  }

  getPlan(userId: string, id: string): Plan | null {
    const row = this.#db.prepare('SELECT * FROM plans WHERE user_id = ? AND id = ?').get(userId, id) as Row | undefined
    return row ? toPlan(row) : null
  }

  createPlan(userId: string, input: { placeId: string; date: string; time: string }): Plan {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    try {
      this.#db
        .prepare('INSERT INTO plans (id, user_id, place_id, date, arrival_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, userId, input.placeId, input.date, input.time, now, now)
    } catch (error) {
      rethrowConstraint(error)
    }
    return this.getPlan(userId, id)!
  }

  updatePlan(userId: string, id: string, changes: { date?: string; time?: string }): Plan | null {
    const current = this.getPlan(userId, id)
    if (!current) return null
    try {
      this.#db
        .prepare('UPDATE plans SET date = ?, arrival_time = ?, updated_at = ? WHERE user_id = ? AND id = ?')
        .run(changes.date ?? current.date, changes.time ?? current.time, new Date().toISOString(), userId, id)
    } catch (error) {
      rethrowConstraint(error)
    }
    return this.getPlan(userId, id)
  }

  deletePlan(userId: string, id: string): boolean {
    return Number(this.#db.prepare('DELETE FROM plans WHERE user_id = ? AND id = ?').run(userId, id).changes) > 0
  }

  listFavorites(userId: string): Favorite[] {
    return (this.#db.prepare('SELECT place_id, created_at FROM favorites WHERE user_id = ? ORDER BY created_at, place_id').all(userId) as Row[]).map(
      (row) => ({ placeId: String(row.place_id), createdAt: String(row.created_at) }),
    )
  }

  /** Idempotent: adding twice keeps one row. */
  addFavorite(userId: string, placeId: string): Favorite {
    try {
      this.#db.prepare('INSERT OR IGNORE INTO favorites (user_id, place_id, created_at) VALUES (?, ?, ?)').run(userId, placeId, new Date().toISOString())
    } catch (error) {
      rethrowConstraint(error)
    }
    const row = this.#db.prepare('SELECT place_id, created_at FROM favorites WHERE user_id = ? AND place_id = ?').get(userId, placeId) as Row
    return { placeId: String(row.place_id), createdAt: String(row.created_at) }
  }

  /** Idempotent: removing something that is not there is fine. */
  removeFavorite(userId: string, placeId: string): void {
    this.#db.prepare('DELETE FROM favorites WHERE user_id = ? AND place_id = ?').run(userId, placeId)
  }

  /** Clears every plan and favorite (all users). Used by `npm run reset-demo`. */
  resetUserData(): { plans: number; favorites: number } {
    return this.#transaction(() => ({
      plans: Number(this.#db.prepare('DELETE FROM plans').run().changes),
      favorites: Number(this.#db.prepare('DELETE FROM favorites').run().changes),
    }))
  }

  counts(): { places: number; plans: number; favorites: number } {
    const count = (table: string) => Number((this.#db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n)
    return { places: count('places'), plans: count('plans'), favorites: count('favorites') }
  }
}
