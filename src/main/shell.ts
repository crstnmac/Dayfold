// "Shell" features: global capture hotkey + capture window, menu-bar tray, end-of-day reminder,
// and the persisted preferences behind them. Pure decisions live in shared/shell-logic.ts.
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  screen,
  Tray
} from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { DatabaseSync } from 'node:sqlite'
import type {
  NavigateTarget,
  NotifyPayload,
  ShellPrefs,
  ShellSettingsResult,
  ShellStatus
} from '../shared/types'
import {
  acceleratorSymbols,
  isoLocal,
  nextReminderAt,
  PREF_KEYS,
  prefsFromRaw,
  reminderDue,
  sanitizePatch
} from '../shared/shell-logic'
import { TRAY_ICON_1X, TRAY_ICON_2X } from './tray-icon-data'
import { createNotifier, type Notifier } from './notify'
import { captureCard, deadlineCard, peekCard, reminderCard } from '../shared/notify-logic'

export interface ShellDeps {
  db: DatabaseSync
  getMainWindow: () => BrowserWindow | null
  /** Create the main window (it shows itself when ready). */
  createMainWindow: () => void
  /** Undo the last change and tell the main window to refresh. */
  undo: () => void
}

const CAPTURE_W = 640
const CAPTURE_H = 84
const FIRED_KEY = 'shell.reminder.firedDate'
const DEADLINE_KEY = 'shell.deadline.firedDate'
const PEEK_ACCELERATOR = 'Alt+Shift+Space'
const SNOOZE_MS = 10 * 60_000
/** A hidden overlay window holds a whole renderer process; it is released after this long unused. */
const OVERLAY_IDLE_MS = 2 * 60_000
/** The main window only hides on close (macOS). Hidden this long, its renderer is released too. */
const MAIN_IDLE_MS = 15 * 60_000
const WRAPUP_KEY = 'wrapup.lastDate'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

let deps: ShellDeps | null = null
let prefs: ShellPrefs
let quitting = false
let capture: BrowserWindow | null = null
let captureIdle: NodeJS.Timeout | null = null
let mainReady = false
let queuedNav: NavigateTarget | null = null
let captureShownAt = 0
let tray: Tray | null = null
let timer: NodeJS.Timeout | null = null
let hotkey: ShellStatus['hotkey'] = { accelerator: '', registered: false, error: null }
let notifier: Notifier | null = null
let snooze: NodeJS.Timeout | null = null

// ---------------------------------------------------------------------------------------------
// Settings table access
// ---------------------------------------------------------------------------------------------

function readSetting(db: DatabaseSync, key: string): string | undefined {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return r?.value
}

function writeSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

function loadPrefs(db: DatabaseSync): ShellPrefs {
  const raw: Record<string, string | undefined> = {}
  for (const k of Object.values(PREF_KEYS)) raw[k] = readSetting(db, k)
  return prefsFromRaw(raw)
}

function savePrefs(db: DatabaseSync, next: ShellPrefs): void {
  for (const [k, key] of Object.entries(PREF_KEYS) as [keyof ShellPrefs, string][]) {
    const v = next[k]
    writeSetting(db, key, typeof v === 'boolean' ? (v ? '1' : '0') : v)
  }
}

/**
 * Record that the end-of-day wrap-up was completed on `isoDate` (YYYY-MM-DD, local), so today's
 * reminder is suppressed. The wrap-up feature calls this when the user finishes a wrap-up.
 */
export function markWrapupDone(db: DatabaseSync, isoDate: string): void {
  if (!ISO_DATE.test(isoDate)) throw new Error('markWrapupDone: date must be YYYY-MM-DD')
  writeSetting(db, WRAPUP_KEY, isoDate)
}

// ---------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------

export function showMainWindow(): void {
  if (!deps) return
  let w = deps.getMainWindow()
  if (!w || w.isDestroyed()) {
    deps.createMainWindow()
    w = deps.getMainWindow()
    if (!w) return
  }
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
  if (process.platform === 'darwin') app.focus({ steal: true })
}

