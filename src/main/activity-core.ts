// Pure activity logic: helper-message validation, interval accounting and day summaries.
// No Electron, DB or process access here so it can be tested with a fake helper stream.
import type {
  ActivityApp,
  ActivitySegment,
  ActivityDayStats,
  ActivityService,
  ISODate
} from '../shared/types'
import { addDays, toISO } from './dates'

export const RETENTION_DAYS = 30
export const DEFAULT_IDLE_SECONDS = 120
export const MIN_IDLE_SECONDS = 30
export const MAX_IDLE_SECONDS = 1800
/** Helper heartbeats every 15 s; a silence longer than this is an untracked gap. */
export const GAP_MS = 60_000
/** Minimum spacing between accepted focus events; faster bursts are coalesced. */
export const MIN_EVENT_SPACING_MS = 250
/** Hard cap on stored rows, enforced at prune time. */
export const MAX_ROWS = 400_000
export const MAX_EXCLUDE = 200

/** Password managers and wallets are never tracked unless the user edits the list. */
export const DEFAULT_EXCLUDE: string[] = [
  'com.1password.1password',
  'com.1password.1password7',
  'com.agilebits.onepassword7',
  'com.agilebits.onepassword-osx',
  'com.bitwarden.desktop',
  'com.apple.keychainaccess',
  'com.apple.passwords',
  'org.keepassxc.keepassxc',
  'com.lastpass.lastpass',
  'com.dashlane.dashlane',
  'me.proton.pass.electron',
  'in.sinew.enpass-desktop'
]

// ---------------------------------------------------------------- helper messages

export type FocusReason = '' | 'idle' | 'sleep' | 'display' | 'session' | 'locked' | 'screensaver'
const REASONS = new Set(['', 'idle', 'sleep', 'display', 'session', 'locked', 'screensaver'])

export interface FocusEvent {
  type: 'focus'
  ts: number
  app: string
  bundleId: string
  title: string
  url: string
  idle: boolean
  secure: boolean
  private: boolean
  excluded: boolean
  reason: FocusReason
}
export interface StatusEvent {
  type: 'status'
  trusted: boolean
}
export interface HeartbeatEvent {
  type: 'heartbeat'
  ts: number
}
/** Visible window text, only sent when the user opted in to snippets. */
export interface ContextEvent {
  type: 'context'
  ts: number
  bundleId: string
  text: string
}
export type HelperEvent = FocusEvent | StatusEvent | HeartbeatEvent | ContextEvent

const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const clip = (v: unknown, max: number): string | null =>
  typeof v === 'string' ? v.replace(/\p{Cc}/gu, ' ').slice(0, max) : null

/** Clamp a helper timestamp into a sane window around `now`. */
function sanitizeTs(v: unknown, now: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const ts = Math.floor(v)
  if (ts > now + 5_000) return now // future: helper clock glitch
  if (ts < now - 10 * 60_000) return now // stale: never rewrite history
  return ts
}

/** Strict validation of one parsed helper line. Unknown shapes return null. */
export function parseHelperMessage(v: unknown, now: number): HelperEvent | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.type === 'status') {
    return typeof o.trusted === 'boolean' ? { type: 'status', trusted: o.trusted } : null
  }
  if (o.type === 'heartbeat') {
    const ts = sanitizeTs(o.ts, now)
    return ts === null ? null : { type: 'heartbeat', ts }
  }
  if (o.type === 'context') {
    const ts = sanitizeTs(o.ts, now)
    const bundleId = clip(o.bundleId, 200)
    if (ts === null || bundleId === null || typeof o.text !== 'string') return null
    // newlines separate lines of text, so they are kept; other control characters are not
    const text = o.text.replace(/\p{Cc}/gu, (c) => (c === '\n' ? c : ' '))
    return { type: 'context', ts, bundleId, text: text.slice(0, 8000) }
  }
  if (o.type !== 'focus') return null
  const ts = sanitizeTs(o.ts, now)
  const app = clip(o.app, 120)
  const bundleId = clip(o.bundleId, 200)
  const title = clip(o.title, 1000)
  const url = o.url === undefined ? '' : clip(o.url, 4096)
  const reason = o.reason === undefined ? '' : o.reason
  if (
    ts === null ||
    app === null ||
    bundleId === null ||
    title === null ||
    url === null ||
    typeof o.idle !== 'boolean' ||
    typeof o.secure !== 'boolean' ||
    typeof reason !== 'string' ||
    !REASONS.has(reason)
  ) {
    return null
  }
  return {
    type: 'focus',
    ts,
    app,
    bundleId: bundleId === '' || BUNDLE_ID.test(bundleId) ? bundleId : '',
    title,
    url,
    idle: o.idle,
    secure: o.secure,
    private: o.private === true,
    excluded: o.excluded === true,
    reason: reason as FocusReason
  }
}

