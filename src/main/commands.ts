import type { DatabaseSync } from 'node:sqlite'
import type { Command, SortMode, WrapupDetails, WrapupItem } from '../shared/types'
import { toISO } from './dates'
import { validateCommand } from './validate'

type Row = Record<string, string | number | null>
type Table = 'dump' | 'projects' | 'tasks' | 'wrapups' | 'settings'
/** `settings` rows are keyed by `key` (id is 0); every other table by `id`. */
type Inverse = { table: Table; id: number; key?: string; before: Row | null }[]

const TABLES: Table[] = ['dump', 'projects', 'tasks', 'wrapups', 'settings']
const WRAPUP_KEY = 'wrapup.lastDate'
export const SORT_KEY = 'view.sort'
const SORT_MESSAGE: Record<SortMode, string> = {
  default: 'Tasks back in the default order (most carried first)',
  priority: 'Sorted by priority: overdue, due today, in progress, then soonest due',
  due: 'Sorted by due date, soonest first',
  project: 'Sorted by project',
  newest: 'Sorted newest first'
}
const asTable = (t: string): Table => {
  if (!TABLES.includes(t as Table)) throw new Error(`bad table ${t}`)
  return t as Table
}

class Ctx {
  inverse: Inverse = []
  constructor(
    readonly db: DatabaseSync,
    readonly now: number
  ) {}

