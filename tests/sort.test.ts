import { describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { dispatch, undo } from '../src/main/commands'
import { parse } from '../src/main/parser'
import { buildState } from '../src/main/state'
import { seedDemo } from '../src/main/demo'
import { validateCommand } from '../src/main/validate'
import type { SortMode } from '../src/shared/types'

const NOW = new Date(2026, 9, 14, 10, 0, 0)
const fresh = (): ReturnType<typeof openDb> => {
  const db = openDb(':memory:')
  seedDemo(db, NOW)
  return db
}
const sortOf = (text: string): SortMode | null => {
  const r = parse(fresh(), text, NOW)
  return r.kind === 'commands' && r.commands[0]?.type === 'view.sort' ? r.commands[0].mode : null
}

describe('sort phrases', () => {
  it.each([
    ['sort', 'priority'],
    ['sort my tasks', 'priority'],
    ['Sort the tasks please', null],
    ['organize my plate', 'priority'],
    ['prioritize my tasks', 'priority'],
    ['sort my tasks by due date', 'due'],
    ['sort by deadline', 'due'],
    ['order tasks by project', 'project'],
    ['sort by newest first', 'newest'],
    ['sort my tasks by default', 'default'],
    ['reset the sort', 'default']
  ])('%s', (text, mode) => expect(sortOf(text)).toBe(mode))

  it('does not swallow ordinary input', () => {
    expect(sortOf('order flowers for mum')).toBeNull()
    expect(sortOf('sort out the garage')).toBeNull()
    expect(sortOf('add task sort receipts')).toBeNull()
  })
})

describe('sorting the lists', () => {
  it('priority puts overdue, then due today, then in progress first', () => {
    const db = fresh()
    dispatch(db, { type: 'view.sort', mode: 'priority' }, { source: 't', input: 'sort' })
    const s = buildState(db, NOW)
    expect(s.sort).toBe('priority')
    const titles = s.plate.map((t) => t.title)
    // Book flights is overdue; the invoice is due today relative to the seed date's "today"
    expect(titles[0]).toBe('Book flights for Lisbon')
    const rank = (t: (typeof s.plate)[number]): number =>
      t.due && t.due < s.today
        ? 0
        : t.due === s.today
          ? 1
          : t.status === 'doing'
            ? 2
            : t.due
              ? 3
              : 4
    const ranks = s.plate.map(rank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  it('due sorts soonest first with undated last', () => {
    const db = fresh()
    dispatch(db, { type: 'view.sort', mode: 'due' }, { source: 't', input: 'sort by due' })
    const dues = buildState(db, NOW).openTasks.map((t) => t.due)
    const dated = dues.filter((d): d is string => d !== null)
    expect(dated).toEqual([...dated].sort())
    expect(dues.indexOf(null)).toBeGreaterThanOrEqual(dated.length)
  })

  it('project groups by project name, unassigned last', () => {
    const db = fresh()
    dispatch(db, { type: 'view.sort', mode: 'project' }, { source: 't', input: 'by project' })
    const names = buildState(db, NOW).openTasks.map((t) => t.project_name)
    const named = names.filter((n): n is string => n !== null)
    expect(named.map((n) => n.toLowerCase())).toEqual(named.map((n) => n.toLowerCase()).sort())
    expect(names.at(-1)).toBeNull()
  })

  it('is undoable and survives other changes', () => {
    const db = fresh()
    expect(buildState(db, NOW).sort).toBe('default')
    const msg = dispatch(db, { type: 'view.sort', mode: 'due' }, { source: 't', input: 'x' })
    expect(msg).toMatch(/due date/)
    expect(undo(db)).toBe('view.sort')
    expect(buildState(db, NOW).sort).toBe('default')
  })

  it('rejects an unknown mode', () => {
    expect(() => validateCommand({ type: 'view.sort', mode: 'random' })).toThrow()
  })
})

describe('"what should I do next"', () => {
  const answer = (text: string): string | null => {
    const r = parse(fresh(), text, NOW)
    return r.kind === 'answer' ? r.message : null
  }
  it.each([
    'Check what task I would take next',
    'Check which stock I should take next',
    "what's next",
    'what should I do next',
    'which task should I work on first',
    "what's my most important task",
    'tell me what to focus on'
  ])('%s', (text) => expect(answer(text)).toMatch(/^Next: /))

  it('leads with the overdue task and says why, without changing anything', () => {
    const db = fresh()
    const before = db.prepare('SELECT COUNT(*) AS n FROM command_log').get() as { n: number }
    const r = parse(db, 'what should I do next', NOW)
    expect(r.kind === 'answer' && r.message).toMatch(
      /^Next: Book flights for Lisbon \(overdue, carried 3×\)\. Then: /
    )
    expect(db.prepare('SELECT COUNT(*) AS n FROM command_log').get()).toEqual(before)
  })

  it('leaves unrelated questions and statements alone', () => {
    expect(answer('what time is the meeting')).toBeNull()
    expect(answer('buy milk first thing tomorrow')).toBeNull()
    expect(answer('add task plan the next sprint')).toBeNull()
    expect(sortOf('Sort all the tasks')).toBe('priority')
  })
})
