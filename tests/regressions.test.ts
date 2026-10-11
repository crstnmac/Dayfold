import { describe, expect, it, beforeEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/main/db'
import { dispatch, undo } from '../src/main/commands'
import { parse } from '../src/main/parser'
import { buildState } from '../src/main/state'
import { buildContext, resolve } from '../src/main/adapters'
import { isSensitivePage, redact, safePath } from '../src/main/adapters/privacy'
import { today } from '../src/main/dates'
import type { Command } from '../src/shared/types'

// built at run time so no key-shaped literal sits in the source
const fakeKey = ['sk', 'live', 'ABCDEFGHIJKLMNOPQRSTUVWX'].join('_')

let db: DatabaseSync
const run = (c: unknown): string => dispatch(db, c as Command, { source: 't', input: 'x' })
beforeEach(() => {
  db = openDb(':memory:')
})
const r = (app: string, bundleId: string, title: string, url = ''): ReturnType<typeof resolve> =>
  resolve(buildContext({ app, bundleId, title, url }), { captureDetail: false })

describe('command validation (IPC safety)', () => {
  it('rejects bad statuses, dates, ids, huge text, null', () => {
    run({ type: 'task.add', title: 'a' })
    expect(() => run({ type: 'task.setStatus', taskId: 1, status: 'zzz' })).toThrow()
    expect(() => run({ type: 'task.plan', taskId: 1, planDate: '0' })).toThrow()
    expect(() => run({ type: 'task.plan', taskId: -1, planDate: today() })).toThrow()
    expect(() => run({ type: 'dump.add', text: 'x'.repeat(5_000_000) })).toThrow()
    expect(() => run(null)).toThrow()
    expect(() => run({ type: 'nope' })).toThrow()
  })
})

describe('state snapshot', () => {
  it('carryover is the plate: one query, the same tasks', () => {
    run({ type: 'task.add', title: 'a', planDate: today() })
    run({ type: 'task.add', title: 'b' })
    const s = buildState(db)
    expect(s.plate.map((t) => t.title)).toEqual(['a'])
    expect(s.carryover).toEqual(s.plate)
  })
})

describe('undo semantics', () => {
  it('no-op commands do not consume an undo step', () => {
    run({ type: 'task.add', title: 'keep me' })
    expect(() => run({ type: 'day.carryOver', fromDate: today(), toDate: today() })).toThrow()
    expect(undo(db)).toBe('task.add') // still undoes the real edit
  })
  it('setting the same status twice is rejected', () => {
    run({ type: 'task.add', title: 'a' })
    run({ type: 'task.setStatus', taskId: 1, status: 'done' })
    expect(() => run({ type: 'task.setStatus', taskId: 1, status: 'done' })).toThrow()
  })
  it('triaging a dump item twice is rejected', () => {
    run({ type: 'dump.add', text: 'x' })
    run({ type: 'dump.triage', dumpId: 1, to: 'task' })
    expect(() => run({ type: 'dump.triage', dumpId: 1, to: 'task' })).toThrow()
    expect(buildState(db).unplanned).toHaveLength(1)
  })
  it('project notes are stamped with the local date', () => {
    run({ type: 'project.create', name: 'A' })
    run({ type: 'project.note', projectId: 1, text: 'hi' })
    expect(buildState(db).projects[0].notes).toContain(today())
  })
})

describe('parser fixes', () => {
  const kind = (t: string): string => parse(db, t).kind
  it('mark <task> done completes the task instead of dumping', () => {
    run({ type: 'task.add', title: 'send report' })
    const p = parse(db, 'mark send report done')
    expect(p.kind).toBe('commands')
    if (p.kind === 'commands')
      expect(p.commands[0]).toMatchObject({ type: 'task.setStatus', status: 'done' })
  })
  it('a single weak fuzzy hit asks instead of auto-applying', () => {
    run({ type: 'task.add', title: 'Send quarterly reports to Bob' })
    expect(kind('done report')).toBe('choose')
  })
  it('collapses newlines and rejects oversize input', () => {
    const p = parse(db, 'dump: a\nb')
    expect(p).toMatchObject({ kind: 'commands', commands: [{ type: 'dump.add', text: 'a b' }] })
    expect(() => parse(db, 'x'.repeat(3000))).toThrow()
  })
  it('wrap/plate phrases only match whole commands', () => {
    expect(kind('plan tomorrow')).toBe('focus')
    const p = parse(db, 'plan tomorrow: call dentist')
    expect(p).toMatchObject({ kind: 'commands', commands: [{ type: 'dump.add' }] })
  })
  it('"due friday: x" is a task even when a similarly named project exists', () => {
    run({ type: 'project.create', name: 'Friday Launch' })
    const p = parse(db, 'due friday: call mom')
    expect(p).toMatchObject({
      kind: 'commands',
      commands: [{ type: 'task.add', title: 'call mom' }]
    })
  })
  it('"task force meeting notes" is not a task; "new task buy milk" is', () => {
    expect(parse(db, 'task force meeting notes')).toMatchObject({
      commands: [{ type: 'dump.add' }]
    })
    expect(parse(db, 'new task buy milk')).toMatchObject({
      commands: [{ type: 'task.add', title: 'buy milk' }]
    })
  })
  it('project goal containing "by" is not eaten as a deadline', () => {
    const p = parse(db, 'add project X, goal ship by friday')
    expect(p).toMatchObject({
      commands: [{ type: 'project.create', name: 'X', goal: 'ship by friday' }]
    })
  })
})

describe('privacy and adapters', () => {
  it('redacts keys without digits, phones, IPs and unicode emails', () => {
    const out = redact(`josé@exämple.com +1 555 123 4567 10.0.0.12 ${fakeKey}`)
    expect(out).not.toMatch(/@|555|10\.0|ABCDEFGH/)
  })
  it('keeps ordinary long words and filenames readable', () => {
    expect(redact('Quarterly-planning-document')).toBe('Quarterly-planning-document')
  })
  it('drops id-like path segments', () => {
    expect(safePath('/document/d/1AbCdEfGhIjKlMnOp/edit')).toBe('/document/d/edit')
  })
  it('flags login and reset pages as sensitive and records no service detail', () => {
    expect(isSensitivePage('accounts.google.com', '/')).toBe(true)
    expect(isSensitivePage('site.com', '/reset/abc')).toBe(true)
    expect(r('Chrome', 'com.google.Chrome', 't', 'https://bank.com/login').kind).toBe('signing in')
  })
  it('Cursor and VS Code are distinct; Google subdomains are not "Google Search"', () => {
    expect(r('Cursor', 'com.todesktop.230313mzl4w4u92', 'x').service).toBe('Cursor')
    expect(r('Code', 'com.microsoft.VSCode', 'x').service).toBe('VS Code')
    expect(r('Chrome', 'com.google.Chrome', 't', 'https://news.google.com/').service).toBe(
      'news.google.com'
    )
    expect(r('Chrome', 'com.google.Chrome', 't', 'https://www.icloud.com/photos/').service).toBe(
      'iCloud'
    )
  })
})
