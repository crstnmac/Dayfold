import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/main/db'
import { ActivityTracker, type HelperHandle } from '../src/main/activity'
import {
  DEFAULT_EXCLUDE,
  IntervalTracker,
  buildDay,
  dayBounds,
  isPrivateTitle,
  parseDateArg,
  parseHelperMessage,
  validateExclude,
  validateIdleSeconds,
  type RowSpec
} from '../src/main/activity-core'

const spec = (service: string, over: Partial<RowSpec> = {}): RowSpec => ({
  app: service,
  bundleId: `x.${service}`,
  service,
  category: 'work',
  kind: 'using',
  detail: '',
  url: '',
  idle: false,
  ...over
})

class MemStore {
  rows: { id: number; ts: number; end: number; spec: RowSpec }[] = []
  insert(ts: number, s: RowSpec): number {
    this.rows.push({ id: this.rows.length + 1, ts, end: ts, spec: s })
    return this.rows.length
  }
  setEnd(id: number, end: number): void {
    this.rows[id - 1].end = end
  }
}

describe('parseHelperMessage', () => {
  const now = 1_700_000_000_000
  const focus = {
    type: 'focus',
    ts: now,
    app: 'Mail',
    bundleId: 'com.apple.mail',
    title: 'x',
    url: '',
    idle: false,
    secure: false
  }
  it('accepts well-formed events and defaults optional flags', () => {
    expect(parseHelperMessage(focus, now)).toMatchObject({
      type: 'focus',
      private: false,
      reason: ''
    })
    expect(parseHelperMessage({ type: 'status', trusted: false }, now)).toEqual({
      type: 'status',
      trusted: false
    })
    expect(parseHelperMessage({ type: 'heartbeat', ts: now }, now)).toEqual({
      type: 'heartbeat',
      ts: now
    })
  })
  it('rejects malformed events', () => {
    for (const bad of [
      null,
      [],
      'x',
      { type: 'focus' },
      { ...focus, ts: 'now' },
      { ...focus, ts: NaN },
      { ...focus, idle: 1 },
      { ...focus, reason: 'evil' },
      { ...focus, app: 5 },
      { type: 'status', trusted: 'yes' },
      { type: 'other' }
    ]) {
      expect(parseHelperMessage(bad, now)).toBeNull()
    }
  })
  it('clamps timestamps and truncates strings', () => {
    expect((parseHelperMessage({ ...focus, ts: now + 3_600_000 }, now) as { ts: number }).ts).toBe(
      now
    )
    expect((parseHelperMessage({ ...focus, ts: now - 3_600_000 }, now) as { ts: number }).ts).toBe(
      now
    )
    const e = parseHelperMessage({ ...focus, title: 'a'.repeat(5000), bundleId: 'bad id!' }, now)
    expect(e).toMatchObject({ bundleId: '' })
    expect((e as { title: string }).title).toHaveLength(1000)
  })
})

describe('validation', () => {
  it('validates the exclude list strictly', () => {
    expect(validateExclude(['Com.Foo.Bar', 'com.foo.bar'])).toEqual(['com.foo.bar'])
    expect(() => validateExclude('x')).toThrow()
    expect(() => validateExclude([1])).toThrow()
    expect(() => validateExclude(['has space'])).toThrow()
    expect(() => validateExclude(["a'; DROP TABLE activity;--"])).toThrow()
    expect(() => validateExclude(Array.from({ length: 201 }, (_, i) => `a.b${i}`))).toThrow()
    expect(DEFAULT_EXCLUDE).toContain('com.apple.keychainaccess')
  })
  it('clamps idle seconds and validates dates', () => {
    expect(validateIdleSeconds(5)).toBe(30)
    expect(validateIdleSeconds(99999)).toBe(1800)
    expect(() => validateIdleSeconds('1')).toThrow()
    const now = new Date(2026, 4, 20, 12).getTime()
    expect(parseDateArg('2026-05-10', now)).toBe('2026-05-10')
    expect(parseDateArg('2026-05-21', now)).toBe('2026-05-20') // future
    expect(parseDateArg('2026-02-30', now)).toBe('2026-05-20') // not a date
    expect(parseDateArg('2025-01-01', now)).toBe('2026-05-20') // beyond retention
    expect(parseDateArg({ x: 1 }, now)).toBe('2026-05-20')
  })
  it('detects private window titles', () => {
    expect(isPrivateTitle('New Tab - Google Chrome (Incognito)')).toBe(true)
    expect(isPrivateTitle('Mozilla Firefox Private Browsing')).toBe(true)
    expect(isPrivateTitle('Inbox - Gmail')).toBe(false)
  })
})

