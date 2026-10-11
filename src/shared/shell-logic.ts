// Pure helpers for the "shell" features (hotkey, tray, reminder). No Electron imports so they run
// in the main process, the renderer and unit tests alike.
import type { ShellPrefs } from './types'

export const DEFAULT_PREFS: ShellPrefs = {
  hotkey: 'Alt+Space',
  hotkeyEnabled: true,
  reminderEnabled: true,
  reminderTime: '17:30',
  remindersPaused: false,
  trayEnabled: true,
  launchAtLogin: false
}

// ---------------------------------------------------------------------------------------------
// Accelerators
// ---------------------------------------------------------------------------------------------

const MODIFIERS: Record<string, 'Control' | 'Alt' | 'Shift' | 'Command'> = {
  command: 'Command',
  cmd: 'Command',
  super: 'Command',
  meta: 'Command',
  control: 'Control',
  ctrl: 'Control',
  commandorcontrol: 'Command',
  cmdorctrl: 'Command',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift'
}
const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Command'] as const

const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  return: 'Return',
  enter: 'Return',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  plus: 'Plus'
}
const PUNCTUATION = new Set(['`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/'])

/** Returns the canonical key name, or null when the key can't be used in an accelerator. */
function canonicalKey(raw: string): string | null {
  if (raw.length === 1) {
    if (/^[a-zA-Z]$/.test(raw)) return raw.toUpperCase()
    if (/^[0-9]$/.test(raw) || PUNCTUATION.has(raw)) return raw
    return null
  }
  const lower = raw.toLowerCase()
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower)
  if (fn) return `F${fn[1]}`
  return NAMED_KEYS[lower] ?? null
}

/**
 * Validates and normalises an Electron accelerator ("Alt+Space", "CommandOrControl+Shift+K").
 * Returns the canonical string (modifiers in a fixed order) or null when it is unusable.
 * A shortcut needs a non-Shift modifier (or be a bare function key) so it can't hijack typing.
 */
export function normalizeAccelerator(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 64) return null
  // "Cmd++" style: the final "+" is the Plus key itself.
  const parts = input.endsWith('++') ? [...input.slice(0, -2).split('+'), 'Plus'] : input.split('+')
  const key = parts.pop() ?? ''
  const mods = new Set<string>()
  for (const p of parts) {
    const m = MODIFIERS[p.trim().toLowerCase()]
    if (!m) return null
    mods.add(m)
  }
  const k = canonicalKey(key.trim())
  if (!k) return null
  const isFn = /^F\d+$/.test(k)
  const hasReal = mods.has('Control') || mods.has('Alt') || mods.has('Command')
  if (!hasReal && !isFn) return null
  return [...MOD_ORDER.filter((m) => mods.has(m)), k].join('+')
}

/** Map KeyboardEvent.code to an accelerator key, ignoring layout and Option-composed characters. */
export function keyFromCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  m = /^Digit([0-9])$/.exec(code)
  if (m) return m[1]
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  const map: Record<string, string> = {
    Space: 'Space',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Enter: 'Return',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/'
  }
  return map[code] ?? null
}

export interface KeyEventLike {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Convert a key press to a normalised accelerator, or null if it isn't a valid combination yet. */
export function acceleratorFromEvent(e: KeyEventLike): string | null {
  const key = keyFromCode(e.code)
  if (!key) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Command')
  return normalizeAccelerator([...parts, key].join('+'))
}

const SYMBOLS: Record<string, string> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
  Space: 'Space',
  Return: '↩',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Backspace: '⌫',
  Delete: '⌦',
  Plus: '+'
}

/** Human display of an accelerator, e.g. "Alt+Space" -> ["⌥", "Space"]. */
export function acceleratorSymbols(accelerator: string): string[] {
  return accelerator.split('+').map((p) => SYMBOLS[p] ?? p)
}

// ---------------------------------------------------------------------------------------------
// Time + reminder scheduling
// ---------------------------------------------------------------------------------------------

export const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isoLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** The local wall-clock instant HH:MM on the calendar day of `base`. DST gaps roll forward. */
export function at(base: Date, hhmm: string, dayOffset = 0): Date {
  const m = HHMM.exec(hhmm)
  const [h, min] = m ? [Number(m[1]), Number(m[2])] : [17, 30]
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, h, min, 0, 0)
}

