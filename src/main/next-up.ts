import type { DatabaseSync } from 'node:sqlite'
import { addDays, today } from './dates'
import { orderBy } from './state'

interface Row {
  title: string
  status: string
  due: string | null
  plan_date: string | null
  carry_count: number
  project: string | null
}

/** Why a task is where it is in the priority order, in a few words. */
function why(t: Row, todayIso: string): string {
  const bits: string[] = []
  if (t.due && t.due < todayIso) bits.push('overdue')
  else if (t.due === todayIso) bits.push('due today')
  else if (t.due === addDays(todayIso, 1)) bits.push('due tomorrow')
  else if (t.status === 'doing') bits.push('already in progress')
  else if (t.due) bits.push(`due ${t.due}`)
  if (t.status === 'doing' && !bits.includes('already in progress')) bits.push('in progress')
  if (t.carry_count > 0) bits.push(`carried ${t.carry_count}×`)
  return bits.join(', ')
}

/**
 * A suggestion for what to work on next, using the same order as "sort my tasks": today's plate
 * first, then anything else that is open. Read-only, so it never changes data.
 */
export function nextUp(db: DatabaseSync, now = new Date()): string {
  const todayIso = today(now)
  const query = (where: string): Row[] =>
    db
      .prepare(
        `SELECT t.title, t.status, t.due, t.plan_date, t.carry_count, p.name AS project
         FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.status IN ('todo','doing') AND ${where}
         ORDER BY ${orderBy('priority', todayIso)} LIMIT 3`
      )
      .all(todayIso) as unknown as Row[]
  const rows = query('t.plan_date IS NOT NULL AND t.plan_date <= ?')
  const list = rows.length > 0 ? rows : query('? IS NOT NULL')
  if (list.length === 0) return 'Nothing open. Add a task, or enjoy the free time.'
  const [first, ...rest] = list
  const reason = why(first, todayIso)
  const head = `Next: ${first.title}${reason ? ` (${reason})` : ''}`
  return rest.length > 0 ? `${head}. Then: ${rest.map((t) => t.title).join(', ')}` : head
}