const PRIVATE_MARKERS = [
  'incognito',
  'inprivate',
  'private browsing',
  'private window',
  '(private)',
  'private tab'
]
/** Window titles of private/incognito browser windows (second line of defence after the helper). */
export function isPrivateTitle(title: string): boolean {
  const t = title.toLowerCase()
  return PRIVATE_MARKERS.some((m) => t.includes(m))
}

// ---------------------------------------------------------------- settings validation

export function validateExclude(v: unknown): string[] {
  if (!Array.isArray(v)) throw new Error('exclude list must be an array')
  if (v.length > MAX_EXCLUDE) throw new Error(`at most ${MAX_EXCLUDE} apps can be excluded`)
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') throw new Error('bundle ids must be strings')
    const id = item.trim().toLowerCase()
    if (!BUNDLE_ID.test(id)) throw new Error(`not a valid bundle id: ${item.slice(0, 40)}`)
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

export function parseStoredExclude(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_EXCLUDE]
  try {
    return validateExclude(JSON.parse(raw))
  } catch {
    return [...DEFAULT_EXCLUDE] // corrupt value: fail closed to the safe default
  }
}

export function validateIdleSeconds(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('idle seconds must be a number')
  return Math.min(MAX_IDLE_SECONDS, Math.max(MIN_IDLE_SECONDS, Math.round(v)))
}

/** An IPC date argument: a real ISO date within the retention window, else today. */
export function parseDateArg(v: unknown, now = Date.now()): ISODate {
  const today = toISO(new Date(now))
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return today
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return today
  if (v > today || v < addDays(today, -RETENTION_DAYS)) return today
  return v
}

/** Local-day bounds [start, end) in ms; DST-safe because the end is the next local midnight. */
export function dayBounds(iso: ISODate): { start: number; end: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() }
}

// ---------------------------------------------------------------- interval accounting

export interface RowSpec {
  app: string
  bundleId: string
  service: string
  category: string
  kind: string
  detail: string
  url: string
  idle: boolean
}
export interface IntervalStore {
  /** Insert a row starting at `ts` (ended_ts = ts, never NULL). Returns its id. */
  insert(ts: number, spec: RowSpec): number
  setEnd(id: number, end: number): void
}

const keyOf = (s: RowSpec): string =>
  [s.app, s.bundleId, s.service, s.category, s.kind, s.idle ? 1 : 0, s.detail, s.url].join('\u0001')

interface Open {
  id: number
  key: string
  start: number
  end: number
}

/**
 * Turns a stream of focus states into non-overlapping rows. Guarantees: end >= start, rows never
 * overlap, consecutive identical states merge into one row, a silence longer than GAP_MS ends the
 * open row at the last time the helper was heard from (untracked gap), and event bursts faster
 * than MIN_EVENT_SPACING_MS are coalesced (latest wins).
 */
export class IntervalTracker {
  private cur: Open | null = null
  private lastSeen = 0
  private lastAccepted = -Infinity
  private pending: { spec: RowSpec | null; ts: number } | null = null
  dropped = 0

  constructor(
    private store: IntervalStore,
    private gapMs = GAP_MS,
    private spacingMs = MIN_EVENT_SPACING_MS
  ) {}

  get currentId(): number | null {
    return this.cur?.id ?? null
  }

  /** The helper is alive at `ts`: extend the open row, or end it if we were silent too long. */
  beat(ts: number): void {
    this.flushPending(ts)
    if (!this.cur) {
      this.lastSeen = Math.max(this.lastSeen, ts)
      return
    }
    if (ts - this.lastSeen > this.gapMs) {
      this.cur = null // row already ends at the last heartbeat
    } else if (ts > this.cur.end) {
      this.cur.end = ts
      this.store.setEnd(this.cur.id, ts)
    }
    this.lastSeen = Math.max(this.lastSeen, ts)
  }

