import type { Level } from './types'

export const LEVEL_NAMES = ['Low', 'Moderate', 'High', 'Severe', 'No Travel'] as const

export const LEVEL_COLORS: Record<Level, string> = {
  0: '#16a34a',
  1: '#eab308',
  2: '#f97316',
  3: '#dc2626',
  4: '#6d28d9',
}

export const ROUTE_COLORS = ['#2563eb', '#0891b2', '#7c3aed']

export function levelColor(level: Level) {
  return LEVEL_COLORS[level]
}

export function fmtHours(h: number) {
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  return mins ? `${whole} h ${mins} min` : `${whole} h`
}

export function fmtMiles(m: number) {
  return `${Math.round(m).toLocaleString()} mi`
}

/** Hourly label for the slider: departure + h hours, shown in the origin's time zone. */
export function fmtForecastTime(departureUtc: string, h: number, timeZone: string) {
  const d = new Date(new Date(departureUtc).getTime() + h * 3600_000)
  return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone })
}
