import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/main/db'
import { dispatch, undo } from '../src/main/commands'
import { parse, type Parsed } from '../src/main/parser'
import { buildState, streak } from '../src/main/state'
import { addDays, today } from '../src/main/dates'
import type { Command } from '../src/shared/types'

let db: DatabaseSync
const run = (c: unknown): string => dispatch(db, c as Command, { source: 't', input: 'x' })
const t0 = today()
const tomorrow = addDays(t0, 1)
const setting = (k: string): string | undefined =>
  (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)
    ?.value
const task = (id: number): Record<string, unknown> =>
  db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>
const cmds = (p: Parsed): Command[] => (p.kind === 'commands' ? p.commands : [])

beforeEach(() => {
  db = openDb(':memory:')
})

describe('task.carry / task.defer / task.drop', () => {
  beforeEach(() => {
    run({ type: 'project.create', name: 'Atlas' })
    run({ type: 'task.add', title: 'write spec', projectId: 1, planDate: t0 })
  })

  it('carry plans for the day and bumps carry_count, undo restores', () => {
    run({ type: 'task.carry', taskId: 1, toDate: tomorrow })
    expect(task(1)).toMatchObject({ plan_date: tomorrow, carry_count: 1 })
    expect(buildState(db).tomorrowTasks).toHaveLength(1)
    expect(undo(db)).toBe('task.carry')
    expect(task(1)).toMatchObject({ plan_date: t0, carry_count: 0 })
  })
  it('carry rejects past/today dates, done tasks and unknown ids', () => {
    expect(() => run({ type: 'task.carry', taskId: 1, toDate: t0 })).toThrow(/after today/)
    expect(() => run({ type: 'task.carry', taskId: 1, toDate: '2001-01-01' })).toThrow()
    expect(() => run({ type: 'task.carry', taskId: 99, toDate: tomorrow })).toThrow(/not found/)
    expect(() => run({ type: 'task.carry', taskId: 1, toDate: 'tomorrow' })).toThrow(/invalid/)
    run({ type: 'task.setStatus', taskId: 1, status: 'done' })
    expect(() => run({ type: 'task.carry', taskId: 1, toDate: tomorrow })).toThrow(/Already done/)
  })
  it('carry does not move a task planned later than the target', () => {
    run({ type: 'task.plan', taskId: 1, planDate: addDays(t0, 3) })
    expect(() => run({ type: 'task.carry', taskId: 1, toDate: tomorrow })).toThrow()
  })
  it('defer sets the date and resets the carry streak; undo restores both', () => {
    run({ type: 'task.carry', taskId: 1, toDate: tomorrow })
    run({ type: 'task.defer', taskId: 1, toDate: addDays(t0, 5) })
    expect(task(1)).toMatchObject({ plan_date: addDays(t0, 5), carry_count: 0 })
    undo(db)
    expect(task(1)).toMatchObject({ plan_date: tomorrow, carry_count: 1 })
  })
  it('defer rejects today, the same day and bad dates', () => {
    expect(() => run({ type: 'task.defer', taskId: 1, toDate: t0 })).toThrow()
    run({ type: 'task.defer', taskId: 1, toDate: tomorrow })
    expect(() => run({ type: 'task.defer', taskId: 1, toDate: tomorrow })).toThrow(/Already/)
    expect(() => run({ type: 'task.defer', taskId: 1, toDate: '2030-13-01' })).toThrow(/invalid/)
  })
  it('drop marks dropped, removes from the plate, undo reopens', () => {
    run({ type: 'task.drop', taskId: 1 })
    expect(task(1).status).toBe('dropped')
    expect(buildState(db).plate).toHaveLength(0)
    expect(() => run({ type: 'task.drop', taskId: 1 })).toThrow(/Already dropped/)
    undo(db)
    expect(task(1).status).toBe('todo')
    expect(() => run({ type: 'task.drop', taskId: 0 })).toThrow(/invalid/)
  })
  it('carry/defer/drop/setStatus touch the project', () => {
    db.prepare('UPDATE projects SET touched_at = 1').run()
    run({ type: 'task.drop', taskId: 1 })
    const p = db.prepare('SELECT touched_at FROM projects').get() as { touched_at: number }
    expect(p.touched_at).toBeGreaterThan(1)
  })
})

