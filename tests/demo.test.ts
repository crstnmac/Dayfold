import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/main/db'
import { buildState } from '../src/main/state'
import { ActivityTracker } from '../src/main/activity'
import { isDemoMode, seedDemo, setDemoFlag } from '../src/main/demo'
import { toISO } from '../src/main/dates'

// Evening on a Wednesday, so the whole day's activity is in the past.
const NOW = new Date(2026, 9, 14, 18, 0, 0)

describe('demo data', () => {
  const db = openDb(':memory:')
  seedDemo(db, NOW)
  beforeAll(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }))
  afterAll(() => vi.useRealTimers())

  it('fills the main screens', () => {
    const s = buildState(db, NOW)
    expect(s.projects.length).toBeGreaterThanOrEqual(5)
    expect(s.plate.length).toBeGreaterThanOrEqual(4)
    expect(s.doneToday.length).toBeGreaterThan(0)
    expect(s.tomorrowTasks.length).toBeGreaterThan(0)
    expect(s.unplanned.length).toBeGreaterThan(0)
    expect(s.dump.length).toBeGreaterThan(0)
    expect(s.wrapupStreak).toBe(6)
    expect(s.plate.some((t) => t.carry_count >= 3)).toBe(true)
  })

  it('has a week of activity that turns into sessions', () => {
    const t = new ActivityTracker(db, '/nonexistent', () => {})
    const day = t.summary(toISO(NOW))
    expect(day.todayTotalSeconds).toBeGreaterThan(3 * 3600)
    expect(day.sessions.length).toBeGreaterThanOrEqual(3)
    const yesterday = t.summary('2026-10-13')
    expect(yesterday.review).not.toBeNull()
    expect(day.byApp.length).toBeGreaterThan(4)
  })

  it('never writes after "now"', () => {
    const r = db.prepare('SELECT MAX(ended_ts) AS m FROM activity').get() as { m: number }
    expect(r.m).toBeLessThanOrEqual(NOW.getTime())
  })

  it('toggles the marker file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-'))
    expect(isDemoMode(dir)).toBe(false)
    setDemoFlag(dir, true)
    expect(isDemoMode(dir)).toBe(true)
    setDemoFlag(dir, false)
    expect(isDemoMode(dir)).toBe(false)
  })
})

describe('demo data opened early in the day', () => {
  it('still has activity and sessions for today at 2 AM', () => {
    const early = new Date(2026, 9, 14, 2, 0, 0)
    const db = openDb(':memory:')
    seedDemo(db, early)
    vi.useFakeTimers({ toFake: ['Date'], now: early })
    try {
      const day = new ActivityTracker(db, '/nonexistent', () => {}).summary(toISO(early))
      expect(day.todayTotalSeconds).toBeGreaterThan(30 * 60)
      expect(day.byApp.length).toBeGreaterThan(2)
      const r = db.prepare('SELECT MAX(ended_ts) AS m FROM activity').get() as { m: number }
      expect(r.m).toBeLessThanOrEqual(early.getTime())
    } finally {
      vi.useRealTimers()
    }
  })
})
