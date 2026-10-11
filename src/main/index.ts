import { app, shell, BrowserWindow, ipcMain, nativeImage, nativeTheme } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { openDb } from './db'
import { DEMO_DB, REAL_DB, isDemoMode, removeDemoDb, seedDemo, setDemoFlag } from './demo'
import { BackupManager } from './backup'
import { registerDataIpc } from './data-ipc'
import { dispatch, undo, undoLabel } from './commands'
import { parse, UNMATCHED, type Parsed } from './parser'
import {
  getConfig,
  getStatus,
  interpretWithConfigured,
  reviewActivityDay,
  setConfig,
  testConnection,
  triageDump
} from './llm/service'
import { buildState } from './state'
import { parseDate } from './dates'
import { ActivityTracker } from './activity'
import { AppCatalog, defaultDirs, defaultExec, defaultReadDir } from './app-catalog'
import { attachMainWindow, initShell, showMainWindow } from './shell'
import type { ActivityAddTaskResult, Command, DayReviewResult, InputResult } from '../shared/types'

// Lets tests run against an isolated data folder.
if (process.env['DASH_USER_DATA']) app.setPath('userData', process.env['DASH_USER_DATA'])

let win: BrowserWindow | null = null
let db: DatabaseSync
let tracker: ActivityTracker

/** Set while the window is hidden: what the renderer missed, sent once when it is shown again. */
let missed: 'activity' | 'all' | null = null

/** `scope` 'activity' tells the renderer that tasks and projects are untouched, so it can skip them. */
function notifyChanged(scope?: 'activity'): void {
  if (!win || win.isDestroyed()) return
  // A hidden or minimized window has nobody to look at it: skip the query and re-render work now
  // and catch up in one go when it comes back.
  if (!win.isVisible() || win.isMinimized()) {
    missed = scope === 'activity' && missed !== 'all' ? 'activity' : 'all'
    return
  }
  win.webContents.send('dash:changed', scope)
}

function flushMissed(): void {
  const scope = missed
  missed = null
  if (scope && win && !win.isDestroyed())
    win.webContents.send('dash:changed', scope === 'all' ? undefined : scope)
}

function run(command: Command, source: string, input: string): InputResult {
  try {
    return { ok: true, message: dispatch(db, command, { source, input }), undoable: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message, undoable: false }
  }
}

async function submit(text: string, source: string): Promise<InputResult> {
  let parsed: Parsed
  try {
    parsed = parse(db, text)
  } catch (e) {
    return { ok: false, message: (e as Error).message, undoable: false }
  }
  switch (parsed.kind) {
    case 'undo':
      return doUndo()
    case 'focus':
      return { ok: true, message: '', undoable: false, focus: parsed.focus }
    case 'answer':
      return { ok: true, message: parsed.message, undoable: false }
    case 'choose':
      return { ok: true, message: parsed.question, undoable: false, choices: parsed.choices }
    case 'commands': {
      if (parsed.commands.length === 0)
        return { ok: false, message: 'Nothing to do', undoable: false }
      if (parsed.note === UNMATCHED && getConfig(db).provider) return viaLlm(text, source, parsed)
      return runAll(parsed.commands, source, text)
    }
  }
}

function runAll(commands: Command[], source: string, text: string): InputResult {
  let last: InputResult = { ok: true, message: '', undoable: false }
  for (const c of commands) {
    last = run(c, source, text)
    if (!last.ok) break
  }
  return last
}

/**
 * Rules found no match. Ask the configured LLM to propose commands (ADR-0003); on any failure,
 * fall back to the Inbox so the user's words are never lost.
 */
