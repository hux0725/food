import { describe, expect, it } from 'vitest'
import {
  daysInMonth,
  formatLongDate,
  formatShortDate,
  formatTime,
  isValidDateString,
  isValidTimeString,
  mealMomentFor,
  monthGrid,
  seattleDateTime,
  seattleHour,
  seattleToday,
  shiftMonth,
  toDateString,
  weekdayOf,
} from '../../shared/dates'

describe('date strings', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValidDateString('2026-11-24')).toBe(true)
    expect(isValidDateString('2028-02-29')).toBe(true)
    expect(isValidDateString('2027-02-29')).toBe(false)
    expect(isValidDateString('2100-02-29')).toBe(false)
    expect(isValidDateString('2000-02-29')).toBe(true)
    expect(isValidDateString('2026-04-31')).toBe(false)
    expect(isValidDateString('2026-13-01')).toBe(false)
    expect(isValidDateString('2026-1-01')).toBe(false)
    expect(isValidDateString('')).toBe(false)
    expect(isValidDateString('2026-11-24T00:00')).toBe(false)
    expect(isValidDateString(20261124)).toBe(false)
  })

  it('validates HH:MM 24-hour times', () => {
    for (const ok of ['00:00', '09:05', '12:30', '23:59']) expect(isValidTimeString(ok)).toBe(true)
    for (const bad of ['24:00', '9:05', '12:60', '12:30:00', '', 'noon']) expect(isValidTimeString(bad)).toBe(false)
  })

  it('knows month lengths, including leap years', () => {
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2026, 12)).toBe(31)
    expect(daysInMonth(2026, 11)).toBe(30)
  })

  it('computes weekdays without any timezone, matching UTC for every day 2024-2030', () => {
    for (let year = 2024; year <= 2030; year++) {
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= daysInMonth(year, month); day++) {
          expect(weekdayOf(year, month, day)).toBe(new Date(Date.UTC(year, month - 1, day)).getUTCDay())
        }
      }
    }
  })

  it('builds month grids that start on the right weekday for every possible start day', () => {
    const startDays = new Set<number>()
    for (let month = 1; month <= 12; month++) {
      const grid = monthGrid(2026, month)
      const blanks = grid.findIndex((cell) => cell !== null)
      expect(blanks).toBe(new Date(Date.UTC(2026, month - 1, 1)).getUTCDay())
      expect(grid.filter((cell) => cell !== null)).toHaveLength(daysInMonth(2026, month))
      expect(grid[grid.length - 1]).toBe(daysInMonth(2026, month))
      startDays.add(blanks)
    }
    expect(startDays.size).toBe(7)
    expect(monthGrid(2028, 2).filter(Boolean)).toHaveLength(29)
  })

  it('moves across month and year boundaries', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth(2026, 11, -23)).toEqual({ year: 2024, month: 12 })
    expect(toDateString(2028, 2, 29)).toBe('2028-02-29')
  })

  it('formats without shifting the day', () => {
    expect(formatLongDate('2026-11-24')).toBe('Tuesday, November 24, 2026')
    expect(formatLongDate('2028-02-29')).toBe('Tuesday, February 29, 2028')
    expect(formatLongDate('2026-03-08')).toBe('Sunday, March 8, 2026')
    expect(formatLongDate('2026-11-01')).toBe('Sunday, November 1, 2026')
    expect(formatLongDate('')).toBe('No date selected')
    expect(formatShortDate('2026-12-31')).toBe('Dec 31')
    expect(formatTime('00:05')).toBe('12:05 AM')
    expect(formatTime('12:00')).toBe('12:00 PM')
    expect(formatTime('19:30')).toBe('7:30 PM')
  })
})

describe('Seattle clock', () => {
  it('uses Seattle date, not UTC, late in the evening', () => {
    // 2026-11-25 06:30 UTC is 22:30 on Nov 24 in Seattle (PST, UTC-8).
    const instant = new Date('2026-11-25T06:30:00Z')
    expect(seattleToday(instant)).toBe('2026-11-24')
    expect(seattleHour(instant)).toBe(22)
    expect(seattleDateTime(instant)).toBe('2026-11-24T22:30')
  })

  it('handles the spring-forward day (2026-03-08)', () => {
    expect(seattleDateTime(new Date('2026-03-08T09:59:00Z'))).toBe('2026-03-08T01:59') // PST
    expect(seattleDateTime(new Date('2026-03-08T10:00:00Z'))).toBe('2026-03-08T03:00') // PDT, 2 AM skipped
    expect(seattleHour(new Date('2026-03-08T19:00:00Z'))).toBe(12)
  })

  it('handles the fall-back day (2026-11-01)', () => {
    expect(seattleDateTime(new Date('2026-11-01T08:30:00Z'))).toBe('2026-11-01T01:30') // PDT
    expect(seattleDateTime(new Date('2026-11-01T09:30:00Z'))).toBe('2026-11-01T01:30') // PST, 1 AM repeats
    expect(seattleToday(new Date('2026-11-02T07:59:00Z'))).toBe('2026-11-01')
    expect(seattleToday(new Date('2026-11-02T08:00:00Z'))).toBe('2026-11-02')
  })

  it('picks the meal moment at every hour boundary', () => {
    const expected = [...Array(11).fill('breakfast'), ...Array(5).fill('lunch'), ...Array(8).fill('dinner')]
    for (let hour = 0; hour < 24; hour++) expect(mealMomentFor(hour)).toBe(expected[hour])
    expect(mealMomentFor(10)).toBe('breakfast')
    expect(mealMomentFor(11)).toBe('lunch')
    expect(mealMomentFor(15)).toBe('lunch')
    expect(mealMomentFor(16)).toBe('dinner')
  })

  it('gives the Seattle meal moment from a UTC instant (dinner at 6 PM PST is 02:00 UTC)', () => {
    expect(mealMomentFor(seattleHour(new Date('2026-11-25T02:00:00Z')))).toBe('dinner')
    expect(mealMomentFor(seattleHour(new Date('2026-11-24T16:00:00Z')))).toBe('breakfast')
    expect(mealMomentFor(seattleHour(new Date('2026-07-01T19:00:00Z')))).toBe('lunch')
  })
})
