import { describe, expect, it } from 'vitest'
import { friendlyDate } from '../src/renderer/src/lib/iso-date'

describe('friendlyDate', () => {
  const today = '2026-10-14' // a Wednesday
  it('names the days around today', () => {
    expect(friendlyDate('2026-10-14', today)).toBe('today')
    expect(friendlyDate('2026-10-15', today)).toBe('tomorrow')
    expect(friendlyDate('2026-10-13', today)).toBe('yesterday')
  })
  it('uses a weekday inside the next week and a date beyond it', () => {
    expect(friendlyDate('2026-10-16', today)).toMatch(/^\w{3}/)
    expect(friendlyDate('2026-10-16', today)).not.toMatch(/\d/)
    expect(friendlyDate('2026-10-24', today)).toMatch(/24/)
    expect(friendlyDate('2026-10-01', today)).toMatch(/1/)
  })
  it('adds the year only when it differs', () => {
    expect(friendlyDate('2027-01-05', today)).toMatch(/2027/)
    expect(friendlyDate('2026-12-05', today)).not.toMatch(/2026/)
  })
  it('leaves non-dates alone', () => {
    expect(friendlyDate('soon', today)).toBe('soon')
  })
})
