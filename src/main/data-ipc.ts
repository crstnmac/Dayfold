import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { ExportFormat, ExportResult } from '../shared/types'
import {
  type BackupManager,
  deleteAllData,
  listBackups,
  resolveBackup,
  restoreBackup
} from './backup'
import { writeExport } from './export'
import { schemaVersion } from './db'
import { toISO } from './dates'

interface Deps {
  getDb: () => DatabaseSync
  backups: BackupManager
  dbPath: string
  getWindow: () => BrowserWindow | null
  onChanged: () => void
  /** Stop anything writing to the database (called just before a restore swaps the file). */
  pause: () => void
  resume: () => void
}

/** IPC for backup, export, restore and delete-all. Every argument is validated here. */
export function registerDataIpc(d: Deps): void {
  ipcMain.handle('data:backupStatus', () => d.backups.status())
  ipcMain.handle('data:backupNow', () => d.backups.backupNow())
  ipcMain.handle('data:listBackups', () => listBackups(d.backups.dir))
  ipcMain.handle('data:revealBackups', () => {
    const newest = listBackups(d.backups.dir)[0]
    if (newest) shell.showItemInFolder(resolveBackup(d.backups.dir, newest.name))
    else void shell.openPath(d.backups.dir)
  })

  ipcMain.handle(
    'data:export',
    async (_e, format: unknown, includeActivity: unknown): Promise<ExportResult> => {
      if (format !== 'json' && format !== 'markdown') return { ok: false, message: 'Bad format' }
      const fmt: ExportFormat = format
      const ext = fmt === 'json' ? 'json' : 'md'
      try {
        const opts = {
          title: 'Export Dayfold data',
          defaultPath: join(app.getPath('documents'), `dash-export-${toISO(new Date())}.${ext}`),
          filters: [{ name: fmt === 'json' ? 'JSON' : 'Markdown', extensions: [ext] }]
        }
        const win = d.getWindow()
        const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
        if (r.canceled || !r.filePath) return { ok: false, canceled: true }
        writeExport(
          d.getDb(),
          fmt,
          { includeActivity: includeActivity === true, schemaVersion: schemaVersion() },
          r.filePath
        )
        return { ok: true, path: r.filePath }
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    }
  )

  ipcMain.handle('data:restore', (_e, name: unknown) => {
    try {
      d.pause()
      restoreBackup(d.getDb(), d.dbPath, d.backups.dir, name, schemaVersion())
    } catch (e) {
      d.resume()
      return { ok: false, message: (e as Error).message }
    }
    d.backups.stop()
    app.relaunch()
    app.exit(0)
    return { ok: true, message: 'Restored. Restarting…' }
  })

  ipcMain.handle('data:deleteAll', (_e, confirm: unknown) => {
    try {
      deleteAllData(d.getDb(), d.backups.dir, confirm)
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
    d.onChanged()
    return { ok: true, message: 'All data deleted' }
  })
}