/**
 * Open the main window on a tab (or the settings dialog). A window that is still loading, or was
 * just re-created after being released, gets the jump once its page says it is listening.
 */
export function navigate(target: NavigateTarget): void {
  showMainWindow()
  const w = deps?.getMainWindow()
  if (!w || w.isDestroyed()) return
  if (!mainReady) queuedNav = target
  else w.webContents.send('dash:navigate', target)
}

/** Call for every main window: macOS hides on close (app lives in the menu bar), others quit. */
export function attachMainWindow(win: BrowserWindow): void {
  let idle: NodeJS.Timeout | null = null
  win.on('close', (e) => {
    if (process.platform === 'darwin' && !quitting) {
      e.preventDefault()
      win.hide()
      // Everything is saved as it happens, so a long-hidden window is closed for real to free its
      // renderer. showMainWindow() builds a fresh one the next time it is asked for.
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) win.destroy()
      }, MAIN_IDLE_MS)
      idle.unref()
    }
  })
  win.on('show', () => {
    if (idle) clearTimeout(idle)
    idle = null
  })
  win.webContents.on('did-start-loading', () => {
    mainReady = false
  })
  win.on('closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

function rendererUrl(hash: string): { url?: string; file?: string } {
  const dev = is.dev && process.env['ELECTRON_RENDERER_URL']
  return dev
    ? { url: `${process.env['ELECTRON_RENDERER_URL']}#${hash}` }
    : { file: join(__dirname, '../renderer/index.html') }
}

function handleNotifyAction(p: NotifyPayload, action: string): void {
  if (action === 'undo') deps?.undo()
  else if (action === 'wrap') navigate({ tab: 'eod' })
  else if (action === 'open') navigate({ tab: p.tab ?? 'today' })
  else if (action === 'snooze') {
    if (snooze) clearTimeout(snooze)
    snooze = setTimeout(() => notifier?.show({ ...p, id: `${p.kind}-${Date.now()}` }), SNOOZE_MS)
    snooze.unref()
  }
}

function ensureNotifier(): Notifier {
  if (notifier) return notifier
  notifier = createNotifier({
    load: (w) => {
      const t = rendererUrl('notify')
      if (t.url) void w.loadURL(t.url)
      else void w.loadFile(t.file!, { hash: 'notify' })
    },
    onAction: handleNotifyAction
  })
  return notifier
}

function ensureCapture(): BrowserWindow {
  if (capture && !capture.isDestroyed()) return capture
  const w = new BrowserWindow({
    width: CAPTURE_W,
    height: CAPTURE_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: 'Dayfold capture',
    // A macOS panel takes key focus without activating the app, so the main window never jumps up.
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  w.setAlwaysOnTop(true, 'floating')
  if (process.platform === 'darwin') {
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    w.setHiddenInMissionControl(true)
  }
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  // Esc cancels even if the page has not focused an element.
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      e.preventDefault()
      hideCapture()
    }
  })
  // Click-away dismisses. The grace window ignores the transient blur while the panel is activating.
  w.on('blur', () => {
    if (Date.now() - captureShownAt > 250 && !process.env['DASH_TEST_KEEP_CAPTURE']) hideCapture()
  })
  const t = rendererUrl('capture')
  if (t.url) void w.loadURL(t.url)
  else void w.loadFile(t.file!, { hash: 'capture' })
  capture = w
  armCaptureIdle()
  return w
}

function armCaptureIdle(): void {
  if (captureIdle) clearTimeout(captureIdle)
  captureIdle = setTimeout(() => {
    captureIdle = null
    if (!capture || capture.isDestroyed() || capture.isVisible()) return
    capture.destroy()
    capture = null
  }, OVERLAY_IDLE_MS)
  captureIdle.unref()
}

export function hideCapture(): void {
  if (capture && !capture.isDestroyed() && capture.isVisible()) {
    capture.hide()
    armCaptureIdle()
  }
}

export function isCaptureVisible(): boolean {
  return !!capture && !capture.isDestroyed() && capture.isVisible()
}

