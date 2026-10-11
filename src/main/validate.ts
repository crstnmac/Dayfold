import type { Command, ProjectStatus, SortMode, TaskStatus } from '../shared/types'

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const TASK_STATUS: TaskStatus[] = ['todo', 'doing', 'done', 'dropped']
const PROJECT_STATUS: ProjectStatus[] = ['active', 'paused', 'done']
export const SORT_MODES: SortMode[] = ['default', 'priority', 'due', 'project', 'newest']
export const MAX_TEXT = 2000
export const MAX_INPUT = 2000
export const MAX_NOTES = 20000
export const MAX_BREAKDOWN = 5

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const id = (v: unknown, name: string): number => {
  if (!Number.isSafeInteger(v) || (v as number) <= 0) throw new Error(`invalid ${name}`)
  return v as number
}
const text = (v: unknown, name: string, optional = false): string | undefined => {
  if (v === undefined && optional) return undefined
  if (typeof v !== 'string') throw new Error(`invalid ${name}`)
  if (v.length > MAX_TEXT) throw new Error(`${name} too long`)
  return v
}
const date = (v: unknown, name: string, optional = false): string | undefined => {
  if (v === undefined && optional) return undefined
  if (typeof v !== 'string' || !DATE.test(v)) throw new Error(`invalid ${name}`)
  return v
}

/** Runtime check for commands arriving over IPC. Returns a sanitized copy or throws. */
export function validateCommand(raw: unknown): Command {
  if (!isObj(raw) || typeof raw.type !== 'string') throw new Error('invalid command')
  const c = raw
  switch (c.type) {
    case 'view.sort':
      if (!SORT_MODES.includes(c.mode as SortMode)) throw new Error('invalid sort mode')
      return { type: 'view.sort', mode: c.mode as SortMode }
    case 'dump.add':
      return { type: 'dump.add', text: text(c.text, 'text')! }
    case 'dump.triage': {
      if (c.to !== 'task' && c.to !== 'discard') throw new Error('invalid target')
      return {
        type: 'dump.triage',
        dumpId: id(c.dumpId, 'dumpId'),
        to: c.to,
        projectId: c.projectId === undefined ? undefined : id(c.projectId, 'projectId'),
        planDate: date(c.planDate, 'planDate', true)
      }
    }
    case 'project.create':
      return {
        type: 'project.create',
        name: text(c.name, 'name')!,
        goal: text(c.goal, 'goal', true),
        due: date(c.due, 'due', true)
      }
    case 'project.setDue':
      return {
        type: 'project.setDue',
        projectId: id(c.projectId, 'projectId'),
        due: c.due === null ? null : date(c.due, 'due')!
      }
    case 'project.setStatus':
      if (!PROJECT_STATUS.includes(c.status as ProjectStatus)) throw new Error('invalid status')
      return {
        type: 'project.setStatus',
        projectId: id(c.projectId, 'projectId'),
        status: c.status as ProjectStatus
      }
    case 'project.note':
      return {
        type: 'project.note',
        projectId: id(c.projectId, 'projectId'),
        text: text(c.text, 'text')!
      }
    case 'task.add':
      return {
        type: 'task.add',
        title: text(c.title, 'title')!,
        projectId: c.projectId === undefined ? undefined : id(c.projectId, 'projectId'),
        due: date(c.due, 'due', true),
        planDate: date(c.planDate, 'planDate', true)
      }
    case 'task.setStatus':
      if (!TASK_STATUS.includes(c.status as TaskStatus)) throw new Error('invalid status')
      return {
        type: 'task.setStatus',
        taskId: id(c.taskId, 'taskId'),
        status: c.status as TaskStatus
      }
    case 'task.plan':
      return {
        type: 'task.plan',
        taskId: id(c.taskId, 'taskId'),
        planDate: date(c.planDate, 'planDate')!
      }
    case 'day.carryOver':
      return {
        type: 'day.carryOver',
        fromDate: date(c.fromDate, 'fromDate')!,
        toDate: date(c.toDate, 'toDate')!
      }
    case 'task.carry':
      return {
        type: 'task.carry',
        taskId: id(c.taskId, 'taskId'),
        toDate: date(c.toDate, 'toDate')!
      }
    case 'task.defer':
      return {
        type: 'task.defer',
        taskId: id(c.taskId, 'taskId'),
        toDate: date(c.toDate, 'toDate')!
      }
    case 'task.drop':
      return { type: 'task.drop', taskId: id(c.taskId, 'taskId') }
    case 'task.breakDown': {
      if (!Array.isArray(c.titles)) throw new Error('invalid titles')
      if (c.titles.length < 1) throw new Error('add at least one subtask')
      if (c.titles.length > MAX_BREAKDOWN) throw new Error(`at most ${MAX_BREAKDOWN} subtasks`)
      const titles = c.titles.map((t) => {
        const v = text(t, 'title')!.trim()
        if (!v) throw new Error('empty subtask title')
        return v
      })
      return { type: 'task.breakDown', taskId: id(c.taskId, 'taskId'), titles }
    }
    case 'wrapup.complete':
      return {
        type: 'wrapup.complete',
        date: date(c.date, 'date')!,
        note: text(c.note, 'note', true)
      }
    case 'project.setNextAction':
      return {
        type: 'project.setNextAction',
        projectId: id(c.projectId, 'projectId'),
        text: text(c.text, 'text')!
      }
    case 'project.setGoal':
      return {
        type: 'project.setGoal',
        projectId: id(c.projectId, 'projectId'),
        text: text(c.text, 'text')!
      }
    case 'project.setNotes': {
      const notes = c.notes
      if (typeof notes !== 'string') throw new Error('invalid notes')
      if (notes.length > MAX_NOTES) throw new Error('notes too long')
      const expected = c.expected
      if (expected !== undefined && typeof expected !== 'string')
        throw new Error('invalid expected')
      return {
        type: 'project.setNotes',
        projectId: id(c.projectId, 'projectId'),
        notes,
        expected
      }
    }
    case 'task.rename':
      return {
        type: 'task.rename',
        taskId: id(c.taskId, 'taskId'),
        title: text(c.title, 'title')!
      }
    case 'task.setDue':
      return {
        type: 'task.setDue',
        taskId: id(c.taskId, 'taskId'),
        due: c.due === null ? null : date(c.due, 'due')!
      }
    case 'task.delete':
      return { type: 'task.delete', taskId: id(c.taskId, 'taskId') }
    case 'project.rename':
      return {
        type: 'project.rename',
        projectId: id(c.projectId, 'projectId'),
        name: text(c.name, 'name')!
      }
    case 'project.delete':
      return { type: 'project.delete', projectId: id(c.projectId, 'projectId') }
    case 'dump.edit':
      return { type: 'dump.edit', dumpId: id(c.dumpId, 'dumpId'), text: text(c.text, 'text')! }
    case 'dump.delete':
      return { type: 'dump.delete', dumpId: id(c.dumpId, 'dumpId') }
    default:
      throw new Error(`unknown command ${String(c.type).slice(0, 40)}`)
  }
}
