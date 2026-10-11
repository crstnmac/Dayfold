import { DatabaseSync } from 'node:sqlite'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { BackupInfo, BackupKind, BackupStatus } from '../shared/types'
import { toISO } from './dates'

export const KEEP_DAILY = 14
export const KEEP_PRE_MIGRATION = 5
export const KEEP_PRE_RESTORE = 5

const STAMP = '\\d{8}T\\d{6}'
const KINDS: { kind: BackupKind; re: RegExp; keep: number }[] = [
  { kind: 'daily', re: /^dash-(\d{4}-\d{2}-\d{2})\.sqlite$/, keep: KEEP_DAILY },
  {
    kind: 'pre-migration',
    re: new RegExp(`^pre-migration-v\\d{1,4}-to-v\\d{1,4}-(${STAMP})\\.sqlite$`),
    keep: KEEP_PRE_MIGRATION
  },
  {
    kind: 'pre-restore',
    re: new RegExp(`^pre-restore-(${STAMP})\\.sqlite$`),
    keep: KEEP_PRE_RESTORE
  }
]

/** Sortable key embedded in the file name (date or timestamp), or null if the name is not ours. */
function classify(name: string): { kind: BackupKind; key: string; keep: number } | null {
  for (const k of KINDS) {
    const m = k.re.exec(name)
    if (m) return { kind: k.kind, key: m[1], keep: k.keep }
  }
  return null
}

export const isBackupName = (name: unknown): name is string =>
  typeof name === 'string' && name.length <= 100 && classify(name) !== null

const pad = (n: number): string => String(n).padStart(2, '0')
const stamp = (d: Date): string =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`

export const dailyName = (now: Date): string => `dash-${toISO(now)}.sqlite`
export const preMigrationName = (from: number, to: number, now: Date): string =>
  `pre-migration-v${from}-to-v${to}-${stamp(now)}.sqlite`
export const preRestoreName = (now: Date): string => `pre-restore-${stamp(now)}.sqlite`

/** Consistent snapshot of an open database (safe with WAL) written atomically with mode 0600. */
export function snapshot(db: DatabaseSync, dest: string): void {
  mkdirSync(resolve(dest, '..'), { recursive: true, mode: 0o700 })
  const tmp = `${dest}.tmp`
  rmSync(tmp, { force: true })
  db.prepare('VACUUM INTO ?').run(tmp)
  chmodSync(tmp, 0o600)
  renameSync(tmp, dest)
}

export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return []
  const out: BackupInfo[] = []
  for (const name of readdirSync(dir)) {
    const c = classify(name)
    if (!c) continue
    try {
      const st = lstatSync(join(dir, name))
      if (st.isFile()) out.push({ name, kind: c.kind, size: st.size, modified: st.mtimeMs })
    } catch {
      /* vanished while listing */
    }
  }
  const order = (b: BackupInfo): string => `${b.kind}|${classify(b.name)!.key}`
  return out.sort((a, b) => (order(a) < order(b) ? 1 : -1))
}

/** Keeps the newest `keep` backups of each kind and deletes the rest. Returns deleted names. */
export function pruneBackups(dir: string): string[] {
  const removed: string[] = []
  const seen: Record<string, number> = {}
  for (const b of listBackups(dir)) {
    const c = classify(b.name)!
    seen[c.kind] = (seen[c.kind] ?? 0) + 1
    if (seen[c.kind] > c.keep) {
      rmSync(join(dir, b.name), { force: true })
      removed.push(b.name)
    }
  }
  return removed
}

/** Writes today's backup unless it already exists. Returns the name written, or null if skipped. */
export function backupDaily(db: DatabaseSync, dir: string, now = new Date()): string | null {
  const name = dailyName(now)
  let created: string | null = null
  if (!existsSync(join(dir, name))) {
    snapshot(db, join(dir, name))
    created = name
  }
  pruneBackups(dir)
  return created
}

/**
 * Snapshot taken just before pending migrations run on an existing database. Never throws: a
 * failed backup must not stop the app from starting.
 */
export function preMigrationBackup(
  db: DatabaseSync,
  dir: string,
  from: number,
  to: number,
  now = new Date()
): string | null {
  try {
    const name = preMigrationName(from, to, now)
    snapshot(db, join(dir, name))
    pruneBackups(dir)
    return name
  } catch (e) {
    console.error('pre-migration backup failed', e)
    return null
  }
}

/** Resolves a user-chosen backup name to a real file inside `dir`, or throws. */
export function resolveBackup(dir: string, name: unknown): string {
  if (!isBackupName(name)) throw new Error('Invalid backup name')
  const root = resolve(dir)
  const full = resolve(root, name)
  if (!full.startsWith(root + sep) || resolve(full, '..') !== root)
    throw new Error('Invalid backup name')
  const st = lstatSync(full, { throwIfNoEntry: false })
  if (!st || !st.isFile()) throw new Error('Backup not found')
  return full
}

/** Throws unless the file is a healthy SQLite database this build understands. */
export function verifyBackup(file: string, maxVersion: number): void {
  const b = new DatabaseSync(file, { readOnly: true })
  try {
    const check = b.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    if (check.integrity_check !== 'ok') throw new Error('Backup failed its integrity check')
    const v = (b.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (v > maxVersion) throw new Error('Backup was made by a newer version of Dayfold')
    if (v < 1) throw new Error('Backup is not a Dayfold database')
  } finally {
    b.close()
  }
}

/**
 * Replaces the live database file with a backup. Takes a safety copy of the current database
 * first, then closes it. The caller must relaunch the app afterwards.
 */
export function restoreBackup(
  db: DatabaseSync,
  dbPath: string,
  dir: string,
  name: unknown,
  maxVersion: number,
  now = new Date()
): { safetyCopy: string } {
  const src = resolveBackup(dir, name)
  verifyBackup(src, maxVersion)
  const safetyCopy = preRestoreName(now)
  snapshot(db, join(dir, safetyCopy))
  db.close()
  for (const f of [`${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true })
  const tmp = `${dbPath}.restore`
  copyFileSync(src, tmp)
  chmodSync(tmp, 0o600)
  renameSync(tmp, dbPath)
  pruneBackups(dir)
  return { safetyCopy }
}

