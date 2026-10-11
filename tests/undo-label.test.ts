import { describe, expect, it } from 'vitest'
import { undoLabel } from '../src/main/commands'

describe('undoLabel', () => {
  it('words undone commands for people, never as internal ids', () => {
    expect(undoLabel('task.add')).toBe('adding the task')
    expect(undoLabel('wrapup.complete')).toBe('the wrap-up')
  })
  it('falls back for unknown types', () => {
    expect(undoLabel('nope.never')).toBe('the last change')
  })
})