describe('IntervalTracker', () => {
  it('merges consecutive identical states and never overlaps', () => {
    const st = new MemStore()
    const t = new IntervalTracker(st)
    t.submit(spec('A'), 1000)
    t.submit(spec('A'), 5000)
    t.submit(spec('B'), 9000)
    t.submit(spec('A'), 15000)
    t.close(20000)
    expect(st.rows.map((r) => [r.spec.service, r.ts, r.end])).toEqual([
      ['A', 1000, 9000],
      ['B', 9000, 15000],
      ['A', 15000, 20000]
    ])
  })
  it('clamps a clock step backwards to a non-negative duration', () => {
    const st = new MemStore()
    const t = new IntervalTracker(st)
    t.submit(spec('A'), 10_000)
    t.beat(20_000)
    t.submit(spec('B'), 5_000) // clock went back
    t.flush(30_000)
    t.close(5_000)
    for (const r of st.rows) expect(r.end).toBeGreaterThanOrEqual(r.ts)
    expect(st.rows[1].ts).toBeGreaterThanOrEqual(st.rows[0].end)
  })
  it('ends the open row at the last heartbeat after a long silence', () => {
    const st = new MemStore()
    const t = new IntervalTracker(st)
    t.submit(spec('A'), 0)
    t.beat(15_000)
    t.beat(30_000)
    // laptop slept for 2 hours without notifications
    t.submit(spec('A'), 7_200_000)
    t.close(7_210_000)
    expect(st.rows).toHaveLength(2)
    expect(st.rows[0].end).toBe(30_000)
    expect(st.rows[1].ts).toBe(7_200_000)
  })
  it('records nothing for excluded (null) states and closes the open row', () => {
    const st = new MemStore()
    const t = new IntervalTracker(st)
    t.submit(spec('A'), 0)
    t.submit(null, 3000)
    t.submit(spec('A'), 6000)
    expect(st.rows).toHaveLength(2)
    expect(st.rows[0].end).toBe(3000)
    expect(t.currentId).toBe(2)
  })
  it('coalesces event floods and keeps the latest state', () => {
    const st = new MemStore()
    const t = new IntervalTracker(st)
    for (let i = 0; i < 10_000; i++) t.submit(spec(i % 2 ? 'A' : 'B'), 1000 + i) // 10 s of events
    t.flush(1000 + 10_000 + 1000)
    t.close(20_000)
    expect(st.rows.length).toBeLessThan(60) // <= 1 row per 250 ms window
    expect(t.dropped).toBeGreaterThan(9000)
    for (let i = 1; i < st.rows.length; i++) {
      expect(st.rows[i].ts).toBeGreaterThanOrEqual(st.rows[i - 1].end)
    }
  })
})

