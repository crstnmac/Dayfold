import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/main/db'
import { ActivityTracker, type HelperHandle } from '../src/main/activity'
import { parseHelperMessage } from '../src/main/activity-core'
import { summarizeVisibleText } from '../src/main/activity-context'
import { contextLines } from '../src/main/activity-sessions'
import { buildReviewInput, reviewKey, toReview } from '../src/main/llm/review'
import type { ActivitySession } from '../src/shared/types'

describe('summarizeVisibleText', () => {
  it('keeps readable content lines and drops interface chrome', () => {
    const out = summarizeVisibleText(
      ['File', 'Edit', 'Quarterly planning notes for the growth team', 'Send', 'x'].join('\n')
    )
    expect(out).toBe('Quarterly planning notes for the growth team')
  })

  it('drops whole lines that mention secrets and masks identifiers', () => {
    const out = summarizeVisibleText(
      [
        'Your password is hunter2 for the staging server',
        'API key: sk-abcdefghijklmnop1234',
        'Reply to maria.lopez@example.com about the contract renewal',
        'Call back on +1 415 555 0134 before the board meeting',
        'Card 4242 4242 4242 4242 expires next month soon',
        'Server at 10.1.2.3 returned an unexpected response'
      ].join('\n')
    )
    expect(out).not.toMatch(/hunter2|sk-|maria|example\.com|415|4242|10\.1\.2\.3/)
    expect(out).toContain('[email]')
    expect(out).toContain('[ip]')
    expect(out).not.toMatch(/password|key/i)
  })

  it('strips URL query strings and fragments', () => {
    const out = summarizeVisibleText(
      'Open https://docs.example.org/page?session=abc123secret#frag now please'
    )
    expect(out).toContain('https://docs.example.org/page')
    expect(out).not.toMatch(/session|abc123|frag/)
  })

  it('skips code-like blobs, dedupes and caps the size', () => {
    expect(summarizeVisibleText('const a = {b: [1,2,3]}; if (x) { return y; } // () {}')).toBe('')
    const many = Array.from(
      { length: 40 },
      (_, i) => `Meeting notes paragraph number ${i} about the roadmap`
    )
    const out = summarizeVisibleText([...many, ...many].join('\n'))
    expect(out.length).toBeLessThanOrEqual(420)
    expect(out.split('\n').length).toBeLessThanOrEqual(5)
    expect(summarizeVisibleText(42)).toBe('')
    expect(summarizeVisibleText('')).toBe('')
  })
})

describe('context messages and session lines', () => {
  const now = 1_700_000_000_000
  it('parses a context event and keeps line breaks', () => {
    const m = parseHelperMessage(
      { type: 'context', ts: now, bundleId: 'com.x.y', text: 'a\nb\u0007c' },
      now
    )
    expect(m).toEqual({ type: 'context', ts: now, bundleId: 'com.x.y', text: 'a\nb c' })
    expect(parseHelperMessage({ type: 'context', ts: now, bundleId: 'x' }, now)).toBeNull()
  })
  it('ranks lines that persist through a session first', () => {
    const rows = [
      { ts: 1, text: 'Roadmap review doc\nA one-off popup message' },
      { ts: 2, text: 'Roadmap review doc\nDraft the launch timeline' },
      { ts: 3, text: 'Roadmap review doc\nDraft the launch timeline' },
      { ts: 99, text: 'Outside the window entirely' }
    ]
    expect(contextLines(rows, 0, 10)).toEqual([
      'Roadmap review doc',
      'Draft the launch timeline',
      'A one-off popup message'
    ])
  })
})

class FakeHelper extends EventEmitter {
  stdout = new PassThrough()
  stdin = new PassThrough()
  written = ''
  constructor() {
    super()
    this.stdin.on('data', (d: Buffer) => (this.written += d.toString()))
  }
  kill(): boolean {
    this.emit('exit', null)
    return true
  }
  say(obj: unknown): void {
    this.stdout.write(JSON.stringify(obj) + '\n')
  }
}