describe('task.breakDown', () => {
  beforeEach(() => {
    run({ type: 'project.create', name: 'Atlas' })
    run({ type: 'task.add', title: 'big thing', projectId: 1, planDate: t0, due: tomorrow })
  })
  it('replaces the task with subtasks in the same project and undoes atomically', () => {
    run({ type: 'task.breakDown', taskId: 1, titles: ['  a ', 'b', 'c'] })
    expect(task(1).status).toBe('dropped')
    const s = buildState(db)
    expect(s.plate.map((t) => t.title).sort()).toEqual(['a', 'b', 'c'])
    expect(s.plate.every((t) => t.project_name === 'Atlas' && t.carry_count === 0)).toBe(true)
    expect(s.plate[0].due).toBe(tomorrow)
    undo(db)
    expect(db.prepare('SELECT COUNT(*) c FROM tasks').get()).toEqual({ c: 1 })
    expect(task(1).status).toBe('todo')
  })
  it('rejects too many, empty, blank, non-array and missing tasks without side effects', () => {
    const before = db.prepare('SELECT COUNT(*) c FROM command_log').get()
    expect(() =>
      run({ type: 'task.breakDown', taskId: 1, titles: ['1', '2', '3', '4', '5', '6'] })
    ).toThrow(/at most 5/)
    expect(() => run({ type: 'task.breakDown', taskId: 1, titles: [] })).toThrow()
    expect(() => run({ type: 'task.breakDown', taskId: 1, titles: ['ok', '   '] })).toThrow(/empty/)
    expect(() => run({ type: 'task.breakDown', taskId: 1, titles: 'abc' })).toThrow()
    expect(() => run({ type: 'task.breakDown', taskId: 1, titles: [1, 2] })).toThrow()
    expect(() => run({ type: 'task.breakDown', taskId: 7, titles: ['a', 'b'] })).toThrow(
      /not found/
    )
    expect(db.prepare('SELECT COUNT(*) c FROM command_log').get()).toEqual(before)
    expect(db.prepare('SELECT COUNT(*) c FROM tasks').get()).toEqual({ c: 1 })
  })
  it('cannot break down a finished task', () => {
    run({ type: 'task.setStatus', taskId: 1, status: 'done' })
    expect(() => run({ type: 'task.breakDown', taskId: 1, titles: ['a', 'b'] })).toThrow()
  })
})

describe('wrapup.complete', () => {
  it('summarises the day, writes the reminder flag, and undo removes both', () => {
    for (const title of ['a', 'b', 'c', 'd', 'e']) run({ type: 'task.add', title, planDate: t0 })
    run({ type: 'task.setStatus', taskId: 1, status: 'done' })
    run({ type: 'task.carry', taskId: 2, toDate: tomorrow })
    run({ type: 'task.drop', taskId: 3 })
    run({ type: 'task.setStatus', taskId: 4, status: 'dropped' })
    run({ type: 'task.defer', taskId: 5, toDate: addDays(t0, 4) })
    expect(setting('wrapup.lastDate')).toBeUndefined()
    run({ type: 'wrapup.complete', date: t0, note: '  ship it  ' })
    const w = buildState(db).wrapups[0]
    expect(w).toMatchObject({
      date: t0,
      completed: 1,
      carried: 1,
      dropped: 2,
      deferred: 1,
      note: 'ship it'
    })
    expect(setting('wrapup.lastDate')).toBe(t0)
    expect(buildState(db).wrapupStreak).toBe(1)
    expect(undo(db)).toBe('wrapup.complete')
    expect(buildState(db).wrapups).toHaveLength(0)
    expect(setting('wrapup.lastDate')).toBeUndefined()
  })
  it('records which tasks each outcome covered, and what is lined up for tomorrow', () => {
    for (const title of ['a', 'b', 'c', 'd', 'e']) run({ type: 'task.add', title, planDate: t0 })
    run({ type: 'task.setStatus', taskId: 1, status: 'done' })
    run({ type: 'task.carry', taskId: 2, toDate: tomorrow })
    run({ type: 'task.drop', taskId: 3 })
    run({ type: 'task.defer', taskId: 4, toDate: addDays(t0, 4) })
    run({ type: 'task.add', title: 'f', planDate: tomorrow })
    run({ type: 'wrapup.complete', date: t0 })
    const d = buildState(db).wrapups[0].details
    expect(d?.done.map((i) => i.title)).toEqual(['a'])
    expect(d?.carried).toEqual([{ title: 'b', project: null, to: tomorrow }])
    expect(d?.dropped.map((i) => i.title)).toEqual(['c'])
    expect(d?.deferred).toEqual([{ title: 'd', project: null, to: addDays(t0, 4) }])
    expect(d?.tomorrow.map((i) => i.title).sort()).toEqual(['b', 'f'])
  })
  it('counts day.carryOver tasks and ignores undone commands', () => {
    run({ type: 'task.add', title: 'a', planDate: t0 })
    run({ type: 'task.add', title: 'b', planDate: t0 })
    run({ type: 'day.carryOver', fromDate: t0, toDate: tomorrow })
    run({ type: 'task.drop', taskId: 1 })
    undo(db)
    run({ type: 'wrapup.complete', date: t0 })
    expect(buildState(db).wrapups[0]).toMatchObject({ carried: 2, dropped: 0, note: '' })
  })
  it('re-running the same day upserts one row; undo restores the old values and flag', () => {
    run({ type: 'wrapup.complete', date: t0, note: 'first' })
    run({ type: 'wrapup.complete', date: t0, note: 'second' })
    expect(buildState(db).wrapups).toHaveLength(1)
    expect(buildState(db).wrapups[0].note).toBe('second')
    undo(db)
    expect(buildState(db).wrapups[0].note).toBe('first')
    expect(setting('wrapup.lastDate')).toBe(t0)
  })
  it('rejects bad dates, future days and oversize notes', () => {
    expect(() => run({ type: 'wrapup.complete', date: 'today' })).toThrow(/invalid/)
    expect(() => run({ type: 'wrapup.complete', date: tomorrow })).toThrow(/future/)
    expect(() => run({ type: 'wrapup.complete', date: t0, note: 'x'.repeat(5000) })).toThrow()
    expect(() => run({ type: 'wrapup.complete', date: t0, note: 5 })).toThrow()
  })
  it('streak counts consecutive days and tolerates a missing today', () => {
    const d = (n: number): string => addDays(t0, -n)
    expect(streak([], t0)).toBe(0)
    expect(streak([t0, d(1), d(2), d(4)], t0)).toBe(3)
    expect(streak([d(1), d(2)], t0)).toBe(2)
    expect(streak([d(2)], t0)).toBe(0)
  })
})

