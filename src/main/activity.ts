import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type {
  ActivityAppEntry,
  DayReview,
  ActivityEntry,
  ActivitySession,
  ActivitySummary,
  TaskStatus
} from '../shared/types'
import { addDays, toISO } from './dates'
import { buildContext, isBrowserBundle, resolve } from './adapters'
import { isBlockedHost, isSensitivePage, safePath } from './adapters/privacy'
import { buildSessions } from './activity-sessions'
import { summarizeVisibleText } from './activity-context'
import {
  DEFAULT_EXCLUDE,
  DEFAULT_IDLE_SECONDS,
  MAX_ROWS,
  RETENTION_DAYS,
  IntervalTracker,
  buildDay,
  dayBounds,
  isPrivateTitle,
  parseDateArg,
  parseHelperMessage,
  parseStoredExclude,
  validateExclude,
  validateIdleSeconds,
  type DayRow,
  type ContextEvent,
  type FocusEvent,
  type HelperEvent,
  type RowSpec
} from './activity-core'

/** The slice of ChildProcess the tracker uses, so tests can inject a fake helper. */
export type HelperHandle = Pick<ChildProcess, 'stdout' | 'stdin' | 'kill' | 'on'>
export type SpawnFn = (path: string, args: string[]) => HelperHandle

const defaultSpawn: SpawnFn = (path, args) =>
  spawn(path, args, { stdio: ['pipe', 'pipe', 'inherit'] })

/** Session ids are timestamps; review items use `m-<date>-<hash>`. */
const LINK_KEY = /^(\d{1,16}|m-\d{4}-\d{2}-\d{2}-[a-z0-9]{1,10})$/
const MAX_LINE = 64 * 1024
const WATCHDOG_MS = 10_000
/** Helper heartbeats every 15 s; silence beyond this means it is hung. */
const SILENCE_LIMIT_MS = 45_000
const STABLE_RUN_MS = 60_000
const MAX_BACKOFF_MS = 60_000
const PRUNE_EVERY_MS = 6 * 3600_000
/** Screen-text summaries are kept for less time than the rest of the activity. */
export const CONTEXT_RETENTION_DAYS = 14
/** At most one stored sample per app in this window. */
const CONTEXT_MIN_GAP_MS = 25_000
/** Per-app totals scan the whole history, so they are reused for this long between changes. */
const APP_TOTALS_TTL_MS = 30_000

/**
 * Tracks the focused app/window via the macOS Accessibility API (Swift helper).
 * Stores only app, bundle id, service/category/kind, host and (opt-in) redacted detail.
 * Never raw window titles, never field contents.
 */
export class ActivityTracker {
  private proc: HelperHandle | null = null
  private trusted: boolean | null = null
  private buf = ''
  private core: IntervalTracker
  private wantRunning = false
  private failures = 0
  private startedAt = 0
  private lastMsg = 0
  private helperError: string | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private watchdog: NodeJS.Timeout | null = null
  private pruneTimer: NodeJS.Timeout | null = null
  private promptNext = false
  /** What the helper last reported as focused; snippets are only kept for a recordable window. */
  private focus: { bundleId: string; recordable: boolean } = { bundleId: '', recordable: false }
  private lastContext = new Map<string, { ts: number; text: string }>()
  /** Prepared statements for the hot paths (every focus change and heartbeat), prepared once. */
  private stmts = new Map<string, StatementSync>()
  private appTotals: { at: number; rows: { id: string; name: string; seconds: number }[] } | null =
    null

