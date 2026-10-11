import { describe, expect, it } from 'vitest'
import {
  acceleratorFromEvent,
  acceleratorSymbols,
  at,
  DEFAULT_PREFS,
  GRACE_MS,
  isoLocal,
  nextReminderAt,
  normalizeAccelerator,
  prefsFromRaw,
  reminderDue,
  sanitizePatch,
  type ReminderInputs
} from '../src/shared/shell-logic'

const base = (over: Partial<ReminderInputs> = {}): ReminderInputs => ({
  now: new Date(2026, 5, 10, 12, 0),
  enabled: true,
  paused: false,
  time: '17:30',
  firedDate: null,
  wrapupDate: null,
  ...over
})

describe('accelerator validation', () => {
  it('normalises names and order', () => {
    expect(normalizeAccelerator('Option+Space')).toBe('Alt+Space')
    expect(normalizeAccelerator('cmd+shift+k')).toBe('Shift+Command+K')
    expect(normalizeAccelerator('CommandOrControl+Alt+1')).toBe('Alt+Command+1')
    expect(normalizeAccelerator('Ctrl+Alt+Left')).toBe('Control+Alt+Left')
    expect(normalizeAccelerator('Alt+F12')).toBe('Alt+F12')
    expect(normalizeAccelerator('Command++')).toBe('Command+Plus')
  })
  it('allows a bare function key but no bare letter or shift-only combo', () => {
    expect(normalizeAccelerator('F5')).toBe('F5')
    expect(normalizeAccelerator('A')).toBeNull()
    expect(normalizeAccelerator('Space')).toBeNull()
    expect(normalizeAccelerator('Shift+A')).toBeNull()
  })
  it('rejects garbage', () => {
    for (const bad of ['', 'Alt+', '+Space', 'Alt+Banana', 'Hyper+K', 'Alt+K+L', 'Alt+F25']) {
      expect(normalizeAccelerator(bad), bad).toBeNull()
    }
    expect(normalizeAccelerator(42)).toBeNull()
    expect(normalizeAccelerator(null)).toBeNull()
    expect(normalizeAccelerator('A'.repeat(100))).toBeNull()
  })
  it('converts key events regardless of Option-composed characters', () => {
    const ev = { metaKey: false, ctrlKey: false, altKey: true, shiftKey: false }
    expect(acceleratorFromEvent({ ...ev, code: 'Space' })).toBe('Alt+Space')
    expect(acceleratorFromEvent({ ...ev, code: 'KeyK', metaKey: true })).toBe('Alt+Command+K')
    expect(acceleratorFromEvent({ ...ev, code: 'Digit4', shiftKey: true })).toBe('Alt+Shift+4')
  })
  it('ignores modifier-only and unusable events', () => {
    const ev = { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }
    expect(acceleratorFromEvent({ ...ev, code: 'MetaLeft' })).toBeNull()
    expect(acceleratorFromEvent({ ...ev, code: 'ShiftLeft' })).toBeNull()
    expect(acceleratorFromEvent({ ...ev, altKey: false, metaKey: false, code: 'KeyA' })).toBeNull()
  })
  it('renders mac symbols', () => {
    expect(acceleratorSymbols('Alt+Space')).toEqual(['⌥', 'Space'])
    expect(acceleratorSymbols('Control+Shift+Command+K')).toEqual(['⌃', '⇧', '⌘', 'K'])
  })
})

describe('reminder time calculation', () => {
  it('is later today when the time is still ahead', () => {
    expect(nextReminderAt(base())).toEqual(new Date(2026, 5, 10, 17, 30))
  })
  it('rolls to tomorrow once the time has passed', () => {
    const now = new Date(2026, 5, 10, 18, 0)
    expect(nextReminderAt(base({ now }))).toEqual(new Date(2026, 5, 11, 17, 30))
  })
  it('rolls to tomorrow when today is already fired or wrapped up', () => {
    expect(nextReminderAt(base({ firedDate: '2026-06-10' }))).toEqual(new Date(2026, 5, 11, 17, 30))
    expect(nextReminderAt(base({ wrapupDate: '2026-06-10' }))).toEqual(
      new Date(2026, 5, 11, 17, 30)
    )
  })
  it('crosses month and year boundaries and midnight', () => {
    expect(nextReminderAt(base({ now: new Date(2026, 11, 31, 23, 59) }))).toEqual(
      new Date(2027, 0, 1, 17, 30)
    )
    expect(nextReminderAt(base({ now: new Date(2026, 5, 30, 17, 31), time: '00:05' }))).toEqual(
      new Date(2026, 6, 1, 0, 5)
    )
    // just after midnight with a 00:05 reminder: still today
    expect(nextReminderAt(base({ now: new Date(2026, 5, 11, 0, 1), time: '00:05' }))).toEqual(
      new Date(2026, 5, 11, 0, 5)
    )
  })
  it('is null when disabled', () => {
    expect(nextReminderAt(base({ enabled: false }))).toBeNull()
  })
  it('keeps wall-clock time across DST changes', () => {
    // 17:30 local on any day is 17:30 on the clock, even on a 23h or 25h day.
    for (const month of [2, 9, 10]) {
      for (let d = 1; d <= 31; d++) {
        const day = new Date(2026, month, d, 8, 0)
        if (day.getMonth() !== month) continue
        const next = nextReminderAt(base({ now: day }))!
        expect([next.getHours(), next.getMinutes()]).toEqual([17, 30])
      }
    }
  })
  it('rolls a nonexistent DST-gap time forward instead of skipping the day', () => {
    // 02:30 may not exist on a spring-forward day; the result must still be on that calendar day.
    for (let d = 1; d <= 31; d++) {
      const when = at(new Date(2026, 2, d, 8, 0), '02:30')
      expect(isoLocal(when)).toBe(`2026-03-${String(d).padStart(2, '0')}`)
    }
  })
  it('falls back to 17:30 for a malformed time', () => {
    expect(at(new Date(2026, 5, 10), 'nope')).toEqual(new Date(2026, 5, 10, 17, 30))
  })
})

