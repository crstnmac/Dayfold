// Pure: turns the day's activity rows into work sessions with a readable headline and a
// suggested to-do. No Electron or DB access, so it is tested with plain rows.
import type { ActivitySession } from '../shared/types'
import { clipRows, type Clipped, type DayRow } from './activity-core'

/** A pause longer than this ends a session even when the category is unchanged. */
/** A stored summary of what was visible in the front window at `ts`. */
export interface ContextRow {
  ts: number
  text: string
}
const MAX_CONTEXT_LINES = 4

/**
 * The lines that kept showing up during a session (a document title, a thread subject) rank
 * above one-off lines, so the result is what the session was about rather than what flashed by.
 */
export function contextLines(rows: ContextRow[], from: number, to: number): string[] {
  const count = new Map<string, { n: number; last: number }>()
  for (const r of rows) {
    if (r.ts < from || r.ts > to) continue
    for (const line of new Set(r.text.split('\n'))) {
      const e = count.get(line) ?? { n: 0, last: 0 }
      e.n++
      e.last = Math.max(e.last, r.ts)
      count.set(line, e)
    }
  }
  return [...count]
    .sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)
    .slice(0, MAX_CONTEXT_LINES)
    .map(([line]) => line)
}

export const SESSION_GAP_MS = 5 * 60_000
/** A detour into another category shorter than this is folded into the surrounding session. */
export const ABSORB_MS = 2 * 60_000
/** Sessions with less time in their category are noise and are not listed. */
export const MIN_SESSION_MS = 5 * 60_000
const MAX_SESSIONS = 40
const TITLE_MAX = 120

interface Run {
  category: string
  start: number
  end: number
  pieces: Clipped[]
  interruptions: number
}

function groupRuns(pieces: Clipped[]): Run[] {
  const runs: Run[] = []
  for (const p of pieces) {
    if (p.row.idle) continue
    const last = runs[runs.length - 1]
    if (last && last.category === p.row.category && p.s - last.end <= SESSION_GAP_MS) {
      last.pieces.push(p)
      last.end = p.e
    } else {
      runs.push({
        category: p.row.category,
        start: p.s,
        end: p.e,
        pieces: [p],
        interruptions: 0
      })
    }
  }
  return runs
}

/** Merge runs split by a brief detour: A (2 min of B) A becomes one A session. */
function absorbDetours(runs: Run[]): Run[] {
  const out: Run[] = []
  for (let i = 0; i < runs.length; i++) {
    const cur = runs[i]
    const prev = out[out.length - 1]
    const next = runs[i + 1]
    if (prev && prev.category === cur.category && cur.start - prev.end <= SESSION_GAP_MS) {
      prev.pieces.push(...cur.pieces)
      prev.end = cur.end
      prev.interruptions += cur.interruptions
    } else if (
      prev &&
      next &&
      cur.end - cur.start < ABSORB_MS &&
      next.category === prev.category &&
      cur.start - prev.end <= SESSION_GAP_MS &&
      next.start - cur.end <= SESSION_GAP_MS
    ) {
      prev.interruptions++
      prev.end = cur.end
    } else out.push(cur)
  }
  return out
}

const sum = (ps: Clipped[]): number => ps.reduce((a, p) => a + (p.e - p.s), 0)

function topBy<K>(m: Map<K, number>, n: number): [K, number][] {
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n)
}

const list = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

const clip = (t: string, max = TITLE_MAX): string =>
  t.length > max ? `${t.slice(0, max - 1)}…` : t

/** "Coding in VS Code and Terminal": what the time was, in plain words. */
export function headlineFor(category: string, kind: string, names: string[]): string {
  const where = list(names.slice(0, 2)) || 'an app'
  switch (category) {
    case 'dev':
      return `Coding in ${where}`
    case 'email':
      return kind === 'composing' ? `Writing email in ${where}` : `Email in ${where}`
    case 'messaging':
      return `Messaging in ${where}`
    case 'docs':
      return `Working on documents in ${where}`
    case 'meeting':
      return `In a meeting on ${where}`
    case 'work':
      return `Working in ${where}`
    case 'ai':
      return `Working with AI in ${where}`
    case 'media':
      return `Media in ${where}`
    case 'social':
      return `Social media in ${where}`
    case 'browsing':
      return `Browsing in ${where}`
    default:
      return `Using ${where}`
  }
}