  constructor(
    private db: DatabaseSync,
    private helperPath: string,
    private onChange: () => void,
    private spawnFn: SpawnFn = defaultSpawn
  ) {
    this.core = new IntervalTracker({
      insert: (ts, s) => {
        const r = this.stmt(
          `INSERT INTO activity (ts, ended_ts, app, bundle_id, title, idle, service, category, kind, detail, url)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          ts,
          ts,
          s.app,
          s.bundleId,
          '',
          s.idle ? 1 : 0,
          s.service,
          s.category,
          s.kind,
          s.detail,
          s.url
        )
        return Number(r.lastInsertRowid)
      },
      setEnd: (id, end) => {
        this.stmt('UPDATE activity SET ended_ts = ? WHERE id = ?').run(end, id)
      }
    })
    // Rows left open by a crash end where they started (never extended to "now").
    this.db.exec('UPDATE activity SET ended_ts = ts WHERE ended_ts IS NULL')
  }

  // ------------------------------------------------------------------ settings

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql)
    if (!s) this.stmts.set(sql, (s = this.db.prepare(sql)))
    return s
  }

  private setting(key: string): string | undefined {
    const r = this.stmt('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return r?.value
  }

  private put(key: string, value: string): void {
    this.stmt('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  }

  get enabled(): boolean {
    return this.setting('activity.enabled') === '1' // opt-in: off until the user turns it on
  }

  get captureDetail(): boolean {
    return this.setting('activity.detail') === '1'
  }

  get exclude(): string[] {
    return parseStoredExclude(this.setting('activity.exclude'))
  }

  get idleThreshold(): number {
    const n = Number(this.setting('activity.idle'))
    try {
      return this.setting('activity.idle') === undefined
        ? DEFAULT_IDLE_SECONDS
        : validateIdleSeconds(n)
    } catch {
      return DEFAULT_IDLE_SECONDS
    }
  }

  get snippetsEnabled(): boolean {
    return this.setting('activity.snippets') === '1'
  }

  /** Opt in or out of reading visible window text. Turning it off deletes what was stored. */
  setSnippets(on: boolean): void {
    this.put('activity.snippets', on ? '1' : '0')
    if (!on) {
      this.db.exec('DELETE FROM activity_context')
      this.lastContext.clear()
    }
    this.sendConfig()
    this.onChange()
  }

  setCaptureDetail(on: boolean): void {
    this.put('activity.detail', on ? '1' : '0')
    if (!on) {
      // turning detail off also removes what was already stored
      this.db.exec(
        "UPDATE activity SET detail = '', url = CASE WHEN instr(url, '/') > 0 THEN substr(url, 1, instr(url, '/') - 1) ELSE url END"
      )
    }
    this.onChange()
  }

  /** Replace the exclude list. Rows already stored for newly excluded apps are deleted. */
  setExclude(input: unknown): void {
    const ids = validateExclude(input)
    const before = new Set(this.exclude)
    this.put('activity.exclude', JSON.stringify(ids))
    this.appTotals = null
    for (const id of ids) {
      if (!before.has(id)) {
        this.db.prepare('DELETE FROM activity WHERE lower(bundle_id) = ?').run(id)
        this.db.prepare('DELETE FROM activity_context WHERE lower(bundle_id) = ?').run(id)
      }
    }
    // the open row may have been deleted
    this.core.close(Date.now())
    this.sendConfig()
    this.onChange()
  }

  setIdleSeconds(input: unknown): void {
    this.put('activity.idle', String(validateIdleSeconds(input)))
    this.sendConfig()
    this.onChange()
  }

  setEnabled(on: boolean): void {
    this.put('activity.enabled', on ? '1' : '0')
    if (on) {
      this.promptNext = true // user action: allow the one-time macOS permission prompt
      this.start()
    } else this.stop()
  }

  // ------------------------------------------------------------------ retention

  /** Drop rows older than the retention window and cap total rows. */
  prune(days = RETENTION_DAYS, now = Date.now()): void {
    // end of the retention window = N local days ago, DST-safe
    const [y, m, d] = addDays(toISO(new Date(now)), -days)
      .split('-')
      .map(Number)
    const limit = new Date(y, m - 1, d).getTime()
    this.appTotals = null
    this.db.prepare('DELETE FROM activity WHERE COALESCE(ended_ts, ts) < ?').run(limit)
    const [cy, cm, cd] = addDays(toISO(new Date(now)), -Math.min(days, CONTEXT_RETENTION_DAYS))
      .split('-')
      .map(Number)
    this.db
      .prepare('DELETE FROM activity_context WHERE ts < ?')
      .run(new Date(cy, cm - 1, cd).getTime())
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM activity').get() as { n: number }).n
    if (n > MAX_ROWS) {
      this.db
        .prepare(
          'DELETE FROM activity WHERE id IN (SELECT id FROM activity ORDER BY id ASC LIMIT ?)'
        )
        .run(n - MAX_ROWS)
    }
    try {
      this.db.exec('PRAGMA wal_checkpoint(PASSIVE)')
    } catch {
      /* best effort */
    }
  }

  // ------------------------------------------------------------------ helper lifecycle

  start(): void {
    if (this.proc || !this.enabled) return
    this.wantRunning = true
    this.prune()
    if (!this.pruneTimer) {
      this.pruneTimer = setInterval(() => this.prune(), PRUNE_EVERY_MS)
      this.pruneTimer.unref?.()
    }
    this.spawnHelper()
  }

  private spawnHelper(): void {
    if (this.proc || !this.wantRunning) return
    if (!existsSync(this.helperPath) && this.spawnFn === defaultSpawn) {
      this.helperError =
        'The tracking helper is missing from this build (run npm run build:native).'
      console.error(`[activity] helper missing at ${this.helperPath}; run npm run build:native`)
      this.onChange()
      return
    }
    const args = [String(this.idleThreshold)]
    if (this.promptNext) args.push('--prompt')
    this.promptNext = false
    let p: HelperHandle
    try {
      p = this.spawnFn(this.helperPath, args)
    } catch (e) {
      this.helperError = `Could not start the tracking helper: ${(e as Error).message}`
      this.scheduleRestart()
      this.onChange()
      return
    }
    this.proc = p
    this.buf = ''
    this.startedAt = this.lastMsg = Date.now()
    this.helperError = null
    p.stdin?.on?.('error', () => {
      /* helper gone: the exit handler restarts it */
    })
    p.stdout?.setEncoding?.('utf8')
    p.stdout?.on('data', (chunk: string) => {
      if (this.proc === p) this.onData(chunk)
    })
    p.on('error', (e: Error) => {
      console.error('[activity] helper failed:', e.message)
      this.onExit(p)
    })
    p.on('exit', () => this.onExit(p))
    this.sendConfig()
    this.watchdog ??= setInterval(() => this.checkHealth(), WATCHDOG_MS)
    this.watchdog.unref?.()
    this.onChange()
  }

  private onExit(p: HelperHandle): void {
    if (this.proc !== p) return
    this.proc = null
    this.core.close(Date.now()) // close the open interval on crash/exit
    if (this.wantRunning) {
      if (Date.now() - this.startedAt > STABLE_RUN_MS) this.failures = 0
      this.scheduleRestart()
    }
    this.onChange()
  }

  private scheduleRestart(): void {
    if (this.restartTimer || !this.wantRunning) return
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.failures)
    this.failures++
    this.helperError = `The tracking helper stopped; restarting in ${Math.round(delay / 1000)}s.`
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnHelper()
    }, delay)
    this.restartTimer.unref?.()
  }

  /** Kill a helper that has stopped talking (hung). The exit handler restarts it. */
  private checkHealth(): void {
    this.core.flush(Date.now())
    if (this.proc && Date.now() - this.lastMsg > SILENCE_LIMIT_MS) {
      console.error('[activity] helper silent; restarting')
      this.proc.kill()
    }
  }

  private sendConfig(): void {
    const line =
      JSON.stringify({
        idle: this.idleThreshold,
        exclude: this.exclude,
        snippets: this.snippetsEnabled
      }) + '\n'
    try {
      this.proc?.stdin?.write(line)
    } catch {
      /* helper gone */
    }
  }

  stop(): void {
    this.wantRunning = false
    this.failures = 0
    this.helperError = null
    for (const t of [this.restartTimer, this.watchdog, this.pruneTimer]) {
      if (t) clearTimeout(t)
    }
    this.restartTimer = this.watchdog = this.pruneTimer = null
    const p = this.proc
    this.proc = null
    p?.stdin?.end()
    p?.kill()
    this.core.close(Date.now())
    this.onChange()
  }

  // ------------------------------------------------------------------ helper stream

  private onData(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line || line.length > MAX_LINE) continue
      try {
        const ev = parseHelperMessage(JSON.parse(line), Date.now())
        if (ev) this.handle(ev)
      } catch (e) {
        // never log the line itself: it may contain a window title
        console.error('[activity] unparseable helper line:', (e as Error).message)
      }
    }
    if (this.buf.length > MAX_LINE) {
      console.error('[activity] helper output exceeded 64KB without a newline; restarting it')
      this.buf = ''
      this.proc?.kill()
    }
  }

  private handle(ev: HelperEvent): void {
    this.lastMsg = Date.now()
    if (ev.type === 'status') {
      this.trusted = ev.trusted
    } else if (ev.type === 'heartbeat') {
      this.core.beat(ev.ts)
      return
    } else if (ev.type === 'context') {
      this.storeContext(ev)
      return
    } else {
      const row = this.toRow(ev)
      this.focus = {
        bundleId: ev.bundleId,
        recordable: row !== null && !row.idle && this.pageAllowed(ev)
      }
      this.core.submit(row, ev.ts)
    }
    this.onChange()
  }

  /** False for private windows, secure fields and banking or sign-in pages. */
  private pageAllowed(ev: FocusEvent): boolean {
    if (ev.secure || ev.private) return false
    if (isBrowserBundle(ev.bundleId) && isPrivateTitle(ev.title)) return false
    const page = buildContext({ app: ev.app, bundleId: ev.bundleId, title: '', url: ev.url ?? '' })
    if (isBrowserBundle(ev.bundleId) && !page.host) return false // cannot tell which site this is
    return !page.host || (!isBlockedHost(page.host) && !isSensitivePage(page.host, page.path))
  }

  /** Keep a redacted summary of the visible text, only for the window that is in front. */
  private storeContext(ev: ContextEvent): void {
    const id = ev.bundleId.toLowerCase()
    if (!this.snippetsEnabled || !this.focus.recordable) return
    if (ev.bundleId !== this.focus.bundleId || this.exclude.includes(id)) return
    const text = summarizeVisibleText(ev.text)
    if (!text) return
    const last = this.lastContext.get(id)
    if (last && (last.text === text || ev.ts - last.ts < CONTEXT_MIN_GAP_MS)) return
    this.lastContext.set(id, { ts: ev.ts, text })
    this.db
      .prepare('INSERT INTO activity_context (ts, bundle_id, text) VALUES (?,?,?)')
      .run(ev.ts, ev.bundleId, text)
    this.onChange()
  }

  /** Decide what (if anything) to record for a focus event. Titles are only used to classify. */
  private toRow(ev: FocusEvent): RowSpec | null {
    if (ev.excluded || (ev.bundleId && this.exclude.includes(ev.bundleId.toLowerCase()))) {
      return null // excluded apps leave no row at all
    }
    const priv = ev.private || (isBrowserBundle(ev.bundleId) && isPrivateTitle(ev.title))
    const blind = ev.secure || ev.idle || priv // title and URL are not consulted
    const title = blind ? '' : ev.title
    const rawUrl = blind ? '' : (ev.url ?? '')
    const r = resolve(buildContext({ app: ev.app, bundleId: ev.bundleId, title, url: rawUrl }), {
      captureDetail: this.captureDetail
    })
    const page = buildContext({ app: ev.app, bundleId: ev.bundleId, title: '', url: rawUrl })
    // Host only by default; a cleaned path is kept only when detail capture is on.
    const url =
      !page.host || isBlockedHost(page.host) || isSensitivePage(page.host, page.path)
        ? ''
        : this.captureDetail
          ? page.host + safePath(page.path)
          : page.host
    return {
      app: ev.app,
      bundleId: ev.bundleId,
      service: r.service,
      category: r.category,
      kind: priv ? 'private browsing' : r.kind,
      detail: r.detail,
      url,
      idle: ev.idle
    }
  }

  purge(): void {
    this.db.exec('PRAGMA secure_delete = ON; DELETE FROM activity; DELETE FROM activity_context;')
    this.lastContext.clear()
    this.appTotals = null
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;')
    this.core.close(Date.now())
    this.onChange()
  }

  // ------------------------------------------------------------------ day review

  private reviewKey = (date: string): string => `activity.review.${date}`

  saveReview(review: DayReview): void {
    this.put(this.reviewKey(review.date), JSON.stringify(review))
    // keep reviews for the retention window only
    const rows = this.db
      .prepare("SELECT key FROM settings WHERE key LIKE 'activity.review.%' ORDER BY key DESC")
      .all() as { key: string }[]
    for (const r of rows.slice(RETENTION_DAYS + 1))
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(r.key)
    this.onChange()
  }

  getReview(date: string): DayReview | null {
    try {
      const raw = this.setting(this.reviewKey(date))
      if (!raw) return null
      const r = JSON.parse(raw) as DayReview
      if (r.date !== date || typeof r.summary !== 'string') return null
      const links = this.taskLinks()
      const get = this.db.prepare('SELECT id FROM tasks WHERE id = ?')
      return {
        ...r,
        missed: r.missed.map((m) => {
          const id = links[m.key]
          return { ...m, taskId: id !== undefined && get.get(id) ? id : null }
        })
      }
    } catch {
      return null // a corrupt saved review is dropped, never shown half-parsed
    }
  }

  // ------------------------------------------------------------------ session tasks

  private taskLinks(): Record<string, number> {
    try {
      const v = JSON.parse(this.setting('activity.sessionTasks') ?? '{}') as unknown
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
      return Object.fromEntries(
        Object.entries(v).filter(([k, id]) => LINK_KEY.test(k) && Number.isInteger(id))
      ) as Record<string, number>
    } catch {
      return {}
    }
  }

  /** Remember which task was created from a session so the UI can show it as added. */
  linkTask(sessionId: string, taskId: number): void {
    if (!LINK_KEY.test(sessionId)) throw new Error('invalid session')
    const links = { ...this.taskLinks(), [sessionId]: taskId }
    // keep the newest 300 links (task ids grow over time, so the highest are the newest)
    const keep = Object.keys(links)
      .sort((a, b) => links[b] - links[a])
      .slice(0, 300)
    this.put(
      'activity.sessionTasks',
      JSON.stringify(Object.fromEntries(keep.map((k) => [k, links[k]])))
    )
    this.onChange()
  }

  private withTasks(sessions: Omit<ActivitySession, 'taskId' | 'taskStatus'>[]): ActivitySession[] {
    const links = this.taskLinks()
    const get = this.db.prepare('SELECT status FROM tasks WHERE id = ?')
    return sessions.map((s) => {
      const id = links[s.id]
      const row = id === undefined ? undefined : (get.get(id) as { status: TaskStatus } | undefined)
      // a task that was deleted or undone no longer counts as added
      return { ...s, taskId: row ? id : null, taskStatus: row?.status ?? null }
    })
  }

  /** Apps in the retained history plus excluded ones, for the recording manager. */
  private appEntries(excluded: Set<string>): ActivityAppEntry[] {
    const defaults = new Set(DEFAULT_EXCLUDE)
    const now = Date.now()
    if (!this.appTotals || now - this.appTotals.at > APP_TOTALS_TTL_MS) {
      this.appTotals = {
        at: now,
        rows: this.db
          .prepare(
            `SELECT lower(bundle_id) AS id, MAX(app) AS name,
                SUM(CASE WHEN idle = 0 THEN COALESCE(ended_ts, ts) - ts ELSE 0 END) / 1000.0 AS seconds
         FROM activity WHERE bundle_id != '' GROUP BY lower(bundle_id)`
          )
          .all() as { id: string; name: string; seconds: number }[]
      }
    }
    const seen = this.appTotals.rows
    const out = new Map<string, ActivityAppEntry>()
    for (const r of seen) {
      out.set(r.id, {
        bundleId: r.id,
        name: r.name ?? '',
        seconds: r.seconds ?? 0,
        excluded: excluded.has(r.id),
        isDefault: defaults.has(r.id)
      })
    }
    for (const id of excluded) {
      if (!out.has(id)) {
        out.set(id, {
          bundleId: id,
          name: '',
          seconds: 0,
          excluded: true,
          isDefault: defaults.has(id)
        })
      }
    }
    return [...out.values()].sort(
      (a, b) => Number(a.excluded) - Number(b.excluded) || b.seconds - a.seconds
    )
  }

  // ------------------------------------------------------------------ queries

  summary(dateArg?: unknown): ActivitySummary {
    const now = Date.now()
    const date = parseDateArg(dateArg, now)
    const { start, end } = dayBounds(date)
    const openId = this.core.currentId
    const rows = (
      this.db
        .prepare(
          `SELECT id, ts, ended_ts, app, bundle_id, service, category, kind, detail, idle FROM activity
           WHERE ts < ? AND COALESCE(ended_ts, ts) > ? ORDER BY ts, id`
        )
        .all(end, start) as unknown as (Omit<DayRow, 'idle'> & { idle: number })[]
    ).map((r) => ({ ...r, idle: r.idle === 1 }))
    const day = buildDay(rows, start, end, now, openId)
    const recent = (
      this.db
        .prepare(
          `SELECT id, ts, ended_ts, app, bundle_id AS bundleId, service, category, kind, detail, idle FROM activity
           WHERE ts < ? AND COALESCE(ended_ts, ts) > ? ORDER BY ts DESC, id DESC LIMIT 30`
        )
        .all(end, start) as unknown as (Omit<ActivityEntry, 'idle'> & { idle: number })[]
    ).map((r) => ({ ...r, idle: r.idle === 1 }))
    const excluded = new Set(this.exclude)
    const contexts = this.snippetsEnabled
      ? (this.db
          .prepare('SELECT ts, text FROM activity_context WHERE ts >= ? AND ts < ? ORDER BY ts')
          .all(start, end) as { ts: number; text: string }[])
      : []
    const sessions = this.withTasks(buildSessions(rows, start, end, now, openId, contexts))
    const apps = this.appEntries(excluded)
    return {
      enabled: this.enabled,
      trusted: this.trusted,
      running: this.proc !== null,
      captureDetail: this.captureDetail,
      todayTotalSeconds: day.activeSeconds,
      byService: day.byService,
      byApp: day.byApp,
      sessions,
      byCategory: day.byCategory,
      recent,
      date,
      earliestDate: addDays(toISO(new Date(now)), -RETENTION_DAYS),
      retentionDays: RETENTION_DAYS,
      dayStart: start,
      dayEnd: end,
      now,
      segments: day.segments,
      idleSeconds: day.idleSeconds,
      stats: day.stats,
      idleThreshold: this.idleThreshold,
      exclude: [...excluded],
      defaultExclude: [...DEFAULT_EXCLUDE],
      apps,
      snippets: this.snippetsEnabled,
      review: this.getReview(date),
      helperError: this.helperError
    }
  }
}