/** How late (after the configured time) a missed reminder is still worth showing. */
export const GRACE_MS = 3 * 60 * 60 * 1000

export interface ReminderInputs {
  now: Date
  enabled: boolean
  paused: boolean
  time: string
  /** ISO date the reminder last fired on. */
  firedDate: string | null
  /** ISO date the wrap-up was completed on. */
  wrapupDate: string | null
}

/** True when the reminder should fire right now: past the time, inside the grace window, once a day. */
export function reminderDue(i: ReminderInputs): boolean {
  if (!i.enabled || i.paused) return false
  const today = isoLocal(i.now)
  if (i.firedDate === today || i.wrapupDate === today) return false
  const target = at(i.now, i.time).getTime()
  const t = i.now.getTime()
  return t >= target && t - target <= GRACE_MS
}

/**
 * The next instant the reminder can fire, or null when disabled. Today's slot counts only while it
 * is still ahead and unspent; otherwise it is tomorrow's.
 */
export function nextReminderAt(i: ReminderInputs): Date | null {
  if (!i.enabled) return null
  const today = isoLocal(i.now)
  const spent = i.firedDate === today || i.wrapupDate === today
  const todays = at(i.now, i.time)
  if (!spent && todays.getTime() > i.now.getTime()) return todays
  return at(i.now, i.time, 1)
}

// ---------------------------------------------------------------------------------------------
// Settings sanitising
// ---------------------------------------------------------------------------------------------

/** Strictly validates a partial update; throws on any invalid value, ignores unknown keys. */
export function sanitizePatch(input: unknown): Partial<ShellPrefs> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('Invalid settings')
  const src = input as Record<string, unknown>
  const out: Partial<ShellPrefs> = {}
  for (const k of [
    'hotkeyEnabled',
    'reminderEnabled',
    'remindersPaused',
    'trayEnabled',
    'launchAtLogin'
  ] as const) {
    if (src[k] === undefined) continue
    if (typeof src[k] !== 'boolean') throw new Error(`${k} must be true or false`)
    out[k] = src[k]
  }
  if (src.hotkey !== undefined) {
    const a = normalizeAccelerator(src.hotkey)
    if (!a) throw new Error('That is not a usable shortcut. Include ⌘, ⌃ or ⌥ plus one key.')
    out.hotkey = a
  }
  if (src.reminderTime !== undefined) {
    if (typeof src.reminderTime !== 'string' || !HHMM.test(src.reminderTime))
      throw new Error('Reminder time must be HH:MM (24-hour)')
    out.reminderTime = src.reminderTime
  }
  return out
}

/** Rebuild a full, valid ShellPrefs from raw stored string values (corrupt values fall back). */
export function prefsFromRaw(raw: Record<string, string | undefined>): ShellPrefs {
  const bool = (v: string | undefined, d: boolean): boolean =>
    v === '1' ? true : v === '0' ? false : d
  const d = DEFAULT_PREFS
  const hotkey = normalizeAccelerator(raw['shell.hotkey']) ?? d.hotkey
  const time = raw['shell.reminder.time']
  return {
    hotkey,
    hotkeyEnabled: bool(raw['shell.hotkey.enabled'], d.hotkeyEnabled),
    reminderEnabled: bool(raw['shell.reminder.enabled'], d.reminderEnabled),
    reminderTime: time && HHMM.test(time) ? time : d.reminderTime,
    remindersPaused: bool(raw['shell.reminder.paused'], d.remindersPaused),
    trayEnabled: bool(raw['shell.tray.enabled'], d.trayEnabled),
    launchAtLogin: bool(raw['shell.launchAtLogin'], d.launchAtLogin)
  }
}

/** Settings table key for each pref. */
export const PREF_KEYS: Record<keyof ShellPrefs, string> = {
  hotkey: 'shell.hotkey',
  hotkeyEnabled: 'shell.hotkey.enabled',
  reminderEnabled: 'shell.reminder.enabled',
  reminderTime: 'shell.reminder.time',
  remindersPaused: 'shell.reminder.paused',
  trayEnabled: 'shell.tray.enabled',
  launchAtLogin: 'shell.launchAtLogin'
}
