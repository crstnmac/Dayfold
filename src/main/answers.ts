// Read-only replies to "what's due today", "how many tasks", "help" and similar. They look at the
// data and answer in one line; they never change anything.
import type { DatabaseSync } from 'node:sqlite'
import { addDays, today } from './dates'

export const HELP_TEXT =
  'Try: add buy milk tomorrow · done with the invoice · move it to friday · start X · ' +
  'new project Atlas · note on Atlas: … · sort my tasks · what should I do next · ' +
  "what's due today · show projects · wrap up · undo"

const MAX_LISTED = 4

function list(label: string, titles: string[]): string {
  if (titles.length === 0) return `Nothing ${label}.`
  const shown = titles.slice(0, MAX_LISTED).join(', ')
  const more = titles.length > MAX_LISTED ? ` and ${titles.length - MAX_LISTED} more` : ''
  return `${titles.length} ${label}: ${shown}${more}`
}

const titles = (db: DatabaseSync, where: string, ...args: string[]): string[] =>
  (
    db
      .prepare(
        `SELECT title FROM tasks WHERE status IN ('todo','doing') AND ${where}
         ORDER BY due IS NULL, due, carry_count DESC, id`
      )
      .all(...args) as { title: string }[]
  ).map((r) => r.title)

export type DuePeriod = 'overdue' | 'today' | 'tomorrow' | 'week' | 'next week'

export function dueAnswer(db: DatabaseSync, period: DuePeriod, now = new Date()): string {
  const t = today(now)
  switch (period) {
    case 'overdue':
      return list('overdue', titles(db, 'due < ?', t))
    case 'today':
      return list('due today', titles(db, 'due = ?', t))
    case 'tomorrow':
      return list('due tomorrow', titles(db, 'due = ?', addDays(t, 1)))
    case 'week':
      return list('due in the next 7 days', titles(db, 'due >= ? AND due <= ?', t, addDays(t, 7)))
    default:
      return list(
        'due next week',
        titles(db, 'due > ? AND due <= ?', addDays(t, 7), addDays(t, 14))
      )
  }
}

/** What is planned for tomorrow (planned or due), as one line. */
export function tomorrowAnswer(db: DatabaseSync, now = new Date()): string {
  const tomorrow = addDays(today(now), 1)
  return list('planned for tomorrow', titles(db, 'plan_date = ? OR due = ?', tomorrow, tomorrow))
}

export function countsAnswer(db: DatabaseSync, now = new Date()): string {
  const t = today(now)
  const one = (sql: string, ...args: string[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n
  const plate = one(
    "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('todo','doing') AND plan_date IS NOT NULL AND plan_date <= ?",
    t
  )
  const open = one("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('todo','doing')")
  const inbox = one('SELECT COUNT(*) AS n FROM dump WHERE triaged = 0')
  const overdue = one(
    "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('todo','doing') AND due < ?",
    t
  )
  const bits = [`${plate} to do today`, `${open} open in total`]
  if (overdue > 0) bits.push(`${overdue} overdue`)
  if (inbox > 0) bits.push(`${inbox} in your Inbox`)
  return bits.join(' · ')
}