/** Show the capture bar centred near the top of the display the cursor is on. */
export function showCapture(): void {
  const w = ensureCapture()
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  w.setPosition(
    Math.round(area.x + (area.width - CAPTURE_W) / 2),
    Math.round(area.y + area.height * 0.18)
  )
  captureShownAt = Date.now()
  if (captureIdle) clearTimeout(captureIdle)
  captureIdle = null
  w.show()
  w.focus()
  w.webContents.send('shell:captureShown')
}

function toggleCapture(): void {
  if (isCaptureVisible()) hideCapture()
  else showCapture()
}

// ---------------------------------------------------------------------------------------------
// Global hotkey
// ---------------------------------------------------------------------------------------------

const pretty = (a: string): string => acceleratorSymbols(a).join('')

/** Try to register an accelerator; returns an error message, or null on success. */
function tryRegister(accelerator: string): string | null {
  try {
    const ok = globalShortcut.register(accelerator, toggleCapture)
    return ok && globalShortcut.isRegistered(accelerator)
      ? null
      : `${pretty(accelerator)} is already used by another app or by macOS. Choose a different shortcut.`
  } catch (e) {
    return `Could not register ${pretty(accelerator)}: ${(e as Error).message}`
  }
}

function applyHotkey(): void {
  if (hotkey.registered) globalShortcut.unregister(hotkey.accelerator)
  if (globalShortcut.isRegistered(PEEK_ACCELERATOR)) globalShortcut.unregister(PEEK_ACCELERATOR)
  hotkey = { accelerator: prefs.hotkey, registered: false, error: null }
  if (!prefs.hotkeyEnabled) return
  try {
    globalShortcut.register(PEEK_ACCELERATOR, showPeek)
  } catch {
    /* the peek shortcut is a bonus; capture still works without it */
  }
  const error = tryRegister(prefs.hotkey)
  hotkey = { accelerator: prefs.hotkey, registered: error === null, error }
  if (error) {
    console.warn(`[shell] ${error}`)
    notifyOnce('Quick capture shortcut unavailable', `${error} Change it in Settings.`)
  }
}

