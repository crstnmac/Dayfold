import { DatabaseSync } from 'node:sqlite'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { preMigrationBackup } from './backup'

const MIGRATIONS: string[] = [
  `
  CREATE TABLE dump (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    triaged INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    next_action TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    touched_at INTEGER NOT NULL
  );
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    project_id INTEGER REFERENCES projects(id),
    status TEXT NOT NULL DEFAULT 'todo',
    due TEXT,
    plan_date TEXT,
    carry_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    done_at INTEGER
  );
  CREATE TABLE command_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    source TEXT NOT NULL,
    input TEXT NOT NULL,
    command TEXT NOT NULL,
    inverse TEXT NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    ended_ts INTEGER,
    app TEXT NOT NULL,
    bundle_id TEXT NOT NULL,
    title TEXT NOT NULL,
    idle INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX activity_ts ON activity(ts);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  `
  ALTER TABLE projects ADD COLUMN due TEXT;
  ALTER TABLE activity ADD COLUMN service TEXT NOT NULL DEFAULT '';
  ALTER TABLE activity ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
  ALTER TABLE activity ADD COLUMN kind TEXT NOT NULL DEFAULT '';
  ALTER TABLE activity ADD COLUMN detail TEXT NOT NULL DEFAULT '';
  ALTER TABLE activity ADD COLUMN url TEXT NOT NULL DEFAULT '';
  `,
  `
  CREATE TABLE IF NOT EXISTS wrapups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    completed INTEGER NOT NULL DEFAULT 0,
    carried INTEGER NOT NULL DEFAULT 0,
    dropped INTEGER NOT NULL DEFAULT 0,
    deferred INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS activity_context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    bundle_id TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_context_ts ON activity_context(ts);
  `,
  `
  ALTER TABLE wrapups ADD COLUMN details TEXT NOT NULL DEFAULT '';
  `
]

/** Number of migrations this build knows; a database newer than this cannot be opened safely. */
export const schemaVersion = (): number => MIGRATIONS.length

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;')
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  // Existing file databases get a snapshot before any pending migration touches them.
  if (path !== ':memory:' && version > 0 && version < MIGRATIONS.length)
    preMigrationBackup(db, join(dirname(path), 'backups'), version, MIGRATIONS.length)
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (path !== ':memory:') {
    for (const f of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(f)) chmodSync(f, 0o600)
    }
  }
  return db
}
