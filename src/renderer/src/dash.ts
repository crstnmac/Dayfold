import type { Command, InputResult, Project } from '../../shared/types'

export const api = window.dash

export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 1) return '<1m'
  const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : `${m}m`
}

export function daysUntil(iso: string, today: string): number {
  const [a, b, c] = iso.split('-').map(Number)
  const [x, y, z] = today.split('-').map(Number)
  return Math.round((new Date(a, b - 1, c).getTime() - new Date(x, y - 1, z).getTime()) / 86400000)
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad'

export function deadlineChip(p: Project, today: string): { text: string; tone: Tone } | null {
  if (!p.due) return null
  if (p.status === 'done') return { text: `was due ${p.due}`, tone: 'neutral' }
  const d = daysUntil(p.due, today)
  if (d < 0) return { text: `${-d}d overdue`, tone: 'bad' }
  if (d === 0) return { text: 'due today', tone: 'bad' }
  if (d <= 3) return { text: `${d}d left`, tone: 'warn' }
  return { text: `${d}d left`, tone: 'neutral' }
}

/** Tailwind classes for a status tone, using semantic tokens only. */
export const toneClass: Record<Tone, string> = {
  neutral: '',
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-destructive'
}

export type Run = (c: Command) => Promise<InputResult>

/** A task carried this many times is "stale" and prompts: break down, defer or drop (FR-12). */
export const STALE_AFTER = 3
export const isStale = (t: { carry_count: number }): boolean => t.carry_count >= STALE_AFTER

/** Local-date arithmetic for ISO days (mirrors main/dates.addDays; the renderer can't import main). */
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(y, m - 1, d + n)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/** "com.google.Chrome" becomes "Chrome": a readable stand-in for an app that is not installed. */
export function prettyBundleId(id: string): string {
  const parts = id.split('.').filter((p) => p && !/^(app|desktop|mac|macos|osx|electron)$/i.test(p))
  const last = parts[parts.length - 1] ?? id
  return last.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export const fmtClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export const sessionTotal = (sessions: { activeSeconds: number }[]): string =>
  `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} · ${fmtDuration(
    sessions.reduce((a, s) => a + s.activeSeconds, 0)
  )}`
