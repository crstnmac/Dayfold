import { describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { seedDemo } from '../src/main/demo'
import { dispatch } from '../src/main/commands'
import { parse, type Parsed } from '../src/main/parser'
import { buildState } from '../src/main/state'

const NOW = new Date(2026, 9, 14, 10, 0, 0) // a Wednesday
const db = openDb(':memory:')
seedDemo(db, NOW)

/** What the parser makes of an input, as a short tag. */
function tag(text: string): string {
  const r: Parsed = parse(db, text, NOW)
  if (r.kind === 'commands')
    return r.note === 'unmatched' ? 'inbox' : r.commands.map((c) => c.type).join('+')
  if (r.kind === 'focus') return `focus:${r.focus}`
  return r.kind
}

describe('adding tasks', () => {
  it.each([
    'add buy milk',
    'add task buy milk',
    'todo buy milk',
    'create task buy milk',
    'remind me to call mum',
    'i need to call mum',
    "don't forget to pay rent"
  ])('%s', (t) => expect(tag(t)).toBe('task.add'))

  it('reads a date at the end as a plan date, and "by" as a due date', () => {
    const plan = parse(db, 'add buy milk tomorrow', NOW)
    expect(plan.kind === 'commands' && plan.commands[0]).toMatchObject({
      type: 'task.add',
      title: 'buy milk',
      planDate: '2026-10-15'
    })
    const due = parse(db, 'add send report by friday', NOW)
    expect(due.kind === 'commands' && due.commands[0]).toMatchObject({
      title: 'send report',
      due: '2026-10-16'
    })
  })

  it('files a task in a project and sends "to the inbox" to the inbox', () => {
    const r = parse(db, 'add task review contract to Website redesign', NOW)
    expect(r.kind === 'commands' && r.commands[0]).toMatchObject({
      type: 'task.add',
      title: 'review contract',
      projectId: expect.any(Number)
    })
    expect(tag('add buy milk to the inbox')).toBe('dump.add')
  })

  it('keeps notes as notes', () => {
    expect(tag('add a note on Dayfold 1.0 launch: hello')).toBe('project.note')
  })
})

describe('finishing, starting and reopening', () => {
  it.each([
    'finish the invoice',
    'check off prep questions',
    'tick off the invoice',
    'i finished the invoice',
    "i'm done with the invoice",
    'done: send the October invoice'
  ])('done: %s', (t) => expect(tag(t)).toBe('task.setStatus'))
  it.each(['begin the invoice', 'working on the invoice', 'start the invoice'])('start: %s', (t) =>
    expect(tag(t)).toBe('task.setStatus')
  )
  it('reopens a finished task', () => {
    const r = parse(db, 'reopen Triage overnight support email', NOW)
    expect(r.kind === 'commands' && r.commands[0]).toMatchObject({
      type: 'task.setStatus',
      status: 'todo'
    })
  })
})

describe('planning and due dates', () => {
  it.each([
    'plan the invoice for tomorrow',
    'schedule the invoice for friday',
    'reschedule the invoice to monday',
    'postpone the invoice to next week',
    'do the invoice tomorrow'
  ])('%s', (t) => expect(tag(t)).toBe('task.plan'))
  it('sets a task due date', () => {
    expect(tag('set due date for the invoice to friday')).toBe('task.setDue')
  })
})

describe('projects', () => {
  it.each(['complete project Customer interviews', 'archive Beta onboarding emails'])(
    'finish: %s',
    (t) => expect(tag(t)).toBe('project.setStatus')
  )
  it.each(['resume Conference talk', 'unpause Conference talk', 'mark Conference talk as active'])(
    'reactivate: %s',
    (t) => expect(tag(t)).toBe('project.setStatus')
  )
})

describe('navigation and questions', () => {
  it.each([
    ['show projects', 'focus:projects'],
    ['list my projects', 'focus:projects'],
    ['show my tasks', 'focus:plate'],
    ['show inbox', 'focus:dump'],
    ['open activity', 'focus:activity'],
    ['help', 'answer'],
    ["what's due today", 'answer'],
    ['what is overdue', 'answer'],
    ['how many tasks do I have', 'answer'],
    ['tasks for tomorrow', 'answer']
  ])('%s', (t, expected) => expect(tag(t)).toBe(expected))

  it('answers from the data without changing it', () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM command_log').get() as { n: number }).n
    const r = parse(db, 'what is overdue', NOW)
    expect(r.kind === 'answer' && r.message).toMatch(/overdue: .*Book flights for Lisbon/)
    const c = parse(db, 'how many tasks do I have', NOW)
    expect(c.kind === 'answer' && c.message).toMatch(/to do today · \d+ open in total/)
    expect((db.prepare('SELECT COUNT(*) AS n FROM command_log').get() as { n: number }).n).toBe(
      before
    )
  })
})

describe('safety', () => {
  it('never turns "drop all" into dropping one task', () => {
    expect(tag('drop all')).toBe('answer')
    expect(tag('delete everything')).toBe('answer')
  })
  it('still sends unknown chatter to the inbox', () => {
    expect(tag('thanks')).toBe('inbox')
    expect(tag('idea: snooze to a weekday')).toBe('inbox')
  })
  it('carries the whole day over in one command and can break a task down', () => {
    expect(tag('carry everything to tomorrow')).toBe('day.carryOver')
    expect(tag('break down Fix crash into a, b')).toMatch(/task\.breakDown|choose|inbox/)
  })
  it('applies a parsed add and an undo-able status change end to end', () => {
    const r = parse(db, 'remind me to call mum tomorrow', NOW)
    expect(r.kind).toBe('commands')
    if (r.kind === 'commands')
      for (const c of r.commands) dispatch(db, c, { source: 't', input: 'x' })
    const s = buildState(db, NOW)
    expect(s.tomorrowTasks.some((t) => t.title === 'call mum')).toBe(true)
  })
})