describe('once-per-day guard', () => {
  it('is not due before the time', () => {
    expect(reminderDue(base({ now: new Date(2026, 5, 10, 17, 29, 59) }))).toBe(false)
  })
  it('is due from the time until the grace window ends', () => {
    expect(reminderDue(base({ now: new Date(2026, 5, 10, 17, 30) }))).toBe(true)
    const late = new Date(new Date(2026, 5, 10, 17, 30).getTime() + GRACE_MS)
    expect(reminderDue(base({ now: late }))).toBe(true)
    expect(reminderDue(base({ now: new Date(late.getTime() + 1) }))).toBe(false)
  })
  it('does not fire twice on the same day', () => {
    const now = new Date(2026, 5, 10, 17, 45)
    expect(reminderDue(base({ now }))).toBe(true)
    expect(reminderDue(base({ now, firedDate: '2026-06-10' }))).toBe(false)
    expect(reminderDue(base({ now, firedDate: '2026-06-09' }))).toBe(true)
  })
  it('is suppressed after a wrap-up today but not yesterday', () => {
    const now = new Date(2026, 5, 10, 17, 45)
    expect(reminderDue(base({ now, wrapupDate: '2026-06-10' }))).toBe(false)
    expect(reminderDue(base({ now, wrapupDate: '2026-06-09' }))).toBe(true)
  })
  it('respects disabled and paused', () => {
    const now = new Date(2026, 5, 10, 17, 45)
    expect(reminderDue(base({ now, enabled: false }))).toBe(false)
    expect(reminderDue(base({ now, paused: true }))).toBe(false)
  })
  it('does not fire for yesterday after a clock jump back past midnight', () => {
    // fired at 17:30 on the 10th; clock is then set back into the same day: still guarded
    expect(reminderDue(base({ now: new Date(2026, 5, 10, 17, 40), firedDate: '2026-06-10' }))).toBe(
      false
    )
  })
})

describe('settings sanitising', () => {
  it('accepts valid partial updates and normalises the hotkey', () => {
    expect(
      sanitizePatch({ hotkey: 'option+space', reminderTime: '09:05', trayEnabled: false })
    ).toEqual({
      hotkey: 'Alt+Space',
      reminderTime: '09:05',
      trayEnabled: false
    })
  })
  it('drops unknown keys', () => {
    expect(sanitizePatch({ evil: 1, __proto__: { x: 1 }, launchAtLogin: true })).toEqual({
      launchAtLogin: true
    })
  })
  it('rejects bad values', () => {
    expect(() => sanitizePatch(null)).toThrow()
    expect(() => sanitizePatch([])).toThrow()
    expect(() => sanitizePatch('x')).toThrow()
    expect(() => sanitizePatch({ hotkey: 'Space' })).toThrow(/shortcut/)
    expect(() => sanitizePatch({ reminderTime: '25:00' })).toThrow(/HH:MM/)
    expect(() => sanitizePatch({ reminderTime: '9:00' })).toThrow(/HH:MM/)
    expect(() => sanitizePatch({ reminderTime: 1730 })).toThrow(/HH:MM/)
    expect(() => sanitizePatch({ hotkeyEnabled: 'yes' })).toThrow(/true or false/)
    expect(() => sanitizePatch({ remindersPaused: 1 })).toThrow(/true or false/)
  })
  it('rebuilds prefs from stored strings and survives corrupt values', () => {
    expect(prefsFromRaw({})).toEqual(DEFAULT_PREFS)
    expect(
      prefsFromRaw({
        'shell.hotkey': 'Cmd+Shift+J',
        'shell.hotkey.enabled': '0',
        'shell.reminder.time': '08:15',
        'shell.reminder.enabled': '0'
      })
    ).toMatchObject({
      hotkey: 'Shift+Command+J',
      hotkeyEnabled: false,
      reminderTime: '08:15',
      reminderEnabled: false
    })
    expect(
      prefsFromRaw({
        'shell.hotkey': 'garbage',
        'shell.reminder.time': '99:99',
        'shell.tray.enabled': 'maybe'
      })
    ).toEqual(DEFAULT_PREFS)
  })
})