function notifyOnce(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

// ---------------------------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------------------------

function openCount(db: DatabaseSync, now = new Date()): number {
  try {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS c FROM tasks
         WHERE status IN ('todo','doing') AND plan_date IS NOT NULL AND plan_date <= ?`
      )
      .get(isoLocal(now)) as { c: number }
    return r.c
  } catch {
    return 0
  }
}

/** Menu content for the tray, rebuilt on every click so counts are fresh. Exposed for tests. */
export function buildTrayMenu(): Menu {
  const n = deps ? openCount(deps.db) : 0
  return Menu.buildFromTemplate([
    { label: 'Open Dayfold', click: () => showMainWindow() },
    {
      label: 'Quick capture',
      accelerator: prefs.hotkeyEnabled ? prefs.hotkey : undefined,
      registerAccelerator: false,
      click: () => showCapture()
    },
    { type: 'separator' },
    {
      label: n === 0 ? 'Nothing open for today' : `${n} open for today`,
      enabled: false
    },
    {
      label: 'Pause reminders',
      type: 'checkbox',
      checked: prefs.remindersPaused,
      click: (item) => void applyPatch({ remindersPaused: item.checked })
    },
    ...(app.isPackaged
      ? [
          {
            label: 'Launch at login',
            type: 'checkbox' as const,
            checked: prefs.launchAtLogin,
            click: (item: Electron.MenuItem) => void applyPatch({ launchAtLogin: item.checked })
          }
        ]
      : []),
    { type: 'separator' },
    { label: 'Settings…', click: () => navigate({ tab: 'settings' }) },
    { type: 'separator' },
    { label: 'Quit Dayfold', click: () => app.quit() }
  ])
}

function trayImage(): Electron.NativeImage {
  const img = nativeImage.createEmpty()
  img.addRepresentation({ scaleFactor: 1, buffer: Buffer.from(TRAY_ICON_1X, 'base64') })
  img.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(TRAY_ICON_2X, 'base64') })
  img.setTemplateImage(true)
  return img
}

function applyTray(): void {
  if (!prefs.trayEnabled) {
    tray?.destroy()
    tray = null
    return
  }
  if (tray && !tray.isDestroyed()) return
  tray = new Tray(trayImage())
  tray.setToolTip('Dayfold')
  const pop = (): void => tray?.popUpContextMenu(buildTrayMenu())
  tray.on('click', pop)
  tray.on('right-click', pop)
}

function applyLoginItem(): void {
  // Login items are only meaningful for the packaged, signed app.
  if (app.isPackaged && process.platform === 'darwin')
    app.setLoginItemSettings({ openAtLogin: prefs.launchAtLogin })
}

// ---------------------------------------------------------------------------------------------
// End-of-day reminder
// ---------------------------------------------------------------------------------------------

function reminderInputs(now: Date): Parameters<typeof reminderDue>[0] {
  const db = deps!.db
  return {
    now,
    enabled: prefs.reminderEnabled,
    paused: prefs.remindersPaused,
    time: prefs.reminderTime,
    firedDate: readSetting(db, FIRED_KEY) ?? null,
    wrapupDate: readSetting(db, WRAPUP_KEY) ?? null
  }
}

/**
 * Fire the end-of-day reminder if it is due (once per local day, not after a wrap-up). Safe to call
 * as often as you like: the fired date is stored before the notification is shown.
 */
export function checkReminder(now = new Date()): boolean {
  if (!deps || !reminderDue(reminderInputs(now))) return false
  writeSetting(deps.db, FIRED_KEY, isoLocal(now))
  ensureNotifier().show(reminderCard(openCount(deps.db, now)))
  return true
}

function rowsOf<T>(db: DatabaseSync, sql: string, ...args: (string | number)[]): T[] {
  try {
    return db.prepare(sql).all(...args) as T[]
  } catch {
    return []
  }
}

/** Once per day from 9am: projects due or overdue, and tasks carried several times. */
export function checkDeadlines(now = new Date()): boolean {
  if (!deps || prefs.remindersPaused || now.getHours() < 9) return false
  const today = isoLocal(now)
  if (readSetting(deps.db, DEADLINE_KEY) === today) return false
  const card = deadlineCard({
    today,
    projects: rowsOf(
      deps.db,
      `SELECT name, due FROM projects
       WHERE status = 'active' AND due IS NOT NULL AND due <= ? ORDER BY due`,
      today
    ),
    stale: rowsOf<{ title: string; carry_count: number }>(
      deps.db,
      `SELECT title, carry_count FROM tasks
       WHERE status IN ('todo','doing') AND carry_count >= 3 ORDER BY carry_count DESC LIMIT 5`
    ).map((t) => ({ title: t.title, carried: t.carry_count }))
  })
  if (!card) return false
  writeSetting(deps.db, DEADLINE_KEY, today)
  ensureNotifier().show(card)
  return true
}

/** The summon-on-demand "Right now" card. */
export function showPeek(): void {
  if (!deps) return
  const n = ensureNotifier()
  if (n.current()?.kind === 'peek') return n.hide()
  const now = new Date()
  const today = isoLocal(now)
  const inbox = rowsOf<{ c: number }>(
    deps.db,
    'SELECT COUNT(*) AS c FROM dump WHERE triaged = 0'
  )[0]
  const next = rowsOf<{ name: string; due: string }>(
    deps.db,
    `SELECT name, due FROM projects
     WHERE status = 'active' AND due IS NOT NULL AND due >= ? ORDER BY due LIMIT 1`,
    today
  )[0]
  const days = (iso: string): number => {
    const [y, m, d] = iso.split('-').map(Number)
    return Math.round(
      (new Date(y, m - 1, d).getTime() -
        new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
        86_400_000
    )
  }
  n.show(
    peekCard({
      open: openCount(deps.db, now),
      inbox: inbox?.c ?? 0,
      nextDue: next ? { name: next.name, days: days(next.due) } : null
    })
  )
}

/** Poll at most once a minute. A re-armed timeout (not one long timer) survives sleep and clock changes. */
function armReminder(): void {
  if (timer) clearTimeout(timer)
  const next = deps ? nextReminderAt(reminderInputs(new Date())) : null
  const wait = next ? next.getTime() - Date.now() : 60_000
  timer = setTimeout(
    () => {
      checkReminder()
      checkDeadlines()
      armReminder()
    },
    Math.min(Math.max(wait, 500), 60_000)
  )
  timer.unref()
}

// ---------------------------------------------------------------------------------------------
// Public status + settings
// ---------------------------------------------------------------------------------------------

export function getShellStatus(): ShellStatus {
  const next = deps && !prefs.remindersPaused ? nextReminderAt(reminderInputs(new Date())) : null
  return {
    hotkey: { ...hotkey },
    trayActive: !!tray && !tray.isDestroyed(),
    notificationsSupported: Notification.isSupported(),
    launchAtLoginSupported: app.isPackaged && process.platform === 'darwin',
    nextReminderAt: next ? next.getTime() : null
  }
}

function applyPatch(raw: unknown): ShellSettingsResult {
  if (!deps) throw new Error('Shell not ready')
  const patch = sanitizePatch(raw)
  const prev = prefs
  const next: ShellPrefs = { ...prev, ...patch }
  let warning: string | null = null

  const hotkeyChanged =
    next.hotkey !== prev.hotkey ||
    next.hotkeyEnabled !== prev.hotkeyEnabled ||
    (next.hotkeyEnabled && !hotkey.registered)
  if (hotkeyChanged) {
    prefs = next
    applyHotkey()
    if (!hotkey.registered && next.hotkeyEnabled) {
      // Keep the shortcut that worked rather than leaving the user with none.
      warning = hotkey.error
      next.hotkey = prev.hotkey
      next.hotkeyEnabled = prev.hotkeyEnabled
      prefs = next
      applyHotkey()
    }
  }
  prefs = next
  savePrefs(deps.db, prefs)
  applyTray()
  applyLoginItem()
  armReminder()
  return { prefs, status: getShellStatus(), warning }
}

export function initShell(d: ShellDeps): void {
  deps = d
  prefs = loadPrefs(d.db)
  quitting = false

  ipcMain.handle('shell:getSettings', () => prefs)
  ipcMain.handle('shell:status', () => getShellStatus())
  ipcMain.handle('shell:setSettings', (_e, patch: unknown) => applyPatch(patch))
  ipcMain.handle('shell:hideCapture', () => hideCapture())
  ipcMain.handle('dash:navReady', (e) => {
    const w = deps?.getMainWindow()
    if (!w || w.isDestroyed() || e.sender !== w.webContents) return
    mainReady = true
    const target = queuedNav
    queuedNav = null
    if (target) w.webContents.send('dash:navigate', target)
  })
  ipcMain.handle('shell:captureDone', (_e, r: unknown) => {
    const { message, undoable } = (r ?? {}) as { message?: unknown; undoable?: unknown }
    hideCapture()
    if (typeof message === 'string' && message)
      ensureNotifier().show(captureCard(message.slice(0, 200), undoable === true))
  })

  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    if (timer) clearTimeout(timer)
    tray?.destroy()
    tray = null
  })

  applyHotkey()
  applyTray()
  applyLoginItem()
  ensureCapture()
  ensureNotifier().warm()
  armReminder()
  checkReminder()
  checkDeadlines()

  powerMonitor.on('resume', () => {
    checkReminder()
    checkDeadlines()
    armReminder()
  })
  powerMonitor.on('unlock-screen', () => checkReminder())

  // Test hook: only exposed when running against an isolated data folder.
  if (process.env['DASH_USER_DATA'])
    Object.assign(globalThis, {
      __dashShell: {
        showCapture,
        hideCapture,
        isCaptureVisible,
        checkReminder,
        checkDeadlines,
        showPeek,
        notifyWindow: () => notifier?.window() ?? null,
        notifyCurrent: () => notifier?.current() ?? null,
        markWrapupDone: (iso: string) => markWrapupDone(d.db, iso),
        getShellStatus,
        buildTrayMenuLabels: () => buildTrayMenu().items.map((i) => i.label),
        captureWindow: () => capture,
        prefs: () => prefs
      }
    })
}
