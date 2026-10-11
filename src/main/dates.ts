import * as chrono from 'chrono-node'
import type { ISODate } from '../shared/types'

export function toISO(d: Date): ISODate {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function today(now = new Date()): ISODate {
  return toISO(now)
}

export function addDays(iso: ISODate, n: number): ISODate {
  const [y, m, d] = iso.split('-').map(Number)
  return toISO(new Date(y, m - 1, d + n))
}

export function parseDate(text: string, now = new Date()): ISODate | null {
  const t = text.trim().toLowerCase()
  if (t === 'today') return today(now)
  if (t === 'tomorrow') return addDays(today(now), 1)
  const d = chrono.parseDate(t, now, { forwardDate: true })
  return d ? toISO(d) : null
}

export function startOfLocalDayMs(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}