/** A to-do worth adding after this session. Uses the document or thread name when known. */
export function suggestTask(category: string, services: string[], details: string[]): string {
  const svc = services[0] || 'this app'
  const d = details[0]
  let t: string
  switch (category) {
    case 'email':
      t = d ? `Reply to "${d}"` : `Follow up on emails in ${svc}`
      break
    case 'messaging':
      t = d ? `Follow up in ${d}` : `Follow up on ${svc} messages`
      break
    case 'docs':
      t = d ? `Finish ${d}` : `Continue the document in ${svc}`
      break
    case 'dev':
      t = d ? `Continue ${d}` : `Continue coding in ${svc}`
      break
    case 'meeting':
      t = d ? `Send follow-ups from ${d}` : `Send follow-ups from the ${svc} meeting`
      break
    case 'ai':
      t = d ? `Apply the outcome of ${d}` : `Apply what came out of the ${svc} session`
      break
    case 'media':
    case 'social':
    case 'browsing':
      t = d ? `Revisit ${d}` : `Revisit what I was reading in ${svc}`
      break
    default:
      t = d ? `Continue ${d}` : `Continue work in ${svc}`
  }
  return clip(t)
}

/**
 * Work sessions for one day, chronological. A session is a stretch in one category: gaps up to
 * 5 minutes and detours under 2 minutes do not break it, and anything under 5 minutes of real
 * time in the category is dropped. Details are only present when the rows carry them.
 */
export function buildSessions(
  rows: DayRow[],
  start: number,
  end: number,
  now: number,
  openId: number | null,
  contexts: ContextRow[] = []
): Omit<ActivitySession, 'taskId' | 'taskStatus'>[] {
  const runs = absorbDetours(groupRuns(clipRows(rows, start, end, now, openId)))
  const out: Omit<ActivitySession, 'taskId' | 'taskStatus'>[] = []
  for (const r of runs) {
    const ms = sum(r.pieces)
    if (ms < MIN_SESSION_MS) continue
    const apps = new Map<string, { bundleId: string; name: string; ms: number }>()
    const svcs = new Map<string, number>()
    const dets = new Map<string, number>()
    const kinds = new Map<string, number>()
    for (const p of r.pieces) {
      const d = p.e - p.s
      const key = p.row.bundle_id || `name:${p.row.app || p.row.service}`
      const a = apps.get(key) ?? {
        bundleId: p.row.bundle_id,
        name: p.row.app || p.row.service,
        ms: 0
      }
      a.ms += d
      apps.set(key, a)
      if (p.row.service) svcs.set(p.row.service, (svcs.get(p.row.service) ?? 0) + d)
      if (p.row.detail) dets.set(p.row.detail, (dets.get(p.row.detail) ?? 0) + d)
      if (p.row.kind) kinds.set(p.row.kind, (kinds.get(p.row.kind) ?? 0) + d)
    }
    const services = topBy(svcs, 4).map(([n]) => n)
    const details = topBy(dets, 3).map(([n]) => n)
    const kind = topBy(kinds, 1)[0]?.[0] ?? ''
    out.push({
      id: String(r.start),
      start: r.start,
      end: r.end,
      activeSeconds: ms / 1000,
      category: r.category,
      headline: headlineFor(r.category, kind, services),
      apps: [...apps.values()]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 4)
        .map((a) => ({ bundleId: a.bundleId, name: a.name, seconds: a.ms / 1000 })),
      services,
      details,
      interruptions: r.interruptions,
      context: contextLines(contexts, r.start, r.end),
      suggestion: { title: suggestTask(r.category, services, details) }
    })
  }
  return out.slice(-MAX_SESSIONS)
}