  /** Record the pre-image of a row before modifying it. */
  touch(table: Table, id: number): void {
    if (this.inverse.some((i) => i.table === table && i.id === id)) return
    const before = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined
    this.inverse.push({ table, id, before: before ?? null })
  }
  /** Record a freshly inserted row (undo deletes it). */
  created(table: Table, id: number): void {
    this.inverse.push({ table, id, before: null })
  }
  insert(table: Table, row: Row): number {
    const cols = Object.keys(row)
    const res = this.db
      .prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...Object.values(row))
    const id = Number(res.lastInsertRowid)
    this.created(table, id)
    return id
  }
  /** Upsert a settings row with an undoable pre-image. */
  setSetting(key: string, value: string): void {
    const before = this.db.prepare('SELECT key, value FROM settings WHERE key = ?').get(key) as
      Row | undefined
    this.inverse.push({ table: 'settings', id: 0, key, before: before ?? null })
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  }
  update(table: Table, id: number, patch: Row): void {
    this.touch(table, id)
    const cols = Object.keys(patch)
    this.db
      .prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(',')} WHERE id = ?`)
      .run(...Object.values(patch), id)
  }
}

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`${what} not found`)
  return v
}

type OpenTask = {
  title: string
  project_id: number | null
  status: string
  plan_date: string | null
}

function openTask(c: Ctx, taskId: number): OpenTask & { due: string | null } {
  const t = must(
    c.db
      .prepare('SELECT title, project_id, status, plan_date, due FROM tasks WHERE id = ?')
      .get(taskId) as (OpenTask & { due: string | null }) | undefined,
    'task'
  )
  if (t.status !== 'todo' && t.status !== 'doing') throw new Error(`Already ${t.status}`)
  return t
}

function touchProject(c: Ctx, projectId: number | null): void {
  if (projectId !== null) c.update('projects', projectId, { touched_at: c.now })
}

function futureDay(c: Ctx, toDate: string): void {
  if (toDate <= toISO(new Date(c.now))) throw new Error('Pick a day after today')
}

/** Wrap-up counts for one local day: tasks finished, plus resolutions recorded in the command log. */
function wrapupCounts(
  db: DatabaseSync,
  date: string
): { completed: number; carried: number; dropped: number; deferred: number } {
  const [y, m, d] = date.split('-').map(Number)
  const start = new Date(y, m - 1, d).getTime()
  const end = new Date(y, m - 1, d + 1).getTime()
  const completed = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND done_at >= ? AND done_at < ?"
        )
        .get(start, end) as { n: number }
    ).n
  )
  const rows = db
    .prepare('SELECT command, inverse FROM command_log WHERE undone = 0 AND ts >= ? AND ts < ?')
    .all(start, end) as { command: string; inverse: string }[]
  let carried = 0
  let dropped = 0
  let deferred = 0
  for (const r of rows) {
    const cmd = JSON.parse(r.command) as Command
    switch (cmd.type) {
      case 'task.carry':
        carried++
        break
      case 'day.carryOver':
        carried += (JSON.parse(r.inverse) as Inverse).filter((i) => i.table === 'tasks').length
        break
      case 'task.defer':
        deferred++
        break
      case 'task.drop':
      case 'task.breakDown':
        dropped++
        break
      case 'task.setStatus':
        if (cmd.status === 'dropped') dropped++
        break
      default:
    }
  }
  return { completed, carried, dropped, deferred }
}

/** The tasks behind a wrap-up's counts, read from the same day's log, so the two always agree. */
function wrapupDetails(db: DatabaseSync, date: string, next: string): WrapupDetails {
  const [y, m, d] = date.split('-').map(Number)
  const start = new Date(y, m - 1, d).getTime()
  const end = new Date(y, m - 1, d + 1).getTime()
  const item = (id: number, to?: string): WrapupItem | null => {
    const r = db
      .prepare(
        `SELECT t.title AS title, p.name AS project FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?`
      )
      .get(id) as { title: string; project: string | null } | undefined
    return r ? { title: r.title, project: r.project, ...(to ? { to } : {}) } : null
  }
  const out: WrapupDetails = { done: [], carried: [], deferred: [], dropped: [], tomorrow: [] }
  const add = (list: WrapupItem[], id: number, to?: string): void => {
    const it = item(id, to)
    if (it) list.push(it)
  }
  for (const r of db
    .prepare(
      "SELECT id FROM tasks WHERE status = 'done' AND done_at >= ? AND done_at < ? ORDER BY done_at"
    )
    .all(start, end) as { id: number }[])
    add(out.done, r.id)
  const rows = db
    .prepare(
      'SELECT command, inverse FROM command_log WHERE undone = 0 AND ts >= ? AND ts < ? ORDER BY ts'
    )
    .all(start, end) as { command: string; inverse: string }[]
  for (const r of rows) {
    const cmd = JSON.parse(r.command) as Command
    switch (cmd.type) {
      case 'task.carry':
        add(out.carried, cmd.taskId, cmd.toDate)
        break
      case 'day.carryOver':
        for (const i of JSON.parse(r.inverse) as Inverse)
          if (i.table === 'tasks') add(out.carried, i.id, cmd.toDate)
        break
      case 'task.defer':
        add(out.deferred, cmd.taskId, cmd.toDate)
        break
      case 'task.drop':
      case 'task.breakDown':
        add(out.dropped, cmd.taskId)
        break
      case 'task.setStatus':
        if (cmd.status === 'dropped') add(out.dropped, cmd.taskId)
        break
      default:
    }
  }
  for (const r of db
    .prepare("SELECT id FROM tasks WHERE status IN ('todo','doing') AND plan_date = ? ORDER BY id")
    .all(next) as { id: number }[])
    add(out.tomorrow, r.id)
  return out
}

function apply(cmd: Command, c: Ctx): string {
  const { db, now } = c
  switch (cmd.type) {
    case 'dump.add': {
      const text = cmd.text.trim()
      if (!text) throw new Error('empty dump')
      c.insert('dump', { text, created_at: now, triaged: 0 })
      return `Added to Inbox: ${text}`
    }
    case 'dump.triage': {
      const d = must(
        db.prepare('SELECT * FROM dump WHERE id = ?').get(cmd.dumpId) as Row | undefined,
        'dump item'
      )
      if (d.triaged === 1) throw new Error('Already sorted')
      c.update('dump', cmd.dumpId, { triaged: 1 })
      if (cmd.to === 'task') {
        if (cmd.projectId !== undefined) {
          must(db.prepare('SELECT id FROM projects WHERE id = ?').get(cmd.projectId), 'project')
          c.update('projects', cmd.projectId, { touched_at: now })
        }
        c.insert('tasks', {
          title: String(d.text),
          project_id: cmd.projectId ?? null,
          plan_date: cmd.planDate ?? null,
          status: 'todo',
          created_at: now
        })
        return 'Dump item became a to-do'
      }
      return 'Dump item discarded'
    }
    case 'project.create': {
      const name = cmd.name.trim()
      if (!name) throw new Error('empty project name')
      c.insert('projects', {
        name,
        goal: cmd.goal?.trim() ?? '',
        due: cmd.due ?? null,
        created_at: now,
        touched_at: now
      })
      return `Created project ${name}`
    }
    case 'project.setDue': {
      const p = must(
        db.prepare('SELECT name FROM projects WHERE id = ?').get(cmd.projectId) as Row | undefined,
        'project'
      )
      c.update('projects', cmd.projectId, { due: cmd.due, touched_at: now })
      return cmd.due ? `${p.name} due ${cmd.due}` : `${p.name} deadline cleared`
    }
    case 'project.setStatus': {
      const p = must(
        db.prepare('SELECT name FROM projects WHERE id = ?').get(cmd.projectId) as Row | undefined,
        'project'
      )
      c.update('projects', cmd.projectId, { status: cmd.status, touched_at: now })
      return `${p.name} is now ${cmd.status}`
    }
    case 'project.note': {
      const p = must(
        db.prepare('SELECT name, notes FROM projects WHERE id = ?').get(cmd.projectId) as
          Row | undefined,
        'project'
      )
      if (!cmd.text.trim()) throw new Error('empty note')
      const stamp = toISO(new Date(now))
      const notes = `${p.notes ? p.notes + '\n' : ''}- ${stamp}: ${cmd.text.trim()}`
      c.update('projects', cmd.projectId, { notes, touched_at: now })
      return `Noted on ${p.name}`
    }
    case 'task.add': {
      const title = cmd.title.trim()
      if (!title) throw new Error('empty task title')
      if (cmd.projectId !== undefined) {
        must(db.prepare('SELECT id FROM projects WHERE id = ?').get(cmd.projectId), 'project')
        c.update('projects', cmd.projectId, { touched_at: now })
      }
      c.insert('tasks', {
        title,
        project_id: cmd.projectId ?? null,
        status: 'todo',
        due: cmd.due ?? null,
        plan_date: cmd.planDate ?? null,
        created_at: now
      })
      return `Added task: ${title}`
    }
    case 'view.sort':
      c.setSetting(SORT_KEY, cmd.mode)
      return SORT_MESSAGE[cmd.mode]
    case 'task.setStatus': {
      const t = must(
        db.prepare('SELECT title, project_id, status FROM tasks WHERE id = ?').get(cmd.taskId) as
          Row | undefined,
        'task'
      )
      const done = cmd.status === 'done'
      if (t.status === cmd.status) throw new Error(`Already ${cmd.status}`)
      c.update('tasks', cmd.taskId, { status: cmd.status, done_at: done ? now : null })
      if (t.project_id !== null) c.update('projects', Number(t.project_id), { touched_at: now })
      return `${t.title}: ${cmd.status}`
    }
    case 'task.plan': {
      const t = must(
        db.prepare('SELECT title FROM tasks WHERE id = ?').get(cmd.taskId) as Row | undefined,
        'task'
      )
      c.update('tasks', cmd.taskId, { plan_date: cmd.planDate })
      return `${t.title} planned for ${cmd.planDate}`
    }
    case 'day.carryOver': {
      const rows = db
        .prepare(
          `SELECT id, carry_count FROM tasks
           WHERE status IN ('todo','doing') AND plan_date IS NOT NULL AND plan_date <= ?`
        )
        .all(cmd.fromDate) as { id: number; carry_count: number }[]
      for (const r of rows)
        c.update('tasks', r.id, { plan_date: cmd.toDate, carry_count: r.carry_count + 1 })
      return `Carried ${rows.length} task(s) to ${cmd.toDate}`
    }
    case 'task.carry': {
      const t = openTask(c, cmd.taskId)
      futureDay(c, cmd.toDate)
      if (t.plan_date !== null && t.plan_date >= cmd.toDate)
        throw new Error('Already planned for that day or later')
      const n = Number(
        (db.prepare('SELECT carry_count FROM tasks WHERE id = ?').get(cmd.taskId) as Row)
          .carry_count
      )
      c.update('tasks', cmd.taskId, { plan_date: cmd.toDate, carry_count: n + 1 })
      touchProject(c, t.project_id)
      return `${t.title} carried to ${cmd.toDate}`
    }
    case 'task.defer': {
      const t = openTask(c, cmd.taskId)
      futureDay(c, cmd.toDate)
      if (t.plan_date === cmd.toDate) throw new Error('Already planned for that day')
      // A deliberate reschedule is a fresh commitment, so the carry streak starts over.
      c.update('tasks', cmd.taskId, { plan_date: cmd.toDate, carry_count: 0 })
      touchProject(c, t.project_id)
      return `${t.title} deferred to ${cmd.toDate}`
    }
    case 'task.drop': {
      const t = openTask(c, cmd.taskId)
      c.update('tasks', cmd.taskId, { status: 'dropped', done_at: null })
      touchProject(c, t.project_id)
      return `Dropped ${t.title}`
    }
    case 'task.breakDown': {
      const t = openTask(c, cmd.taskId)
      c.update('tasks', cmd.taskId, { status: 'dropped', done_at: null })
      for (const title of cmd.titles)
        c.insert('tasks', {
          title,
          project_id: t.project_id,
          status: 'todo',
          due: t.due,
          plan_date: t.plan_date,
          created_at: now
        })
      touchProject(c, t.project_id)
      return `Broke ${t.title} into ${cmd.titles.length} tasks`
    }
    case 'wrapup.complete': {
      if (cmd.date > toISO(new Date(now))) throw new Error('Cannot wrap up a future day')
      const counts = wrapupCounts(db, cmd.date)
      const note = (cmd.note ?? '').trim()
      const [wy, wm, wd] = cmd.date.split('-').map(Number)
      const details = JSON.stringify(
        wrapupDetails(db, cmd.date, toISO(new Date(wy, wm - 1, wd + 1)))
      )
      const existing = db.prepare('SELECT id FROM wrapups WHERE date = ?').get(cmd.date) as
        { id: number } | undefined
      if (existing) c.update('wrapups', existing.id, { ...counts, note, details })
      else c.insert('wrapups', { date: cmd.date, ...counts, note, details, created_at: now })
      c.setSetting(WRAPUP_KEY, cmd.date)
      return `Wrapped up ${cmd.date}`
    }
    case 'task.rename': {
      const t = must(
        db.prepare('SELECT title, project_id FROM tasks WHERE id = ?').get(cmd.taskId) as
          Row | undefined,
        'task'
      )
      const title = cmd.title.trim()
      if (!title) throw new Error('empty task title')
      if (title === t.title) throw new Error('Already named that')
      c.update('tasks', cmd.taskId, { title })
      if (t.project_id !== null) touchProject(c, Number(t.project_id))
      return `Renamed "${t.title}" to "${title}"`
    }
    case 'task.setDue': {
      const t = must(
        db.prepare('SELECT title, due FROM tasks WHERE id = ?').get(cmd.taskId) as Row | undefined,
        'task'
      )
      if (t.due === cmd.due) throw new Error('Already set')
      c.update('tasks', cmd.taskId, { due: cmd.due })
      return cmd.due ? `${t.title} due ${cmd.due}` : `${t.title} deadline cleared`
    }
    case 'task.delete': {
      const t = must(
        db.prepare('SELECT title, project_id FROM tasks WHERE id = ?').get(cmd.taskId) as
          Row | undefined,
        'task'
      )
      if (t.project_id !== null) touchProject(c, Number(t.project_id))
      c.touch('tasks', cmd.taskId)
      db.prepare('DELETE FROM tasks WHERE id = ?').run(cmd.taskId)
      return `Deleted ${t.title}`
    }
    case 'project.rename': {
      const p = must(
        db.prepare('SELECT name FROM projects WHERE id = ?').get(cmd.projectId) as Row | undefined,
        'project'
      )
      const name = cmd.name.trim()
      if (!name) throw new Error('empty project name')
      if (name === p.name) throw new Error('Already named that')
      c.update('projects', cmd.projectId, { name, touched_at: now })
      return `Renamed project "${p.name}" to "${name}"`
    }
    case 'project.delete': {
      const p = must(
        db.prepare('SELECT name FROM projects WHERE id = ?').get(cmd.projectId) as Row | undefined,
        'project'
      )
      const rows = db.prepare('SELECT id FROM tasks WHERE project_id = ?').all(cmd.projectId) as {
        id: number
      }[]
      for (const r of rows) c.update('tasks', r.id, { project_id: null })
      c.touch('projects', cmd.projectId)
      db.prepare('DELETE FROM projects WHERE id = ?').run(cmd.projectId)
      return rows.length
        ? `Deleted project ${p.name} (${rows.length} task(s) kept, now unassigned)`
        : `Deleted project ${p.name}`
    }
    case 'dump.edit': {
      const d = must(
        db.prepare('SELECT text FROM dump WHERE id = ?').get(cmd.dumpId) as Row | undefined,
        'dump item'
      )
      const text = cmd.text.trim()
      if (!text) throw new Error('empty dump')
      if (text === d.text) throw new Error('Unchanged')
      c.update('dump', cmd.dumpId, { text })
      return `Dump item updated: ${text}`
    }
    case 'dump.delete': {
      const d = must(
        db.prepare('SELECT text FROM dump WHERE id = ?').get(cmd.dumpId) as Row | undefined,
        'dump item'
      )
      c.touch('dump', cmd.dumpId)
      db.prepare('DELETE FROM dump WHERE id = ?').run(cmd.dumpId)
      return `Deleted dump item: ${d.text}`
    }
    case 'project.setNextAction':
    case 'project.setGoal': {
      const p = must(
        db
          .prepare('SELECT name, goal, next_action FROM projects WHERE id = ?')
          .get(cmd.projectId) as Row | undefined,
        'project'
      )
      const field = cmd.type === 'project.setGoal' ? 'goal' : 'next_action'
      const value = cmd.text.trim()
      if (p[field] === value) throw new Error('Already set')
      c.update('projects', cmd.projectId, { [field]: value, touched_at: now })
      return field === 'goal' ? `Goal updated on ${p.name}` : `Next action updated on ${p.name}`
    }
    case 'project.setNotes': {
      const p = must(
        db.prepare('SELECT name, notes FROM projects WHERE id = ?').get(cmd.projectId) as
          Row | undefined,
        'project'
      )
      if (cmd.expected !== undefined && cmd.expected !== p.notes)
        throw new Error('Notes changed since you opened them')
      if (cmd.notes === p.notes) throw new Error('Notes unchanged')
      c.update('projects', cmd.projectId, { notes: cmd.notes, touched_at: now })
      return `Saved notes on ${p.name}`
    }
  }
}

/** The only way state changes. Applies atomically and records an inverse for undo. */
export function dispatch(
  db: DatabaseSync,
  rawCmd: Command,
  meta: { source: string; input: string; now?: number }
): string {
  const cmd = validateCommand(rawCmd)
  const now = meta.now ?? Date.now()
  const ctx = new Ctx(db, now)
  db.exec('BEGIN')
  try {
    const message = apply(cmd, ctx)
    if (ctx.inverse.length === 0) {
      db.exec('ROLLBACK')
      throw new Error('Nothing to change')
    }
    db.prepare(
      'INSERT INTO command_log (ts, source, input, command, inverse) VALUES (?,?,?,?,?)'
    ).run(now, meta.source, meta.input, JSON.stringify(cmd), JSON.stringify(ctx.inverse))
    db.exec('COMMIT')
    return message
  } catch (e) {
    rollback(db)
    throw e
  }
}

function rollback(db: DatabaseSync): void {
  try {
    if (db.isTransaction) db.exec('ROLLBACK')
  } catch {
    /* keep the original error */
  }
}

export function undo(db: DatabaseSync): string | null {
  const last = db
    .prepare(
      'SELECT id, command, inverse FROM command_log WHERE undone = 0 ORDER BY id DESC LIMIT 1'
    )
    .get() as { id: number; command: string; inverse: string } | undefined
  if (!last) return null
  const inverse = JSON.parse(last.inverse) as Inverse
  db.exec('BEGIN')
  try {
    for (const { table, id, key, before } of [...inverse].reverse()) {
      const t = asTable(table)
      if (before === null) {
        if (t === 'settings') db.prepare('DELETE FROM settings WHERE key = ?').run(String(key))
        else db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(id)
      } else {
        const cols = Object.keys(before)
        db.prepare(
          `INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        ).run(...Object.values(before))
      }
    }
    db.prepare('UPDATE command_log SET undone = 1 WHERE id = ?').run(last.id)
    db.exec('COMMIT')
  } catch (e) {
    rollback(db)
    throw e
  }
  return (JSON.parse(last.command) as Command).type
}