describe('project fields', () => {
  beforeEach(() => {
    run({ type: 'project.create', name: 'Atlas', goal: 'ship' })
    db.prepare('UPDATE projects SET touched_at = 1').run()
  })
  const project = (): Record<string, unknown> =>
    db.prepare('SELECT * FROM projects WHERE id = 1').get() as Record<string, unknown>

  it('setNextAction and setGoal trim, touch, undo; reject no-ops and bad ids', () => {
    run({ type: 'project.setNextAction', projectId: 1, text: '  call Sam ' })
    expect(project()).toMatchObject({ next_action: 'call Sam' })
    expect(project().touched_at).toBeGreaterThan(1)
    expect(() => run({ type: 'project.setNextAction', projectId: 1, text: 'call Sam' })).toThrow()
    run({ type: 'project.setGoal', projectId: 1, text: 'ship v2' })
    expect(project().goal).toBe('ship v2')
    undo(db)
    expect(project().goal).toBe('ship')
    undo(db)
    expect(project()).toMatchObject({ next_action: '', touched_at: 1 })
    expect(() => run({ type: 'project.setGoal', projectId: 9, text: 'x' })).toThrow(/not found/)
    expect(() => run({ type: 'project.setNextAction', projectId: 1, text: 3 })).toThrow()
  })
  it('setNotes replaces, supports an expected-value guard, and undoes', () => {
    run({ type: 'project.setNotes', projectId: 1, notes: '# Hi\n- a', expected: '' })
    expect(project().notes).toBe('# Hi\n- a')
    expect(() =>
      run({ type: 'project.setNotes', projectId: 1, notes: 'mine', expected: 'stale' })
    ).toThrow(/changed/)
    expect(() => run({ type: 'project.setNotes', projectId: 1, notes: '# Hi\n- a' })).toThrow()
    run({ type: 'project.setNotes', projectId: 1, notes: 'last write wins' }) // no guard
    expect(project().notes).toBe('last write wins')
    run({ type: 'project.note', projectId: 1, text: 'appended' }) // existing append still works
    expect(String(project().notes)).toContain('last write wins\n- ')
    undo(db)
    undo(db)
    expect(project().notes).toBe('# Hi\n- a')
    expect(() => run({ type: 'project.setNotes', projectId: 1, notes: 'x'.repeat(30000) })).toThrow(
      /too long/
    )
  })
  it('project is touched by task add, status change and notes (health clock)', () => {
    const touched = (): number => Number(project().touched_at)
    run({ type: 'task.add', title: 't', projectId: 1 })
    expect(touched()).toBeGreaterThan(1)
    db.prepare('UPDATE projects SET touched_at = 1').run()
    run({ type: 'task.setStatus', taskId: 1, status: 'done' })
    expect(touched()).toBeGreaterThan(1)
    db.prepare('UPDATE projects SET touched_at = 1').run()
    run({ type: 'project.note', projectId: 1, text: 'n' })
    expect(touched()).toBeGreaterThan(1)
  })
})

describe('openTasks in state', () => {
  it('lists every open task including later-planned ones', () => {
    run({ type: 'task.add', title: 'later', planDate: addDays(t0, 9) })
    run({ type: 'task.add', title: 'gone' })
    run({ type: 'task.drop', taskId: 2 })
    expect(buildState(db).openTasks.map((t) => t.title)).toEqual(['later'])
  })
})