const TABLES = [
  'command_log',
  'tasks',
  'dump',
  'activity',
  'activity_context',
  'projects',
  'wrapups'
]

/**
 * Irreversibly wipes all user content (not preferences) and every backup, which would otherwise
 * keep the data. secure_delete is on, so freed pages are zeroed before VACUUM shrinks the file.
 */
export function deleteAllData(db: DatabaseSync, dir: string, confirm: unknown): void {
  if (confirm !== 'DELETE') throw new Error('Type DELETE to confirm')
  db.exec('PRAGMA secure_delete = ON; BEGIN')
  try {
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`)
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${TABLES.map((t) => `'${t}'`).join(',')})`)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)')
  for (const b of listBackups(dir)) rmSync(join(dir, b.name), { force: true })
}

/** Runs the daily backup on startup and at each local midnight, and remembers the outcome. */
export class BackupManager {
  private lastError: string | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private getDb: () => DatabaseSync,
    readonly dir: string
  ) {}

  start(): void {
    this.runNow()
    this.schedule()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    const n = new Date()
    const ms = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime()
    this.timer = setTimeout(() => {
      this.runNow()
      this.schedule()
    }, ms + 1000)
    this.timer.unref()
  }

  /** Back up today if not yet done. Never throws. */
  runNow(): BackupStatus {
    try {
      backupDaily(this.getDb(), this.dir)
      this.lastError = null
    } catch (e) {
      this.lastError = (e as Error).message
      console.error('daily backup failed', e)
    }
    return this.status()
  }

  /** Forces a fresh snapshot of today's backup (overwrites the existing one). */
  backupNow(now = new Date()): BackupStatus {
    try {
      snapshot(this.getDb(), join(this.dir, dailyName(now)))
      pruneBackups(this.dir)
      this.lastError = null
    } catch (e) {
      this.lastError = (e as Error).message
    }
    return this.status()
  }

  status(): BackupStatus {
    const all = listBackups(this.dir)
    const daily = all.find((b) => b.kind === 'daily')
    let last: number | null = null
    if (daily) last = statSync(join(this.dir, daily.name)).mtimeMs
    return { dir: this.dir, last, count: all.length, lastError: this.lastError }
  }
}
