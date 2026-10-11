// The floating notification overlay: one small transparent panel, above every app and Space,
// that shows a single card at a time. The card itself is rendered by the `#notify` route.
import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import type { NotifyPayload } from '../shared/types'

const W = 404
const MIN_H = 120
/** A hidden card window holds a whole renderer process; give it back after this long unused. */
const IDLE_MS = 2 * 60_000

export interface Notifier {
  /** Create the (hidden) window ahead of time so the first card appears instantly. */
  warm(): void
  show(payload: NotifyPayload): void
  hide(): void
  current(): NotifyPayload | null
  window(): BrowserWindow | null
}

export function createNotifier(opts: {
  load: (w: BrowserWindow) => void
  onAction: (payload: NotifyPayload, action: string) => void
}): Notifier {
  let win: BrowserWindow | null = null
  let ready = false
  let pending: NotifyPayload | null = null
  let shown: NotifyPayload | null = null
  let idle: NodeJS.Timeout | null = null

  // The next card re-creates the window (it is a small page, so that takes a moment, not a wait).
  const armIdle = (): void => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => {
      idle = null
      if (!win || win.isDestroyed() || win.isVisible() || shown || pending) return
      win.destroy()
      win = null
      ready = false
    }, IDLE_MS)
    idle.unref()
  }

  const ensure = (): BrowserWindow => {
    if (win && !win.isDestroyed()) return win
    ready = false
    const w = new BrowserWindow({
      width: W,
      height: MIN_H,
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
      title: 'Dayfold notification',
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
      w.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      })
      w.setHiddenInMissionControl(true)
    }
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    // The "Right now" peek is summoned on purpose, so clicking away or pressing Esc closes it.
    w.on('blur', () => {
      if (shown?.kind === 'peek') hide()
    })
    w.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        e.preventDefault()
        hide()
      }
    })
    opts.load(w)
    win = w
    armIdle()
    return w
  }

  const place = (w: BrowserWindow): void => {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    w.setPosition(area.x + area.width - W - 12, area.y + 10)
  }

  const flush = (): void => {
    if (!win || win.isDestroyed() || !ready || !pending) return
    const p = pending
    pending = null
    shown = p
    if (idle) clearTimeout(idle)
    idle = null
    place(win)
    win.webContents.send('shell:notify', p)
    // Automatic cards never steal focus from what you are doing; a peek takes it so Esc works.
    if (p.kind === 'peek') {
      win.show()
      win.focus()
    } else win.showInactive()
  }

  function hide(): void {
    shown = null
    pending = null
    if (win && !win.isDestroyed() && win.isVisible()) win.hide()
    if (win && !win.isDestroyed()) armIdle()
  }

  ipcMain.handle('notify:ready', () => {
    ready = true
    flush()
  })
  ipcMain.handle('notify:action', (_e, id: unknown, action: unknown) => {
    if (shown && shown.id === id && typeof action === 'string') opts.onAction(shown, action)
  })
  ipcMain.handle('notify:resize', (_e, height: unknown) => {
    if (!win || win.isDestroyed() || typeof height !== 'number' || !Number.isFinite(height)) return
    const [x, y] = win.getPosition()
    win.setBounds({ x, y, width: W, height: Math.min(480, Math.max(MIN_H, Math.ceil(height))) })
  })
  ipcMain.handle('notify:dismiss', () => hide())

  return {
    warm() {
      ensure()
    },
    show(payload) {
      pending = payload
      ensure()
      flush()
    },
    hide,
    current: () => shown,
    window: () => (win && !win.isDestroyed() ? win : null)
  }
}
