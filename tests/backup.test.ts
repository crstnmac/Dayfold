import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, schemaVersion } from '../src/main/db'
import {
  BackupManager,
  backupDaily,
  dailyName,
  deleteAllData,
  isBackupName,
  listBackups,
  preMigrationBackup,
  pruneBackups,
  resolveBackup,
  restoreBackup
} from '../src/main/backup'

let root: string
let dbPath: string
let dir: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dash-backup-'))
  dbPath = join(root, 'dash.sqlite')
  dir = join(root, 'backups')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const addProject = (db: DatabaseSync, name: string): void => {
  db.prepare('INSERT INTO projects (name, created_at, touched_at) VALUES (?, 1, 1)').run(name)
}
const names = (db: DatabaseSync): string[] =>
  (db.prepare('SELECT name FROM projects ORDER BY id').all() as { name: string }[]).map(
    (r) => r.name
  )

describe('daily backup', () => {
  it('writes dash-YYYY-MM-DD.sqlite with mode 0600 including activity rows', () => {
    const db = openDb(dbPath)
    db.prepare("INSERT INTO activity (ts, app, bundle_id, title) VALUES (1, 'A', 'b', 't')").run()
    const now = new Date(2026, 9, 10, 12)
    expect(backupDaily(db, dir, now)).toBe('dash-2026-10-10.sqlite')
    const file = join(dir, 'dash-2026-10-10.sqlite')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const copy = new DatabaseSync(file, { readOnly: true })
    expect((copy.prepare('SELECT COUNT(*) AS n FROM activity').get() as { n: number }).n).toBe(1)
    copy.close()
    expect(backupDaily(db, dir, now)).toBeNull()
    expect(readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false)
  })

  it('keeps the 14 most recent daily backups', () => {
    const db = openDb(dbPath)
    for (let d = 1; d <= 20; d++) backupDaily(db, dir, new Date(2026, 8, d, 12))
    const daily = listBackups(dir).filter((b) => b.kind === 'daily')
    expect(daily).toHaveLength(14)
    expect(daily[0].name).toBe('dash-2026-09-20.sqlite')
    expect(daily[13].name).toBe('dash-2026-09-07.sqlite')
    expect(existsSync(join(dir, 'dash-2026-09-06.sqlite'))).toBe(false)
  })

  it('prune ignores files that are not ours', () => {
    const db = openDb(dbPath)
    backupDaily(db, dir, new Date(2026, 8, 1, 12))
    db.prepare('VACUUM INTO ?').run(join(dir, 'notes.sqlite'))
    pruneBackups(dir)
    expect(existsSync(join(dir, 'notes.sqlite'))).toBe(true)
    expect(listBackups(dir)).toHaveLength(1)
  })

  it('BackupManager reports status and never throws on failure', () => {
    const db = openDb(dbPath)
    const m = new BackupManager(() => db, dir)
    expect(m.status()).toMatchObject({ dir, last: null, count: 0, lastError: null })
    m.runNow()
    expect(m.status().count).toBe(1)
    expect(m.status().last).toBeGreaterThan(0)
    db.close()
    expect(() => m.backupNow()).not.toThrow()
    expect(m.status().lastError).toBeTruthy()
    expect(dailyName(new Date(2026, 0, 5))).toBe('dash-2026-01-05.sqlite')
  })
})

describe('pre-migration backup', () => {
  it('is not made for :memory: or brand new databases', () => {
    openDb(':memory:')
    openDb(dbPath).close()
    expect(existsSync(dir)).toBe(false)
  })

  it('is made when an existing database has pending migrations', () => {
    const old = new DatabaseSync(dbPath)
    old.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    old.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT)')
    old.exec('PRAGMA user_version = 1')
    old.close()
    // openDb will fail running migration 2 on this stub schema, but the backup must exist first.
    expect(() => openDb(dbPath)).toThrow()
    const found = listBackups(dir).filter((b) => b.kind === 'pre-migration')
    expect(found).toHaveLength(1)
    expect(found[0].name).toMatch(
      new RegExp(`^pre-migration-v1-to-v${schemaVersion()}-\\d{8}T\\d{6}\\.sqlite$`)
    )
    expect(statSync(join(dir, found[0].name)).mode & 0o777).toBe(0o600)
  })

  it('is not made when already up to date, and keeps only the last 5', () => {
    const db = openDb(dbPath)
    expect(existsSync(dir)).toBe(false)
    for (let i = 0; i < 8; i++)
      preMigrationBackup(db, dir, 1, 2, new Date(Date.UTC(2026, 0, 1, 0, 0, i)))
    const pre = listBackups(dir)
    expect(pre).toHaveLength(5)
    expect(pre[0].name).toContain('20260101T000007')
  })
})

