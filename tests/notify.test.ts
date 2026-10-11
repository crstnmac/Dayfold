import { describe, expect, it } from 'vitest'
import { captureCard, deadlineCard, peekCard, reminderCard } from '../src/shared/notify-logic'

describe('overlay cards', () => {
  it('reminder offers wrap up, snooze and dismiss, and counts open tasks', () => {
    const c = reminderCard(3)
    expect(c.body).toContain('3 tasks are still open')
    expect(c.actions.map((a) => a.id)).toEqual(['wrap', 'snooze', 'dismiss'])
    expect(reminderCard(1).body).toContain('1 task is still open')
    expect(reminderCard(0).body).not.toContain('still open')
  })

  it('capture card only offers Undo when the change can be undone', () => {
    expect(captureCard('Added to Inbox', true).actions.map((a) => a.id)).toEqual(['undo'])
    expect(captureCard('Added to Inbox', false).actions).toEqual([])
  })

  it('deadline card is null when nothing needs attention', () => {
    expect(deadlineCard({ today: '2026-10-11', projects: [], stale: [] })).toBeNull()
  })

  it('deadline card names a single item and summarizes several', () => {
    const one = deadlineCard({
      today: '2026-10-11',
      projects: [{ name: 'Atlas', due: '2026-10-11' }],
      stale: []
    })
    expect(one?.title).toBe('Atlas is due today')
    expect(one?.tab).toBe('projects')
    const many = deadlineCard({
      today: '2026-10-11',
      projects: [{ name: 'Atlas', due: '2026-10-09' }],
      stale: [{ title: 'Write PRD', carried: 4 }]
    })
    expect(many?.title).toBe('2 things need attention')
    expect(many?.lines).toEqual(['Atlas was due 2026-10-09', '“Write PRD” carried 4 times'])
  })

  it('peek card stays until dismissed and skips empty facts', () => {
    const c = peekCard({ open: 0, inbox: 0, nextDue: null })
    expect(c.timeoutMs).toBeNull()
    expect(c.lines).toEqual(['Nothing open today'])
    const d = peekCard({ open: 2, inbox: 4, nextDue: { name: 'Atlas', days: 1 } })
    expect(d.lines).toEqual(['2 open tasks today', '4 in your Inbox', 'Atlas is due tomorrow'])
  })
})