describe('migration', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  it('upgrades a v2 database in place and keeps its data', () => {
    dir = mkdtempSync(join(tmpdir(), 'dash-mig-'))
    const path = join(dir, 'dash.sqlite')
    const first = openDb(path)
    first.exec("INSERT INTO projects (name, created_at, touched_at) VALUES ('Old', 1, 1)")
    first.exec('DROP TABLE wrapups; PRAGMA user_version = 2;')
    first.close()
    const upgraded = openDb(path)
    expect(
      (upgraded.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    ).toBeGreaterThanOrEqual(3)
    const cols = upgraded.prepare('PRAGMA table_info(wrapups)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toEqual([
      'id',
      'date',
      'completed',
      'carried',
      'dropped',
      'deferred',
      'note',
      'created_at',
      'details'
    ])
    expect(upgraded.prepare('SELECT name FROM projects').get()).toEqual({ name: 'Old' })
    expect(() =>
      upgraded.exec(
        "INSERT INTO wrapups (date, created_at) VALUES ('2030-01-01', 1), ('2030-01-01', 2)"
      )
    ).toThrow(/UNIQUE/)
    upgraded.close()
  })
})

describe('wrap-up parser phrases', () => {
  beforeEach(() => {
    run({ type: 'task.add', title: 'send quarterly report', planDate: t0 })
    run({ type: 'task.add', title: 'call the plumber', planDate: t0 })
    run({ type: 'project.create', name: 'Atlas' })
    run({ type: 'project.create', name: 'Back to basics' })
  })
  it('carry <task> to tomorrow', () => {
    expect(cmds(parse(db, 'carry send quarterly report to tomorrow'))).toEqual([
      { type: 'task.carry', taskId: 1, toDate: tomorrow }
    ])
    expect(cmds(parse(db, 'carry the plumber over to tomorrow'))[0]).toMatchObject({
      type: 'task.carry',
      taskId: 2
    })
  })
  it('drop <task>', () => {
    expect(cmds(parse(db, 'drop call the plumber'))).toEqual([{ type: 'task.drop', taskId: 2 }])
  })
  it('defer <task> to <date>', () => {
    const p = cmds(parse(db, 'defer call the plumber to in 3 days'))
    expect(p).toEqual([{ type: 'task.defer', taskId: 2, toDate: addDays(t0, 3) }])
    expect(cmds(parse(db, 'defer call the plumber until tomorrow'))[0]).toMatchObject({
      type: 'task.defer',
      toDate: tomorrow
    })
  })
  it('defer to a past/today date or unparseable date falls back to the dump', () => {
    expect(cmds(parse(db, 'defer call the plumber to today'))[0].type).toBe('dump.add')
    expect(cmds(parse(db, 'defer call the plumber to whenever'))[0].type).toBe('dump.add')
  })
  it('unknown tasks fall back to the dump instead of guessing', () => {
    expect(cmds(parse(db, 'drop the ball on Monday'))[0].type).toBe('dump.add')
    expect(cmds(parse(db, 'carry nothing to tomorrow'))[0].type).toBe('dump.add')
    expect(cmds(parse(db, 'drop-in session at 3'))[0].type).toBe('dump.add')
  })
  it('a weak fuzzy hit asks which task rather than dropping it', () => {
    expect(parse(db, 'drop reports').kind).toBe('choose')
  })
  it('set next action for <project> to <text>', () => {
    expect(cmds(parse(db, 'set next action for Atlas to call Sam'))).toEqual([
      { type: 'project.setNextAction', projectId: 1, text: 'call Sam' }
    ])
    expect(cmds(parse(db, 'next action for Atlas: email Bob to confirm'))[0]).toMatchObject({
      projectId: 1,
      text: 'email Bob to confirm'
    })
    // project name containing "to"
    expect(
      cmds(parse(db, 'set next action for Back to basics to read chapter 2'))[0]
    ).toMatchObject({ projectId: 2, text: 'read chapter 2' })
  })
  it('does not shadow existing phrases', () => {
    expect(cmds(parse(db, 'move send quarterly report to tomorrow'))[0].type).toBe('task.plan')
    expect(cmds(parse(db, 'Atlas due tomorrow'))[0].type).toBe('project.setDue')
    expect(cmds(parse(db, 'due friday: carry on'))[0].type).toBe('task.add')
    expect(cmds(parse(db, 'done with call the plumber'))[0].type).toBe('task.setStatus')
    expect(cmds(parse(db, 'note on Atlas: drop the old API'))[0].type).toBe('project.note')
    expect(cmds(parse(db, 'add task drop the old API to Atlas'))[0].type).toBe('task.add')
    expect(cmds(parse(db, 'dump: carry the groceries to tomorrow'))[0].type).toBe('dump.add')
    expect(parse(db, 'wrap up').kind).toBe('focus')
  })
})
