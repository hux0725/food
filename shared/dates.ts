import type { MealMoment } from './types'

/**
 * Date helpers that work on plain strings. A plan date is a Seattle calendar day ("YYYY-MM-DD")
 * and must never pass through a timezone-aware Date, or it can shift by a day.
 */

export const SEATTLE_TZ = 'America/Los_Angeles'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** month is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_RE.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

export function isValidTimeString(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value)
}

/** Day of week (0 = Sunday) for a calendar date, computed without any timezone (Sakamoto's method). */
export function weekdayOf(year: number, month: number, day: number): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  const y = month < 3 ? year - 1 : year
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + offsets[month - 1] + day) % 7
}

export function toDateString(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseDateString(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

/** Month grid cells: leading nulls for the days before the 1st, then 1..N. */
export function monthGrid(year: number, month: number): Array<number | null> {
  const blanks = weekdayOf(year, month, 1)
  return [...Array<null>(blanks).fill(null), ...Array.from({ length: daysInMonth(year, month) }, (_, index) => index + 1)]
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

function seattleParts(now: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SEATTLE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

/** Seattle's calendar date right now, whatever the device timezone is. */
export function seattleToday(now: Date = new Date()): string {
  const p = seattleParts(now)
  return `${p.year}-${p.month}-${p.day}`
}

/** Seattle hour (0-23) right now. */
export function seattleHour(now: Date = new Date()): number {
  return Number(seattleParts(now).hour) % 24
}

/** "YYYY-MM-DDTHH:MM" Seattle wall-clock time. */
export function seattleDateTime(now: Date = new Date()): string {
  const p = seattleParts(now)
  return `${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`
}

/** Breakfast before 11:00, lunch before 16:00, dinner otherwise. */
export function mealMomentFor(hour: number): MealMoment {
  if (hour < 11) return 'breakfast'
  if (hour < 16) return 'lunch'
  return 'dinner'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Tuesday, November 24, 2026" from "2026-11-24", with no Date object involved. */
export function formatLongDate(value: string): string {
  if (!isValidDateString(value)) return 'No date selected'
  const { year, month, day } = parseDateString(value)
  return `${WEEKDAYS[weekdayOf(year, month, day)]}, ${MONTHS[month - 1]} ${day}, ${year}`
}

/** "Nov 24" from "2026-11-24". */
export function formatShortDate(value: string): string {
  if (!isValidDateString(value)) return 'Pick a date'
  const { month, day } = parseDateString(value)
  return `${MONTHS[month - 1].slice(0, 3)} ${day}`
}

export function formatMonthTitle(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

/** "7:30 PM" from "19:30". */
export function formatTime(value: string): string {
  if (!isValidTimeString(value)) return ''
  const [hour, minute] = value.split(':').map(Number)
  const suffix = hour < 12 ? 'AM' : 'PM'
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${suffix}`
}