describe('buildDay', () => {
  const day = (y: number, m: number, d: number, h = 0, min = 0): number =>
    new Date(y, m - 1, d, h, min).getTime()
  const row = (
    id: number,
    ts: number,
    ended: number | null,
    service: string,
    over: Record<string, unknown> = {}
  ): Parameters<typeof buildDay>[0][number] => ({
    id,
    ts,
    ended_ts: ended,
    service,
    category: 'work',
    kind: 'using',
    idle: false,
    ...over
  })

  it('splits rows at midnight', () => {
    const rows = [row(1, day(2026, 5, 9, 23, 0), day(2026, 5, 10, 1, 0), 'Xcode')]
    const d9 = dayBounds('2026-05-09')
    const d10 = dayBounds('2026-05-10')
    const now = day(2026, 5, 11, 12)
    expect(buildDay(rows, d9.start, d9.end, now, null).activeSeconds).toBe(3600)
    expect(buildDay(rows, d10.start, d10.end, now, null).activeSeconds).toBe(3600)
  })
  it('counts the open row up to now and ignores future time', () => {
    const now = day(2026, 5, 10, 10, 30)
    const { start, end } = dayBounds('2026-05-10')
    const r = buildDay(
      [row(1, day(2026, 5, 10, 10), day(2026, 5, 10, 10), 'A')],
      start,
      end,
      now,
      1
    )
    expect(r.activeSeconds).toBe(1800)
  })
  it('repairs overlaps, drops negative rows and separates idle', () => {
    const { start, end } = dayBounds('2026-05-10')
    const now = day(2026, 5, 10, 18)
    const r = buildDay(
      [
        row(1, day(2026, 5, 10, 9), day(2026, 5, 10, 10), 'A'),
        row(2, day(2026, 5, 10, 9, 30), day(2026, 5, 10, 10, 30), 'B'), // overlaps A by 30 min
        row(3, day(2026, 5, 10, 12), day(2026, 5, 10, 11), 'C'), // negative
        row(4, day(2026, 5, 10, 10, 30), day(2026, 5, 10, 11, 0), 'A', { idle: true })
      ],
      start,
      end,
      now,
      null
    )
    expect(r.activeSeconds).toBe(5400) // A 1h + B 30 min after clamping
    expect(r.idleSeconds).toBe(1800)
    expect(r.byService.map((s) => s.service)).toEqual(['A', 'B'])
    for (let i = 1; i < r.segments.length; i++) {
      expect(r.segments[i].start).toBeGreaterThanOrEqual(r.segments[i - 1].end)
    }
  })
  it('computes focus blocks and context switches', () => {
    const { start, end } = dayBounds('2026-05-10')
    const now = day(2026, 5, 10, 18)
    const t = (h: number, m: number): number => day(2026, 5, 10, h, m)
    const r = buildDay(
      [
        row(1, t(9, 0), t(9, 40), 'Xcode'),
        row(2, t(9, 40), t(9, 40) + 10_000, 'Slack', { category: 'messaging' }), // 10 s blip
        row(3, t(9, 40) + 10_000, t(10, 20), 'Xcode'),
        row(4, t(11, 0), t(11, 10), 'Mail', { category: 'email' })
      ],
      start,
      end,
      now,
      null
    )
    expect(r.stats.longestFocusCategory).toBe('work')
    expect(r.stats.longestFocusSeconds).toBe(80 * 60) // blip absorbed
    expect(r.stats.switches).toBe(3)
    expect(r.stats.switchesPerHour).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------- tracker with a fake helper

class FakeHelper extends EventEmitter {
  stdout = new PassThrough()
  stdin = new PassThrough()
  killed = false
  written = ''
  constructor() {
    super()
    this.stdin.on('data', (d: Buffer) => (this.written += d.toString()))
  }
  kill(): boolean {
    this.killed = true
    this.emit('exit', null)
    return true
  }
  say(obj: unknown): void {
    this.stdout.write(JSON.stringify(obj) + '\n')
  }
}

describe('ActivityTracker with a fake helper', () => {
  let db: DatabaseSync
  let helpers: FakeHelper[]
  let tracker: ActivityTracker
  const T0 = new Date(2026, 4, 10, 9, 0).getTime()
  const focus = (ts: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'focus',
    ts,
    app: 'Xcode',
    bundleId: 'com.apple.dt.Xcode',
    title: 'SECRET-WINDOW-TITLE',
    url: '',
    idle: false,
    secure: false,
    ...over
  })
  const rows = (): { ts: number; ended_ts: number; app: string; title: string; url: string }[] =>
    db.prepare('SELECT * FROM activity ORDER BY id').all() as never

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    db = openDb(':memory:')
    db.prepare("INSERT INTO settings (key, value) VALUES ('activity.enabled', '1')").run()
    helpers = []
    tracker = new ActivityTracker(
      db,
      '/fake/helper',
      () => undefined,
      () => {
        const h = new FakeHelper()
        helpers.push(h)
        return h as unknown as HelperHandle
      }
    )
  })
  afterEach(() => {
    tracker.stop()
    vi.useRealTimers()
  })

  it('stores metadata only and closes the interval when the helper dies', async () => {
    tracker.start()
    helpers[0].say({ type: 'status', trusted: true })
    helpers[0].say(focus(T0))
    await vi.advanceTimersByTimeAsync(10_000)
    helpers[0].emit('exit', 1) // crash
    const r = rows()
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('')
    expect(r[0].ended_ts).toBeGreaterThanOrEqual(T0 + 10_000)
    expect(JSON.stringify(r)).not.toContain('SECRET')
  })
  it('restarts a crashed helper with exponential backoff', async () => {
    tracker.start()
    helpers[0].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(1100)
    expect(helpers).toHaveLength(2)
    helpers[1].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(1100)
    expect(helpers).toHaveLength(2) // second wait is 2 s
    await vi.advanceTimersByTimeAsync(1000)
    expect(helpers).toHaveLength(3)
  })
  it('kills a helper that goes silent', async () => {
    tracker.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(helpers[0].killed).toBe(true)
  })
  it('ignores garbage, oversize lines and out-of-range messages', async () => {
    tracker.start()
    helpers[0].stdout.write('not json\n{"type":"focus"}\n' + 'x'.repeat(70_000) + '\n')
    helpers[0].say(focus(T0, { idle: 'no' }))
    await vi.advanceTimersByTimeAsync(10)
    expect(rows()).toHaveLength(0)
  })
  it('drops excluded apps entirely and withholds private-window titles', async () => {
    tracker.start()
    helpers[0].say(focus(T0, { app: '1Password', bundleId: 'com.1password.1password' }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(rows()).toHaveLength(0)
    helpers[0].say(
      focus(T0 + 1000, {
        app: 'Google Chrome',
        bundleId: 'com.google.Chrome',
        title: 'Bank - Google Chrome (Incognito)',
        url: 'https://github.com/x/y'
      })
    )
    await vi.advanceTimersByTimeAsync(10)
    const r = rows()
    expect(r).toHaveLength(1)
    expect(r[0].url).toBe('')
    expect(db.prepare('SELECT service, kind FROM activity').get()).toMatchObject({
      service: 'Google Chrome',
      kind: 'private browsing'
    })
  })
  it('stores only the host for browser pages and nothing for blocked sites', async () => {
    tracker.start()
    helpers[0].say(
      focus(T0, {
        app: 'Google Chrome',
        bundleId: 'com.google.Chrome',
        url: 'https://github.com/org/repo?token=abc'
      })
    )
    await vi.advanceTimersByTimeAsync(300)
    helpers[0].say(
      focus(T0 + 1000, {
        app: 'Google Chrome',
        bundleId: 'com.google.Chrome',
        url: 'https://secure.chase.com/accounts'
      })
    )
    await vi.advanceTimersByTimeAsync(10)
    const r = rows()
    expect(r[0].url).toBe('github.com')
    expect(r[1].url).toBe('')
    expect(JSON.stringify(r)).not.toContain('chase')
  })
  it('deleting history for newly excluded apps and sending config to the helper', () => {
    tracker.start()
    helpers[0].say(focus(T0))
    return vi.advanceTimersByTimeAsync(300).then(() => {
      expect(rows()).toHaveLength(1)
      tracker.setExclude(['com.apple.dt.xcode'])
      expect(rows()).toHaveLength(0)
      expect(helpers[0].written).toContain('com.apple.dt.xcode')
      expect(() => tracker.setExclude(['bad id'])).toThrow()
    })
  })
  it('reuses per-app totals for a while but never after an exclude change or purge', () => {
    const insert = (bundle: string): void => {
      db.prepare(
        "INSERT INTO activity (ts, ended_ts, app, bundle_id, title) VALUES (?, ?, 'A', ?, '')"
      ).run(T0 - 60_000, T0, bundle)
    }
    const ids = (): string[] =>
      tracker
        .summary()
        .apps.map((a) => a.bundleId)
        .filter((id) => id.startsWith('x.'))
        .sort()
    insert('x.one')
    expect(ids()).toEqual(['x.one'])
    insert('x.two') // added behind the tracker's back: the cached totals are reused
    expect(ids()).toEqual(['x.one'])
    tracker.setExclude(['x.three']) // changing what is recorded refreshes them
    expect(ids()).toEqual(['x.one', 'x.three', 'x.two'])
    tracker.purge()
    expect(ids()).toEqual(['x.three'])
  })
  it('prunes rows older than 30 days and closes crash orphans on startup', () => {
    const old = T0 - 40 * 86400000
    db.prepare(
      "INSERT INTO activity (ts, ended_ts, app, bundle_id, title) VALUES (?, ?, 'Old', 'o', '')"
    ).run(old, old + 1000)
    db.prepare(
      "INSERT INTO activity (ts, app, bundle_id, title) VALUES (?, 'Orphan', 'q', '')"
    ).run(T0 - 1000)
    tracker.prune()
    const t2 = new ActivityTracker(db, '/fake', () => undefined)
    expect(rows().map((x) => x.app)).toEqual(['Orphan'])
    expect(rows()[0].ended_ts).toBe(rows()[0].ts)
    expect(t2.summary().retentionDays).toBe(30)
  })
  it('summary exposes the chosen day, segments and stats', async () => {
    tracker.start()
    helpers[0].say(focus(T0))
    await vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(10_000)
    helpers[0].say(focus(T0 + 10_000, { app: 'Mail', bundleId: 'com.apple.mail' }))
    await vi.advanceTimersByTimeAsync(300)
    const s = tracker.summary()
    expect(s.date).toBe('2026-05-10')
    expect(s.segments.length).toBeGreaterThan(0)
    expect(s.byService[0].seconds).toBeGreaterThan(5)
    expect(tracker.summary('2026-05-09').segments).toHaveLength(0)
    expect(tracker.summary('garbage').date).toBe('2026-05-10')
  })
})
