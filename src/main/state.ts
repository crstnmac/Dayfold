import type { DatabaseSync } from 'node:sqlite'
import type { AppState, DumpItem, Project, SortMode, Task, Wrapup } from '../shared/types'
import { addDays, today } from './dates'

const TASK_SELECT = `SELECT t.id, t.title, t.project_id, p.name AS project_name, t.status, t.due,
  t.plan_date, t.carry_count, t.done_at FROM tasks t LEFT JOIN projects p ON p.id = t.project_id`
const OPEN = `t.status IN ('todo','doing')`
const SORT_MODES: SortMode[] = ['default', 'priority', 'due', 'project', 'newest']

/** ORDER BY for a sort mode. `todayIso` comes from our own date code, never from input. */
export function orderBy(mode: SortMode, todayIso: string): string {
  switch (mode) {
    case 'priority':
      return `CASE WHEN t.due IS NOT NULL AND t.due < '${todayIso}' THEN 0
                   WHEN t.due = '${todayIso}' THEN 1
                   WHEN t.status = 'doing' THEN 2
                   WHEN t.due IS NOT NULL THEN 3 ELSE 4 END,
              t.due, t.carry_count DESC, t.id`
    case 'due':
      return 't.due IS NULL, t.due, t.carry_count DESC, t.id'
    case 'project':
      return 'p.name IS NULL, p.name COLLATE NOCASE, t.due IS NULL, t.due, t.id'
    case 'newest':
      return 't.id DESC'
    default:
      return 't.carry_count DESC, t.id'
  }
}

export function buildState(db: DatabaseSync, now = new Date()): AppState {
  const todayIso = today(now)
  const tomorrow = addDays(todayIso, 1)
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const stored = db.prepare("SELECT value FROM settings WHERE key = 'view.sort'").get() as
    { value: string } | undefined
  const sort = SORT_MODES.find((m) => m === stored?.value) ?? 'default'
  const order = orderBy(sort, todayIso)
  const tasks = (where: string, ...args: (string | number)[]): Task[] =>
    db.prepare(`${TASK_SELECT} WHERE ${where} ORDER BY ${order}`).all(...args) as unknown as Task[]

  const dump = db
    .prepare('SELECT id, text, created_at FROM dump WHERE triaged = 0 ORDER BY id DESC')
    .all() as unknown as DumpItem[]

  const projects = db
    .prepare(
      `SELECT p.id, p.name, p.goal, p.status, p.due, p.next_action, p.notes, p.created_at, p.touched_at,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND ${OPEN}) AS open_tasks
       FROM projects p
       ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                p.due IS NULL, p.due, p.name`
    )
    .all() as unknown as Project[]

  const plate = tasks(`${OPEN} AND t.plan_date IS NOT NULL AND t.plan_date <= ?`, todayIso)

  const wrapups = db
    .prepare(
      `SELECT id, date, completed, carried, dropped, deferred, note, details, created_at
       FROM wrapups ORDER BY date DESC LIMIT 400`
    )
    .all()
    .map((r) => {
      const row = r as unknown as Omit<Wrapup, 'details'> & { details: string }
      let details: Wrapup['details'] = null
      try {
        details = row.details ? (JSON.parse(row.details) as Wrapup['details']) : null
      } catch {
        /* an unreadable blob just means "no details" */
      }
      return { ...row, details }
    }) as Wrapup[]

  return {
    sort,
    now: now.getTime(),
    today: todayIso,
    tomorrow,
    dump,
    projects,
    plate,
    doneToday: tasks(`t.status = 'done' AND t.done_at >= ?`, startOfDay),
    // the same open, planned-by-today set: one query, one copy over IPC
    carryover: plate,
    tomorrowTasks: tasks(`${OPEN} AND t.plan_date = ?`, tomorrow),
    unplanned: tasks(`${OPEN} AND t.plan_date IS NULL`),
    openTasks: tasks(OPEN).slice(0, 1000),
    wrapups,
    wrapupStreak: streak(
      wrapups.map((w) => w.date),
      todayIso
    )
  }
}

/** Consecutive wrap-up days ending today; a missing today does not break a streak that ran through yesterday. */
export function streak(datesDesc: string[], todayIso: string): number {
  const set = new Set(datesDesc)
  let day = set.has(todayIso) ? todayIso : addDays(todayIso, -1)
  let n = 0
  while (set.has(day)) {
    n++
    day = addDays(day, -1)
  }
  return n
}