describe('ActivityTracker snippets', () => {
  let db: DatabaseSync
  let h: FakeHelper
  let t: ActivityTracker
  const T0 = new Date(2026, 4, 10, 9, 0).getTime()
  const focus = (ts: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'focus',
    ts,
    app: 'Notes',
    bundleId: 'com.apple.Notes',
    title: 't',
    url: '',
    idle: false,
    secure: false,
    ...over
  })
  const ctx = (
    ts: number,
    text: string,
    bundleId = 'com.apple.Notes'
  ): Record<string, unknown> => ({
    type: 'context',
    ts,
    bundleId,
    text
  })
  const stored = (): string[] =>
    (db.prepare('SELECT text FROM activity_context ORDER BY id').all() as { text: string }[]).map(
      (r) => r.text
    )
  const TEXT = 'Draft the launch timeline for the new onboarding flow'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    db = openDb(':memory:')
    db.prepare("INSERT INTO settings (key, value) VALUES ('activity.enabled', '1')").run()
    t = new ActivityTracker(
      db,
      '/fake',
      () => undefined,
      () => (h = new FakeHelper()) as unknown as HelperHandle
    )
  })
  afterEach(() => {
    t.stop()
    vi.useRealTimers()
  })

  it('stores nothing until the user opts in, and tells the helper', async () => {
    t.start()
    h.say(focus(T0))
    h.say(ctx(T0 + 100, TEXT))
    await vi.advanceTimersByTimeAsync(50)
    expect(stored()).toEqual([])
    expect(h.written).toContain('"snippets":false')
    t.setSnippets(true)
    expect(h.written).toContain('"snippets":true')
  })

  it('stores a redacted summary once, ignoring repeats and bursts', async () => {
    t.setSnippets(true)
    t.start()
    h.say(focus(T0))
    h.say(ctx(T0 + 100, TEXT))
    h.say(ctx(T0 + 200, TEXT)) // same text
    h.say(ctx(T0 + 300, 'Another unrelated paragraph about budgets')) // too soon
    await vi.advanceTimersByTimeAsync(50)
    expect(stored()).toEqual([TEXT])
  })

  it('drops text from excluded apps, private windows, blocked sites and other apps', async () => {
    t.setSnippets(true)
    t.start()
    h.say(
      focus(T0, {
        app: 'Google Chrome',
        bundleId: 'com.google.Chrome',
        url: 'https://secure.chase.com/x'
      })
    )
    h.say(ctx(T0 + 100, TEXT, 'com.google.Chrome'))
    h.say(
      focus(T0 + 1000, {
        app: 'Google Chrome',
        bundleId: 'com.google.Chrome',
        title: 'x (Incognito)',
        url: 'https://github.com/a'
      })
    )
    h.say(ctx(T0 + 1100, TEXT, 'com.google.Chrome'))
    h.say(focus(T0 + 2000, { private: true }))
    h.say(ctx(T0 + 2100, TEXT))
    h.say(focus(T0 + 3000, { secure: true }))
    h.say(ctx(T0 + 3100, TEXT))
    h.say(focus(T0 + 4000)) // fine window, but the text claims another app
    h.say(ctx(T0 + 4100, TEXT, 'com.other.App'))
    h.say(focus(T0 + 5000, { app: '1Password', bundleId: 'com.1password.1password' }))
    h.say(ctx(T0 + 5100, TEXT, 'com.1password.1password'))
    await vi.advanceTimersByTimeAsync(50)
    expect(stored()).toEqual([])
  })

  it('does not trust a browser window whose site is unknown', async () => {
    t.setSnippets(true)
    t.start()
    h.say(focus(T0, { app: 'Google Chrome', bundleId: 'com.google.Chrome', url: '' }))
    h.say(ctx(T0 + 100, TEXT, 'com.google.Chrome'))
    await vi.advanceTimersByTimeAsync(50)
    expect(stored()).toEqual([])
  })

  it('deletes stored text when switched off, purged, or the app is excluded', async () => {
    t.setSnippets(true)
    t.start()
    h.say(focus(T0))
    h.say(ctx(T0 + 100, TEXT))
    await vi.advanceTimersByTimeAsync(50)
    expect(stored()).toHaveLength(1)
    t.setSnippets(false)
    expect(stored()).toEqual([])
    t.setSnippets(true)
    h.say(ctx(T0 + 60_000, TEXT))
    await vi.advanceTimersByTimeAsync(50)
    expect(stored()).toHaveLength(1)
    t.setExclude(['com.apple.notes'])
    expect(stored()).toEqual([])
    t.setExclude([])
    h.say(focus(T0 + 120_000))
    h.say(ctx(T0 + 120_100, TEXT))
    await vi.advanceTimersByTimeAsync(50)
    t.purge()
    expect(stored()).toEqual([])
  })

  it('prunes text older than two weeks', () => {
    const old = T0 - 15 * 86_400_000
    db.prepare('INSERT INTO activity_context (ts, bundle_id, text) VALUES (?,?,?)').run(
      old,
      'a.b',
      'old text here'
    )
    db.prepare('INSERT INTO activity_context (ts, bundle_id, text) VALUES (?,?,?)').run(
      T0,
      'a.b',
      'new text here'
    )
    t.prune()
    expect(stored()).toEqual(['new text here'])
  })
})