async function viaLlm(
  text: string,
  source: string,
  rulesResult: Extract<Parsed, { kind: 'commands' }>
): Promise<InputResult> {
  const keep = (why: string): InputResult => {
    const r = runAll(rulesResult.commands, source, text)
    return r.ok ? { ...r, message: `${why} Saved to your Inbox (bottom of Today) instead.` } : r
  }
  try {
    const out = await interpretWithConfigured(db, text)
    if (!out) return runAll(rulesResult.commands, source, text)
    const { provider, result } = out
    if (result.kind === 'clarify')
      return keep(`${provider.label} needs more detail: ${result.question}`)
    // Each command is its own undo step, so Undo reverts the most recent change first.
    const r = runAll(result.commands, `llm:${provider.id}`, text)
    const n = result.commands.length
    return r.ok && n > 1
      ? { ...r, message: `${n} changes (${provider.label}). Last: ${r.message}` }
      : r
  } catch (e) {
    return keep(`AI assist failed (${(e as Error).message.slice(0, 160)}).`)
  }
}

function doUndo(): InputResult {
  const what = undo(db)
  return what
    ? { ok: true, message: `Undid ${undoLabel(what)}`, undoable: false }
    : { ok: false, message: 'Nothing to undo', undoable: false }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Dayfold',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12100e' : '#f8f7f4',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win?.show())
  win.on('show', flushMissed)
  win.on('restore', flushMissed)
  attachMainWindow(win)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    // only allow reloads of our own renderer origin
    const allowed = is.dev && process.env['ELECTRON_RENDERER_URL']
    try {
      if (allowed && new URL(url).origin === new URL(allowed).origin) return
      if (!allowed && url.startsWith('file://')) return
    } catch {
      /* fall through */
    }
    e.preventDefault()
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL'])
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.criston.dayfold')
  // A packaged app gets its icon from the bundle; an unpackaged run would show Electron's.
  if (process.platform === 'darwin' && !app.isPackaged)
    app.dock?.setIcon(join(app.getAppPath(), 'resources', 'icon.png'))
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))

  const userData = app.getPath('userData')
  // Demo Mode runs on its own database, so real data is never read, shown or changed.
  const demo = isDemoMode(userData)
  const dbPath = join(userData, demo ? DEMO_DB : REAL_DB)
  const freshDemo = demo && !existsSync(dbPath)
  db = openDb(dbPath)
  if (freshDemo) seedDemo(db)
  const helper = app.isPackaged
    ? join(process.resourcesPath, 'bin', 'ax-tracker')
    : join(app.getAppPath(), 'resources', 'bin', 'ax-tracker')
  let pending: NodeJS.Timeout | null = null
  tracker = new ActivityTracker(db, helper, () => {
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      notifyChanged('activity')
    }, 500)
  })
  if (!demo) tracker.start() // no tracking in demo: the sample activity must stay as it is

  const backups = new BackupManager(() => db, join(userData, demo ? 'backups-demo' : 'backups'))
  if (!demo) backups.start()
  registerDataIpc({
    getDb: () => db,
    backups,
    dbPath,
    getWindow: () => win,
    onChanged: notifyChanged,
    pause: () => tracker.stop(),
    resume: () => tracker.start()
  })

  ipcMain.handle('demo:get', () => demo)
  ipcMain.handle('demo:set', (_e, on: unknown) => {
    if (typeof on !== 'boolean') return { ok: false, message: 'Bad value' }
    if (on === demo) return { ok: true, message: '' }
    // Entering starts from fresh sample data; leaving drops it. Either way real data is untouched.
    tracker.stop()
    backups.stop()
    db.close()
    removeDemoDb(userData)
    setDemoFlag(userData, on)
    app.relaunch()
    app.exit(0)
    return { ok: true, message: on ? 'Starting Demo Mode…' : 'Leaving Demo Mode…' }
  })
  ipcMain.handle('dash:getState', () => buildState(db))
  ipcMain.handle('dash:parseDate', (_e, text: unknown) =>
    typeof text === 'string' && text.length <= 100 ? parseDate(text) : null
  )
  ipcMain.handle('dash:submit', async (_e, text: unknown, source: unknown) => {
    const r = await submit(String(text ?? '').slice(0, 5000), String(source))
    notifyChanged()
    return r
  })
  ipcMain.handle('dash:dispatch', (_e, command: Command) => {
    const r = run(command, 'ui', String((command as { type?: unknown } | null)?.type ?? '?'))
    notifyChanged()
    return r
  })
  ipcMain.handle('dash:undo', () => {
    const r = doUndo()
    notifyChanged()
    return r
  })
  ipcMain.handle('llm:status', () => getStatus(db))
  ipcMain.handle('llm:setConfig', (_e, config: unknown) => {
    setConfig(db, config)
    return getStatus(db)
  })
  ipcMain.handle('llm:test', () => testConnection(db))
  ipcMain.handle('llm:triage', () => triageDump(db))
  ipcMain.handle('activity:get', (_e, date?: unknown) => tracker.summary(date))
  ipcMain.handle('activity:setExclude', (_e, ids: unknown) => {
    tracker.setExclude(ids)
    return tracker.summary()
  })
  ipcMain.handle('activity:setIdle', (_e, sec: unknown) => {
    tracker.setIdleSeconds(sec)
    return tracker.summary()
  })
  ipcMain.handle('activity:setEnabled', (_e, on: boolean) => {
    tracker.setEnabled(Boolean(on))
    return tracker.summary()
  })
  ipcMain.handle('activity:setDetail', (_e, on: boolean) => {
    tracker.setCaptureDetail(Boolean(on))
    return tracker.summary()
  })
  ipcMain.handle('activity:purge', () => tracker.purge())
  ipcMain.handle('activity:setSnippets', (_e, on: unknown) => {
    tracker.setSnippets(on === true)
    return tracker.summary()
  })
  ipcMain.handle('activity:review', async (_e, date?: unknown): Promise<DayReviewResult> => {
    const s = tracker.summary(date)
    const r = await reviewActivityDay(db, s.date, s.sessions, buildState(db))
    if (!r.ok || !r.review) return { ok: false, message: r.message }
    tracker.saveReview(r.review)
    notifyChanged() // the user is waiting on this: refresh now rather than on the activity batch
    return { ok: true, message: '' }
  })
  const catalog = new AppCatalog({
    exec: defaultExec,
    readDir: defaultReadDir,
    dirs: defaultDirs(),
    icon: async (path) => {
      try {
        const img = await nativeImage.createThumbnailFromPath(path, { width: 64, height: 64 })
        if (!img.isEmpty()) return img.toDataURL()
      } catch {
        /* fall back to the file icon */
      }
      const img = await app.getFileIcon(path, { size: 'large' })
      return img.isEmpty() ? null : img.resize({ width: 64, height: 64 }).toDataURL()
    }
  })
  ipcMain.handle('activity:appInfo', (_e, ids: unknown) =>
    Array.isArray(ids) ? catalog.info(ids.filter((i): i is string => typeof i === 'string')) : []
  )
  ipcMain.handle('activity:installedApps', () => catalog.installedApps())
  ipcMain.handle('activity:addTask', (_e, input: unknown): ActivityAddTaskResult => {
    const i = (input ?? {}) as Record<string, unknown>
    const sessionId = typeof i.sessionId === 'string' ? i.sessionId : null
    if (sessionId !== null && !/^(\d{1,16}|m-\d{4}-\d{2}-\d{2}-[a-z0-9]{1,10})$/.test(sessionId))
      return { ok: false, message: 'Unknown session', undoable: false }
    const r = run(
      {
        type: 'task.add',
        title: String(i.title ?? ''),
        projectId: typeof i.projectId === 'number' ? i.projectId : undefined,
        planDate: typeof i.planDate === 'string' ? i.planDate : undefined
      },
      'ui',
      'activity session'
    )
    if (!r.ok) return r
    const row = db.prepare('SELECT MAX(id) AS id FROM tasks').get() as { id: number }
    if (sessionId !== null) tracker.linkTask(sessionId, row.id)
    notifyChanged()
    return { ...r, taskId: row.id }
  })
  ipcMain.handle('activity:openSettings', () =>
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    )
  )

  createWindow()
  initShell({
    db,
    getMainWindow: () => win,
    createMainWindow: createWindow,
    undo: () => {
      doUndo()
      notifyChanged()
    }
  })
  // Dock click: the main window is only hidden (macOS), so show it rather than assuming none exists.
  app.on('activate', showMainWindow)
})

app.on('before-quit', () => tracker?.stop())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
