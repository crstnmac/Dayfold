import type { DatabaseSync } from 'node:sqlite'
import {
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { dirname } from 'node:path'
import type { ExportFormat } from '../shared/types'
import { addDays, startOfLocalDayMs, toISO } from './dates'
import { buildState } from './state'

export interface ExportOptions {
  includeActivity: boolean
  schemaVersion: number
  now?: Date
}

type Row = Record<string, unknown>
const all = (db: DatabaseSync, sql: string, ...args: (string | number)[]): Row[] =>
  db.prepare(sql).all(...args) as Row[]

/** Settings that hold provider config or anything secret-like never leave the database. */
const isPrivateSetting = (key: string): boolean =>
  /^llm\b/i.test(key) || /key|secret|token|password|credential/i.test(key)

function commandType(json: unknown): string {
  try {
    return String((JSON.parse(String(json)) as { type?: unknown }).type ?? '?')
  } catch {
    return '?'
  }
}

export function exportJson(
  db: DatabaseSync,
  o: ExportOptions,
  withActivityRows = true
): Record<string, unknown> {
  const now = o.now ?? new Date()
  const settings: Record<string, string> = {}
  for (const r of all(db, 'SELECT key, value FROM settings ORDER BY key'))
    if (!isPrivateSetting(String(r.key))) settings[String(r.key)] = String(r.value)
  const out: Record<string, unknown> = {
    app: 'Dayfold',
    schemaVersion: o.schemaVersion,
    exportedAt: now.toISOString(),
    includesActivity: o.includeActivity,
    dump: all(db, 'SELECT id, text, created_at, triaged FROM dump ORDER BY id'),
    projects: all(db, 'SELECT * FROM projects ORDER BY id'),
    tasks: all(db, 'SELECT * FROM tasks ORDER BY id'),
    wrapups: all(db, 'SELECT * FROM wrapups ORDER BY date'),
    commandLog: all(
      db,
      'SELECT id, ts, source, input, command, undone FROM command_log ORDER BY id'
    ).map(({ command, ...r }) => ({ ...r, type: commandType(command) })),
    settings
  }
  if (o.includeActivity && withActivityRows)
    out.activity = all(db, 'SELECT * FROM activity ORDER BY id')
  return out
}

const line = (s: unknown): string =>
  String(s ?? '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
const check = (status: unknown): string =>
  status === 'done' ? '[x]' : status === 'dropped' ? '[-]' : '[ ]'
const day = (ms: unknown): string => toISO(new Date(Number(ms)))

export function exportMarkdown(db: DatabaseSync, o: ExportOptions): string {
  const now = o.now ?? new Date()
  const state = buildState(db, now)
  const md: string[] = [
    '# Dayfold export',
    '',
    `Exported ${now.toISOString()} (schema v${o.schemaVersion}).`,
    ''
  ]

  md.push(`## Today's plate (${state.today})`, '')
  if (state.plate.length === 0) md.push('Nothing planned.')
  for (const t of state.plate)
    md.push(
      `- ${check(t.status)} ${line(t.title)}${t.project_name ? ` (${line(t.project_name)})` : ''}` +
        `${t.due ? ` due ${t.due}` : ''}`
    )

  md.push('', '## Inbox', '')
  if (state.dump.length === 0) md.push('Empty.')
  for (const d of state.dump) md.push(`- ${line(d.text)}`)

  md.push('', '## Projects', '')
  const tasks = all(db, 'SELECT title, project_id, status, due, plan_date FROM tasks ORDER BY id')
  for (const p of all(db, 'SELECT * FROM projects ORDER BY id')) {
    md.push(`### ${line(p.name)} (${p.status})`, '')
    if (p.goal) md.push(`Goal: ${line(p.goal)}`, '')
    if (p.due) md.push(`Due: ${p.due}`, '')
    if (p.next_action) md.push(`Next action: ${line(p.next_action)}`, '')
    for (const t of tasks.filter((x) => x.project_id === p.id))
      md.push(`- ${check(t.status)} ${line(t.title)}${t.due ? ` due ${t.due}` : ''}`)
    if (p.notes) md.push('', 'Notes:', '', String(p.notes).trim().replace(/^/gm, '> '))
    md.push('')
  }
  const loose = tasks.filter(
    (t) => t.project_id === null && ['todo', 'doing'].includes(String(t.status))
  )
  if (loose.length) {
    md.push('### No project', '')
    for (const t of loose) md.push(`- ${check(t.status)} ${line(t.title)}`)
    md.push('')
  }

  const since = startOfLocalDayMs(new Date(`${addDays(state.today, -30)}T12:00:00`))
  md.push('## Completed in the last 30 days', '')
  const done = all(
    db,
    `SELECT t.title, t.done_at, p.name AS project FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.status = 'done' AND t.done_at >= ? ORDER BY t.done_at DESC`,
    since
  )
  if (done.length === 0) md.push('Nothing completed.')
  for (const t of done)
    md.push(`- ${day(t.done_at)} ${line(t.title)}${t.project ? ` (${line(t.project)})` : ''}`)

  md.push('', '## Wrap-ups (last 30 days)', '')
  const wraps = all(
    db,
    'SELECT date, completed, carried, dropped, deferred, note FROM wrapups WHERE date >= ? ORDER BY date DESC',
    addDays(state.today, -30)
  )
  if (wraps.length === 0) md.push('None yet.')
  for (const w of wraps)
    md.push(
      `- ${w.date}: ${w.completed} done, ${w.carried} carried, ${w.deferred} deferred, ${w.dropped} dropped${w.note ? `. ${line(w.note)}` : ''}`
    )

  if (o.includeActivity) {
    md.push('', '## Activity (time by app)', '')
    const rows = all(
      db,
      `SELECT app, SUM(COALESCE(ended_ts, ts) - ts) / 1000 AS seconds FROM activity
       WHERE idle = 0 GROUP BY app ORDER BY seconds DESC`
    )
    if (rows.length === 0) md.push('No activity recorded.')
    for (const r of rows) md.push(`- ${line(r.app)}: ${Math.round(Number(r.seconds) / 60)} min`)
  }
  md.push('')
  return md.join('\n')
}

export function renderExport(db: DatabaseSync, format: ExportFormat, o: ExportOptions): string {
  return format === 'json'
    ? JSON.stringify(exportJson(db, o), null, 2) + '\n'
    : exportMarkdown(db, o)
}

/** Writes atomically with owner-only permissions. */
export function writeExportFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  try {
    writeFileSync(tmp, text, { mode: 0o600 })
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

const FLUSH_BYTES = 1 << 20

/**
 * Same bytes as `writeExportFile(path, renderExport(...))`, but the activity table (the only part
 * that can reach hundreds of thousands of rows) is read row by row and written in 1 MB pieces, so
 * memory stays flat however much history there is. Atomic, owner-only, like writeExportFile.
 */
export function writeExport(
  db: DatabaseSync,
  format: ExportFormat,
  o: ExportOptions,
  path: string
): void {
  if (format !== 'json' || !o.includeActivity)
    return writeExportFile(path, renderExport(db, format, o))
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  let fd: number | null = null
  try {
    fd = openSync(tmp, 'w', 0o600)
    // `activity` is the last key, so the body so far is the object minus its closing brace.
    const head = JSON.stringify(exportJson(db, o, false), null, 2)
    writeSync(fd, head.slice(0, -2) + ',\n  "activity": [')
    let buf = ''
    let n = 0
    for (const row of db.prepare('SELECT * FROM activity ORDER BY id').iterate()) {
      buf += (n++ ? ',\n    ' : '\n    ') + JSON.stringify(row, null, 2).replace(/\n/g, '\n    ')
      if (buf.length >= FLUSH_BYTES) {
        writeSync(fd, buf)
        buf = ''
      }
    }
    writeSync(fd, buf + (n ? '\n  ]\n}\n' : ']\n}\n'))
    closeSync(fd)
    fd = null
    renameSync(tmp, path)
  } catch (e) {
    if (fd !== null) closeSync(fd)
    rmSync(tmp, { force: true })
    throw e
  }
}