  /** New focus state. `null` means "nothing recordable" (excluded app, tracking stopped). */
  submit(spec: RowSpec | null, ts: number): void {
    this.flushPending(ts)
    if (ts - this.lastAccepted < this.spacingMs) {
      if (this.pending) this.dropped++
      this.pending = { spec, ts }
      return
    }
    this.apply(spec, ts)
  }

  /** Apply a coalesced event once the spacing window has passed. Call from a timer. */
  flush(nowMs: number): void {
    this.flushPending(nowMs)
  }

  /** Close the open row at `ts` (helper exit, stop, quit). */
  close(ts: number): void {
    this.pending = null
    if (this.cur) {
      const end = Math.max(ts, this.cur.end)
      this.store.setEnd(this.cur.id, end)
      this.cur = null
    }
    this.lastSeen = Math.max(this.lastSeen, ts)
  }

  private flushPending(nowMs: number): void {
    const p = this.pending
    if (p && nowMs - this.lastAccepted >= this.spacingMs) {
      this.pending = null
      this.apply(p.spec, Math.max(p.ts, this.lastAccepted))
    }
  }

  private apply(spec: RowSpec | null, rawTs: number): void {
    this.lastAccepted = rawTs
    const cur = this.cur
    // History never goes backwards: a clock step back is clamped to the open row's end.
    const ts = cur ? Math.max(rawTs, cur.end) : rawTs
    if (cur) {
      const silent = ts - this.lastSeen > this.gapMs
      if (silent) {
        this.cur = null // untracked gap: row keeps its last known end
      } else if (spec && keyOf(spec) === cur.key) {
        cur.end = ts
        this.store.setEnd(cur.id, ts)
        this.lastSeen = ts
        return
      } else {
        cur.end = ts
        this.store.setEnd(cur.id, ts)
        this.cur = null
      }
    }
    this.lastSeen = Math.max(this.lastSeen, ts)
    if (spec) {
      const id = this.store.insert(ts, spec)
      this.cur = { id, key: keyOf(spec), start: ts, end: ts }
    }
  }
}

// ---------------------------------------------------------------- day summary

export interface DayRow {
  id: number
  ts: number
  ended_ts: number | null
  app: string
  bundle_id: string
  service: string
  category: string
  kind: string
  detail: string
  idle: boolean
}

export interface DayResult {
  segments: ActivitySegment[]
  byService: ActivityService[]
  byApp: ActivityApp[]
  byCategory: { category: string; seconds: number }[]
  activeSeconds: number
  idleSeconds: number
  stats: ActivityDayStats
}

const BLOCK_TOLERANCE_MS = 30_000
const MAX_SEGMENTS = 4000

/** A row clipped to the day and to `now`, never overlapping the one before it. */
export interface Clipped {
  s: number
  e: number
  row: DayRow
}

/** Clip rows to [start, end), cut off at `now` and repair any overlap. */
export function clipRows(
  rows: DayRow[],
  start: number,
  end: number,
  now: number,
  openId: number | null
): Clipped[] {
  const limit = Math.min(end, now)
  const sorted = [...rows].sort((a, b) => a.ts - b.ts || a.id - b.id)
  const out: Clipped[] = []
  let prevEnd = start
  for (const r of sorted) {
    const stored = r.ended_ts ?? r.ts
    const rowEnd = r.id === openId ? Math.max(stored, now) : stored
    const s = Math.max(r.ts, start, prevEnd)
    const e = Math.min(rowEnd, limit)
    if (!(e > s)) continue
    out.push({ s, e, row: r })
    prevEnd = e
  }
  return out
}

/**
 * Clip rows to [start, end), cut off at `now`, repair any overlap and compute totals, the
 * timeline segments and focus statistics. Rows crossing midnight contribute to both days.
 */