describe('restore', () => {
  it('rejects path traversal and malformed names', () => {
    const db = openDb(dbPath)
    backupDaily(db, dir, new Date(2026, 9, 10, 12))
    const bad = [
      '../dash.sqlite',
      '..\\dash.sqlite',
      '../backups/dash-2026-10-10.sqlite',
      '/etc/passwd',
      dbPath,
      'dash-2026-10-10.sqlite/../../dash.sqlite',
      'dash-2026-10-10.sqlite\0.png',
      'dash-2026-10-10.sqlite-wal',
      'dash.sqlite',
      '',
      42,
      null,
      { name: 'x' }
    ]
    for (const name of bad) {
      expect(isBackupName(name)).toBe(false)
      expect(() => resolveBackup(dir, name)).toThrow()
      expect(() => restoreBackup(db, dbPath, dir, name, schemaVersion())).toThrow()
    }
    expect(names(db)).toEqual([])
    expect(() => resolveBackup(dir, 'dash-2026-01-01.sqlite')).toThrow('not found')
  })

  it('refuses symlinked backups', () => {
    const db = openDb(dbPath)
    backupDaily(db, dir, new Date(2026, 9, 10, 12))
    symlinkSync(dbPath, join(dir, 'dash-2026-01-01.sqlite'))
    expect(() => resolveBackup(dir, 'dash-2026-01-01.sqlite')).toThrow()
  })

  it('takes a safety copy, swaps the file and the restored data opens', () => {
    const db = openDb(dbPath)
    addProject(db, 'before')
    backupDaily(db, dir, new Date(2026, 9, 10, 12))
    addProject(db, 'after')
    const { safetyCopy } = restoreBackup(db, dbPath, dir, 'dash-2026-10-10.sqlite', schemaVersion())
    expect(safetyCopy).toMatch(/^pre-restore-\d{8}T\d{6}\.sqlite$/)
    const safety = new DatabaseSync(join(dir, safetyCopy), { readOnly: true })
    expect((safety.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n).toBe(2)
    safety.close()
    const reopened = openDb(dbPath)
    expect(names(reopened)).toEqual(['before'])
    expect(statSync(dbPath).mode & 0o777).toBe(0o600)
    expect(existsSync(`${dbPath}-wal`) && statSync(`${dbPath}-wal`).size > 0).toBe(false)
  })

  it('rejects corrupt, non-Dayfold and too-new backups without touching the live db', () => {
    const db = openDb(dbPath)
    addProject(db, 'keep')
    const stub = new DatabaseSync(join(root, 'x.sqlite'))
    stub.exec('CREATE TABLE t (a)')
    stub.close()
    mkdirSync(dir, { recursive: true })
    copyFileSync(join(root, 'x.sqlite'), join(dir, 'dash-2026-01-01.sqlite'))
    writeFileSync(join(dir, 'dash-2026-01-02.sqlite'), 'not a database at all')
    expect(() => restoreBackup(db, dbPath, dir, 'dash-2026-01-01.sqlite', schemaVersion())).toThrow(
      /not a Dayfold/
    )
    expect(() =>
      restoreBackup(db, dbPath, dir, 'dash-2026-01-02.sqlite', schemaVersion())
    ).toThrow()
    backupDaily(db, dir, new Date(2026, 9, 10, 12))
    expect(() => restoreBackup(db, dbPath, dir, 'dash-2026-10-10.sqlite', 0)).toThrow(/newer/)
    expect(names(db)).toEqual(['keep'])
  })
})

describe('delete all data', () => {
  it('requires the exact confirmation word', () => {
    const db = openDb(':memory:')
    addProject(db, 'p')
    for (const c of ['delete', 'DELETE ', '', undefined, 1])
      expect(() => deleteAllData(db, dir, c)).toThrow()
    expect(names(db)).toEqual(['p'])
  })

  it('wipes content tables, activity, command log and backups but keeps preferences', () => {
    const db = openDb(dbPath)
    addProject(db, 'p')
    db.prepare("INSERT INTO dump (text, created_at) VALUES ('secret', 1)").run()
    db.prepare("INSERT INTO tasks (title, created_at) VALUES ('t', 1)").run()
    db.prepare(
      "INSERT INTO command_log (ts, source, input, command, inverse) VALUES (1,'ui','i','{}','{}')"
    ).run()
    db.prepare(
      "INSERT INTO activity (ts, app, bundle_id, title) VALUES (1, 'A', 'b', 'topsecrettitle')"
    ).run()
    db.prepare("INSERT INTO settings (key, value) VALUES ('activity.enabled', '1')").run()
    db.prepare(
      "INSERT INTO wrapups (date, completed, carried, dropped, deferred, note, created_at) VALUES ('2026-10-09', 1, 0, 0, 0, 'privatewrapnote', 1)"
    ).run()
    backupDaily(db, dir, new Date(2026, 9, 10, 12))
    deleteAllData(db, dir, 'DELETE')
    for (const t of ['dump', 'projects', 'tasks', 'command_log', 'activity', 'wrapups'])
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n).toBe(0)
    expect((db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number }).n).toBe(1)
    expect(listBackups(dir)).toHaveLength(0)
    db.close()
    const raw = readFileSync(dbPath)
    expect(raw.includes('topsecrettitle')).toBe(false)
    expect(raw.includes('privatewrapnote')).toBe(false)
  })
})
