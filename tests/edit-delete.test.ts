import { describe, expect, it, beforeEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/main/db'
import { dispatch, undo } from '../src/main/commands'
import { parse } from '../src/main/parser'
import { buildState } from '../src/main/state'
import type { Command } from '../src/shared/types'

let db: DatabaseSync
const run = (c: Command): string => dispatch(db, c, { source: 'test', input: 'x' })
const say = (text: string): void => {
  const p = parse(db, text)
  if (p.kind !== 'commands') throw new Error(`not commands: ${p.kind}`)
  p.commands.forEach(run)
}
const titles = (): string[] => buildState(db).unplanned.map((t) => t.title)

beforeEach(() => {
  db = openDb(':memory:')
})

describe('delete and edit via the input bar', () => {
  it('deletes a task by name and undoes it', () => {
    run({ type: 'task.add', title: 'Write report' })
    say('delete write report')
    expect(titles()).toEqual([])
    undo(db)
    expect(titles()).toEqual(['Write report'])
  })

  it('renames a task', () => {
    run({ type: 'task.add', title: 'Write report' })
    say('rename write report to Write Q3 report')
    expect(titles()).toEqual(['Write Q3 report'])
    undo(db)
    expect(titles()).toEqual(['Write report'])
  })

  it('deleting a project keeps its tasks and undo relinks them', () => {
    run({ type: 'project.create', name: 'Atlas' })
    run({ type: 'task.add', title: 'Call Sam', projectId: 1 })
    say('remove project Atlas')
    expect(buildState(db).projects).toHaveLength(0)
    expect(titles()).toEqual(['Call Sam'])
    undo(db)
    expect(buildState(db).projects).toHaveLength(1)
    expect(buildState(db).unplanned[0].project_id).toBe(1)
  })

  it('asks which one when a name matches a task and a project', () => {
    run({ type: 'project.create', name: 'Launch' })
    run({ type: 'task.add', title: 'Launch' })
    const p = parse(db, 'delete launch')
    expect(p.kind).toBe('choose')
    expect(parse(db, 'delete project launch').kind).toBe('commands')
  })

  it('deletes and edits dump items', () => {
    run({ type: 'dump.add', text: 'buy milk' })
    say('rename dump buy milk to buy oat milk')
    expect(buildState(db).dump[0].text).toBe('buy oat milk')
    say('delete dump buy oat milk')
    expect(buildState(db).dump).toHaveLength(0)
  })

  it('sets and clears a task deadline', () => {
    run({ type: 'task.add', title: 'Tax' })
    run({ type: 'task.setDue', taskId: 1, due: '2030-01-01' })
    run({ type: 'task.setDue', taskId: 1, due: null })
    expect(buildState(db).unplanned[0].due).toBeNull()
  })
})