export function buildDay(
  rows: DayRow[],
  start: number,
  end: number,
  now: number,
  openId: number | null
): DayResult {
  const segs: ActivitySegment[] = []
  for (const { s, e, row: r } of clipRows(rows, start, end, now, openId)) {
    const last = segs[segs.length - 1]
    if (
      last &&
      last.end === s &&
      last.bundleId === r.bundle_id &&
      last.service === r.service &&
      last.category === r.category &&
      last.kind === r.kind &&
      last.idle === r.idle
    ) {
      last.end = e
    } else {
      segs.push({
        start: s,
        end: e,
        bundleId: r.bundle_id,
        service: r.service,
        category: r.category,
        kind: r.kind,
        idle: r.idle
      })
    }
  }

  const svc = new Map<string, ActivityService>()
  const svcApps = new Map<string, Map<string, number>>()
  const apps = new Map<
    string,
    {
      bundleId: string
      name: string
      ms: number
      cats: Map<string, number>
      svcs: Map<string, number>
    }
  >()
  const cat = new Map<string, number>()
  let activeMs = 0
  let idleMs = 0
  for (const g of segs) {
    const d = g.end - g.start
    if (g.idle) {
      idleMs += d
      continue
    }
    activeMs += d
    cat.set(g.category, (cat.get(g.category) ?? 0) + d)
    const k = `${g.service}\u0001${g.category}`
    const e = svc.get(k) ?? { service: g.service, category: g.category, seconds: 0, bundleId: '' }
    e.seconds += d / 1000
    svc.set(k, e)
    const perApp = svcApps.get(k) ?? new Map<string, number>()
    perApp.set(g.bundleId, (perApp.get(g.bundleId) ?? 0) + d)
    svcApps.set(k, perApp)
    // apps without a bundle id are grouped by service name so they still show up
    const ak = g.bundleId || `name:${g.service}`
    const a = apps.get(ak) ?? {
      bundleId: g.bundleId,
      name: g.service,
      ms: 0,
      cats: new Map<string, number>(),
      svcs: new Map<string, number>()
    }
    a.ms += d
    a.cats.set(g.category, (a.cats.get(g.category) ?? 0) + d)
    a.svcs.set(g.service, (a.svcs.get(g.service) ?? 0) + d)
    apps.set(ak, a)
  }
  for (const [k, e] of svc) {
    e.bundleId = [...(svcApps.get(k) ?? [])].sort((x, y) => y[1] - x[1])[0]?.[0] ?? ''
  }
  const top = <K>(m: Map<K, number>): K | undefined => [...m].sort((x, y) => y[1] - x[1])[0]?.[0]
  const byApp: ActivityApp[] = [...apps.values()]
    .sort((x, y) => y.ms - x.ms)
    .slice(0, 15)
    .map((a) => ({
      bundleId: a.bundleId,
      name: a.name,
      category: top(a.cats) ?? 'other',
      seconds: a.ms / 1000,
      share: activeMs > 0 ? a.ms / activeMs : 0,
      services: [...a.svcs]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 4)
        .map(([service, ms]) => ({ service, seconds: ms / 1000 }))
    }))

  // Focus blocks: continuous time in one category; brief interruptions (<= 30 s) are absorbed.
  const open = new Map<string, { cat: string; start: number; end: number }>()
  let best: { cat: string; start: number; end: number } | null = null
  let switches = 0
  let prev: ActivitySegment | null = null
  for (const g of segs) {
    if (g.idle) continue
    if (prev && prev.service !== g.service) switches++
    prev = g
    let b = open.get(g.category)
    if (b && g.start - b.end <= BLOCK_TOLERANCE_MS) b.end = g.end
    else {
      b = { cat: g.category, start: g.start, end: g.end }
      open.set(g.category, b)
    }
    if (!best || b.end - b.start > best.end - best.start) best = b
  }
  const activeSeconds = activeMs / 1000
  const timeline = segs.length > MAX_SEGMENTS ? segs.filter((g) => g.end - g.start >= 5000) : segs
  return {
    segments: timeline,
    byService: [...svc.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 15),
    byApp,
    byCategory: [...cat.entries()]
      .map(([category, ms]) => ({ category, seconds: ms / 1000 }))
      .sort((a, b) => b.seconds - a.seconds),
    activeSeconds,
    idleSeconds: idleMs / 1000,
    stats: {
      longestFocusSeconds: best ? (best.end - best.start) / 1000 : 0,
      longestFocusCategory: best?.cat ?? '',
      longestFocusStart: best?.start ?? null,
      switches,
      switchesPerHour:
        activeSeconds >= 300 ? Math.round((switches / (activeSeconds / 3600)) * 10) / 10 : 0
    }
  }
}
