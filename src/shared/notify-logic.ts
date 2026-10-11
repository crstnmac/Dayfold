// Pure builders for the overlay cards, so what each card says is unit-tested without Electron.
import type { NotifyPayload } from './types'

const id = (kind: NotifyPayload['kind']): string => `${kind}-${Date.now()}`

export function reminderCard(open: number): NotifyPayload {
  return {
    id: id('reminder'),
    kind: 'reminder',
    title: 'Time to wrap up your day',
    body:
      open > 0
        ? `${open} ${open === 1 ? 'task is' : 'tasks are'} still open. Review them and plan tomorrow.`
        : 'Review what you finished and plan tomorrow.',
    actions: [
      { id: 'wrap', label: 'Wrap up', primary: true },
      { id: 'snooze', label: 'Snooze 10 min' },
      { id: 'dismiss', label: 'Dismiss' }
    ],
    tab: 'eod',
    timeoutMs: 20000
  }
}

export function captureCard(message: string, undoable: boolean): NotifyPayload {
  return {
    id: id('capture'),
    kind: 'capture',
    title: message,
    actions: undoable ? [{ id: 'undo', label: 'Undo' }] : [],
    timeoutMs: 5000
  }
}

export interface DeadlineFacts {
  /** Active projects due today or earlier. */
  projects: { name: string; due: string }[]
  /** Open tasks carried several times. */
  stale: { title: string; carried: number }[]
  today: string
}

export function deadlineCard(f: DeadlineFacts): NotifyPayload | null {
  const lines = [
    ...f.projects.map((p) =>
      p.due < f.today ? `${p.name} was due ${p.due}` : `${p.name} is due today`
    ),
    ...f.stale.map((t) => `“${t.title}” carried ${t.carried} times`)
  ]
  if (lines.length === 0) return null
  const one = lines.length === 1
  return {
    id: id('deadline'),
    kind: 'deadline',
    title: one ? lines[0] : `${lines.length} things need attention`,
    lines: one ? undefined : lines.slice(0, 3),
    actions: [
      { id: 'open', label: 'Open Dayfold', primary: true },
      { id: 'dismiss', label: 'Dismiss' }
    ],
    tab: f.projects.length > 0 ? 'projects' : 'today',
    timeoutMs: 15000
  }
}

export interface PeekFacts {
  open: number
  inbox: number
  nextDue: { name: string; days: number } | null
}

export function peekCard(f: PeekFacts): NotifyPayload {
  const due = f.nextDue
    ? `${f.nextDue.name} ${f.nextDue.days === 0 ? 'is due today' : f.nextDue.days === 1 ? 'is due tomorrow' : `is due in ${f.nextDue.days} days`}`
    : null
  return {
    id: id('peek'),
    kind: 'peek',
    title: 'Right now',
    lines: [
      f.open === 0
        ? 'Nothing open today'
        : `${f.open} open ${f.open === 1 ? 'task' : 'tasks'} today`,
      ...(f.inbox > 0 ? [`${f.inbox} in your Inbox`] : []),
      ...(due ? [due] : [])
    ],
    actions: [{ id: 'open', label: 'Open Dayfold', primary: true }],
    tab: 'today',
    timeoutMs: null
  }
}
