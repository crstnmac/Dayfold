import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, schemaVersion } from '../src/main/db'
import {
  exportJson,
  exportMarkdown,
  renderExport,
  writeExport,
  writeExportFile
} from '../src/main/export'

const NOW = new Date(2026, 9, 10, 12)
let db: DatabaseSync
beforeEach(() => {
  db = openDb(':memory:')
  const t = NOW.getTime()
  db.prepare("INSERT INTO dump (text, created_at) VALUES ('call plumber', ?)").run(t)
  db.prepare(
    "INSERT INTO projects (name, goal, created_at, touched_at) VALUES ('Home', 'Fix it', ?, ?)"
  ).run(t, t)
  db.prepare(
    "INSERT INTO tasks (title, project_id, plan_date, created_at) VALUES ('Paint', 1, '2026-10-10', ?)"
  ).run(t)
  db.prepare(
    "INSERT INTO tasks (title, project_id, status, created_at, done_at) VALUES ('Old win', 1, 'done', ?, ?)"
  ).run(t, t - 2 * 86400000)
  db.prepare(
    "INSERT INTO tasks (title, status, created_at, done_at) VALUES ('Ancient', 'done', ?, ?)"
  ).run(t, t - 60 * 86400000)
  db.prepare(
    "INSERT INTO command_log (ts, source, input, command, inverse) VALUES (?, 'typed', 'add', '{\"type\":\"task.add\"}', '{}')"
  ).run(t)
  db.prepare(
    "INSERT INTO activity (ts, ended_ts, app, bundle_id, title) VALUES (?, ?, 'Xcode', 'x', 'SECRET-WINDOW')"
  ).run(t, t + 600000)
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (\'llm.config\', \'{"provider":"claude"}\')'
  ).run()
  db.prepare("INSERT INTO settings (key, value) VALUES ('api.key', 'sk-123')").run()
  db.prepare("INSERT INTO settings (key, value) VALUES ('activity.enabled', '1')").run()
  db.prepare(
    "INSERT INTO wrapups (date, completed, carried, dropped, deferred, note, created_at) VALUES ('2026-10-09', 3, 1, 0, 0, 'remember the milk', ?)"
  ).run(t)
})

describe('wrap-up history in exports', () => {
  it('is included in JSON and Markdown', () => {
    const json = exportJson(db, { includeActivity: false, schemaVersion: 1, now: NOW })
    const wraps = json.wrapups as { note: string }[]
    expect(wraps).toHaveLength(1)
    expect(wraps[0].note).toBe('remember the milk')
    expect(exportMarkdown(db, { includeActivity: false, schemaVersion: 1, now: NOW })).toContain(
      '2026-10-09: 3 done, 1 carried'
    )
  })
})

describe('JSON export', () => {
  it('has the full shape and excludes activity by default', () => {
    const j = exportJson(db, { includeActivity: false, schemaVersion: schemaVersion(), now: NOW })
    expect(j).toMatchObject({
      app: 'Dayfold',
      schemaVersion: schemaVersion(),
      exportedAt: NOW.toISOString()
    })
    expect((j.dump as unknown[]).length).toBe(1)
    expect((j.projects as unknown[]).length).toBe(1)
    expect((j.tasks as unknown[]).length).toBe(3)
    expect(j.commandLog).toEqual([expect.objectContaining({ input: 'add', type: 'task.add' })])
    expect(j).not.toHaveProperty('activity')
    expect(JSON.stringify(j)).not.toContain('SECRET-WINDOW')
    expect(j.includesActivity).toBe(false)
  })

  it('excludes llm config and secret-like settings', () => {
    const s = exportJson(db, { includeActivity: false, schemaVersion: 1 }).settings as Record<
      string,
      string
    >
    expect(Object.keys(s)).toEqual(['activity.enabled'])
  })

  it('includes activity only when asked', () => {
    const j = exportJson(db, { includeActivity: true, schemaVersion: 1 })
    expect(j.activity).toHaveLength(1)
    expect(
      JSON.parse(renderExport(db, 'json', { includeActivity: true, schemaVersion: 1 })).activity
    ).toHaveLength(1)
  })
})

describe('Markdown export', () => {
  it('is human readable and respects the activity flag', () => {
    const md = exportMarkdown(db, { includeActivity: false, schemaVersion: 1, now: NOW })
    expect(md).toContain("## Today's plate (2026-10-10)")
    expect(md).toContain('- [ ] Paint (Home)')
    expect(md).toContain('- call plumber')
    expect(md).toContain('### Home (active)')
    expect(md).toContain('- 2026-10-08 Old win (Home)')
    expect(md).not.toContain('Ancient')
    expect(md).not.toContain('Xcode')
    const withAct = exportMarkdown(db, { includeActivity: true, schemaVersion: 1, now: NOW })
    expect(withAct).toContain('- Xcode: 10 min')
    expect(withAct).not.toContain('SECRET-WINDOW')
  })
})

describe('writeExportFile', () => {
  it('writes atomically with mode 0600', () => {
    const d = mkdtempSync(join(tmpdir(), 'dash-export-'))
    const p = join(d, 'out.json')
    writeExportFile(p, 'hi')
    expect(readFileSync(p, 'utf8')).toBe('hi')
    expect(statSync(p).mode & 0o777).toBe(0o600)
    rmSync(d, { recursive: true })
  })
})

describe('writeExport (streaming)', () => {
  it.each([0, 1, 3])('writes exactly what renderExport would, with %i activity rows', (n) => {
    const db = openDb(':memory:')
    for (let i = 0; i < n; i++)
      db.prepare(
        "INSERT INTO activity (ts, ended_ts, app, bundle_id, title) VALUES (?, ?, 'A\"x', 'b', '')"
      ).run(1000 + i, 2000 + i)
    const o = { includeActivity: true, schemaVersion: 1, now: new Date('2026-05-10T10:00:00Z') }
    const dir = mkdtempSync(join(tmpdir(), 'dash-exp-'))
    const p = join(dir, 'out.json')
    writeExport(db, 'json', o, p)
    expect(readFileSync(p, 'utf8')).toBe(renderExport(db, 'json', o))
  })
})