const UNDO_LABELS: Record<Command['type'], string> = {
  'dump.add': 'adding to the inbox',
  'dump.triage': 'sorting the inbox item',
  'dump.edit': 'editing the inbox item',
  'dump.delete': 'deleting the inbox item',
  'project.create': 'creating the project',
  'project.setDue': 'the project deadline change',
  'project.setStatus': 'the project status change',
  'project.note': 'adding the note',
  'project.setNextAction': 'the next action change',
  'project.setGoal': 'the goal change',
  'project.setNotes': 'the notes edit',
  'project.rename': 'renaming the project',
  'project.delete': 'deleting the project',
  'task.add': 'adding the task',
  'task.setStatus': 'the status change',
  'task.plan': 'moving the task',
  'task.carry': 'carrying the task',
  'task.defer': 'deferring the task',
  'task.drop': 'dropping the task',
  'task.breakDown': 'breaking the task down',
  'task.rename': 'renaming the task',
  'task.setDue': 'the due date change',
  'task.delete': 'deleting the task',
  'day.carryOver': 'carrying the day over',
  'wrapup.complete': 'the wrap-up',
  'view.sort': 'sorting'
}

/** Plain-language name for an undone command, e.g. "adding the task". */
export const undoLabel = (type: string): string =>
  UNDO_LABELS[type as Command['type']] ?? 'the last change'
