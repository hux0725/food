import { useEffect, useState } from 'react'
import { mealMomentFor, seattleDateTime, seattleHour, seattleToday } from '../shared/dates'
import type { MealMoment } from '../shared/types'

type SeattleClock = { today: string; hour: number; moment: MealMoment; dateTime: string }

function readClock(): SeattleClock {
  const now = new Date()
  const hour = seattleHour(now)
  return { today: seattleToday(now), hour, moment: mealMomentFor(hour), dateTime: seattleDateTime(now) }
}

/** Seattle date, hour and meal moment, whatever the device timezone. Re-checked every minute. */
export function useSeattleClock(): SeattleClock {
  const [clock, setClock] = useState(readClock)
  useEffect(() => {
    const id = window.setInterval(() => {
      setClock((current) => {
        const next = readClock()
        return next.dateTime === current.dateTime ? current : next
      })
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])
  return clock
}

export type Weather = { label: string; live: boolean }

/** Shown when the forecast service cannot be reached. Labeled as a sample in the UI. */
export const FALLBACK_WEATHER: Weather = { label: 'Overcast · 52°F', live: false }

const WMO: Array<[number[], string]> = [
  [[0], 'Clear'],
  [[1, 2], 'Partly cloudy'],
  [[3], 'Overcast'],
  [[45, 48], 'Fog'],
  [[51, 53, 55, 56, 57], 'Drizzle'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain'],
  [[71, 73, 75, 77, 85, 86], 'Snow'],
  [[95, 96, 99], 'Thunderstorms'],
]

export function describeWeather(code: number, temperatureF: number): string {
  const label = WMO.find(([codes]) => codes.includes(code))?.[1] ?? 'Weather'
  return `${label} · ${Math.round(temperatureF)}°F`
}

const OPEN_METEO =
  'https://api.open-meteo.com/v1/forecast?latitude=47.6097&longitude=-122.3422&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles'

/** Current Seattle weather from Open-Meteo (no key). 3-second timeout, then the labeled fallback. */
export function useSeattleWeather(): Weather {
  const [weather, setWeather] = useState<Weather>(FALLBACK_WEATHER)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 3000)
    fetch(OPEN_METEO, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { current?: { temperature_2m?: unknown; weather_code?: unknown } }) => {
        const temperature = body.current?.temperature_2m
        const code = body.current?.weather_code
        if (typeof temperature === 'number' && typeof code === 'number' && Number.isFinite(temperature)) {
          setWeather({ label: describeWeather(code, temperature), live: true })
        }
      })
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timer))
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [])
  return weather
}