describe('AI day review validation', () => {
  const session = (id: string, ctxLines: string[] = []): ActivitySession => ({
    id,
    start: 1,
    end: 2,
    activeSeconds: 1800,
    category: 'docs',
    headline: 'h',
    apps: [{ bundleId: 'a.b', name: 'Notes', seconds: 1800 }],
    services: ['Apple Notes'],
    details: [],
    context: ctxLines,
    interruptions: 0,
    suggestion: { title: 's' },
    taskId: null,
    taskStatus: null
  })
  const input = buildReviewInput('2026-10-10', [session('100'), session('200', ['Launch plan'])], {
    doneToday: [],
    plate: [{ id: 7, title: 'Write the PRD' }] as never
  })

  it('feeds the model on-screen lines as data and nothing else from the day', () => {
    expect(input.sessions[1].onScreen).toEqual(['Launch plan'])
    expect(Object.keys(input.sessions[0]).sort()).toEqual(
      ['apps', 'category', 'details', 'from', 'id', 'minutes', 'onScreen', 'services', 'to'].sort()
    )
  })

  it('keeps only real ids, trims text and drops duplicates of open to-dos', () => {
    const r = toReview(
      {
        summary: '  A focused day. ',
        done: [{ text: 'Planned the launch', sessionIds: ['200', 'nope'] }],
        missed: [
          { title: 'Write the PRD', reason: 'already open', sessionIds: ['100'] },
          { title: 'Send launch plan to Dana', reason: 'draft was left open', sessionIds: ['200'] },
          { title: 'send launch plan to dana', reason: 'dup', sessionIds: [] }
        ],
        untouched: [
          { taskId: 7, reason: 'no sign of work' },
          { taskId: 999, reason: 'invented' }
        ],
        sessionNotes: [
          { sessionId: '200', summary: 'Wrote the launch plan', todo: null },
          { sessionId: 'zzz', summary: 'invented', todo: 'x' }
        ]
      },
      input,
      5
    )
    expect(r.summary).toBe('A focused day.')
    expect(r.done[0].sessionIds).toEqual(['200'])
    expect(r.missed.map((m) => m.title)).toEqual(['Send launch plan to Dana'])
    expect(r.missed[0].key).toBe(reviewKey('2026-10-10', 'Send launch plan to Dana'))
    expect(r.untouched).toEqual([{ taskId: 7, title: 'Write the PRD', reason: 'no sign of work' }])
    expect(Object.keys(r.sessionNotes)).toEqual(['200'])
  })

  it('rejects output with no summary', () => {
    expect(() => toReview({ summary: '' }, input)).toThrow()
    expect(() => toReview(null, input)).toThrow()
  })
})

describe('saved review', () => {
  it('round-trips, resolves added items and ignores corrupt data', () => {
    const db = openDb(':memory:')
    const t = new ActivityTracker(db, '/none', () => undefined)
    const key = reviewKey('2026-10-10', 'Send plan')
    t.saveReview({
      date: '2026-10-10',
      generatedAt: 1,
      summary: 's',
      done: [],
      missed: [{ title: 'Send plan', reason: 'r', sessionIds: [], taskId: null, key }],
      untouched: [],
      sessionNotes: {}
    })
    expect(t.getReview('2026-10-10')?.missed[0].taskId).toBeNull()
    db.prepare("INSERT INTO tasks (title, status, created_at) VALUES ('Send plan','todo',1)").run()
    t.linkTask(key, 1)
    expect(t.getReview('2026-10-10')?.missed[0].taskId).toBe(1)
    db.prepare("UPDATE settings SET value = '{bad' WHERE key = 'activity.review.2026-10-10'").run()
    expect(t.getReview('2026-10-10')).toBeNull()
  })
})
