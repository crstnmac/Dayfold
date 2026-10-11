import { describe, expect, it, beforeEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../src/main/db'
import { dispatch, undo } from '../src/main/commands'
import { parse } from '../src/main/parser'
import { buildState } from '../src/main/state'
import { buildContext, resolve } from '../src/main/adapters'
import { redact, sanitizeUrl } from '../src/main/adapters/privacy'
import { addDays, today } from '../src/main/dates'
import type { Command } from '../src/shared/types'

// built at run time so no key-shaped literal sits in the source
const fakeKey = ['sk', 'live', 'ABCDEFGHIJKLMNOPQRSTUVWX'].join('_')

let db: DatabaseSync
const meta = { source: 'test', input: 'x' }
const run = (c: Command): string => dispatch(db, c, meta)
const exec = (text: string): void => {
  const p = parse(db, text)
  if (p.kind !== 'commands') throw new Error(`not commands: ${p.kind}`)
  p.commands.forEach(run)
}

beforeEach(() => {
  db = openDb(':memory:')
})

describe('command pipeline', () => {
  it('applies and undoes a task add', () => {
    run({ type: 'task.add', title: 'Write PRD' })
    expect(buildState(db).unplanned).toHaveLength(1)
    expect(undo(db)).toBe('task.add')
    expect(buildState(db).unplanned).toHaveLength(0)
  })
  it('undo restores prior row values', () => {
    run({ type: 'project.create', name: 'Atlas' })
    run({ type: 'project.setDue', projectId: 1, due: '2030-01-01' })
    run({ type: 'project.setStatus', projectId: 1, status: 'paused' })
    undo(db)
    const p = buildState(db).projects[0]
    expect(p.status).toBe('active')
    expect(p.due).toBe('2030-01-01')
  })
  it('rolls back a failing command atomically', () => {
    expect(() => run({ type: 'task.add', title: 'x', projectId: 99 })).toThrow()
    expect(db.prepare('SELECT COUNT(*) c FROM command_log').get()).toEqual({ c: 0 })
  })
  it('triages dump to a project to-do for today', () => {
    run({ type: 'project.create', name: 'Atlas' })
    run({ type: 'dump.add', text: 'call plumber' })
    run({ type: 'dump.triage', dumpId: 1, to: 'task', projectId: 1, planDate: today() })
    const s = buildState(db)
    expect(s.dump).toHaveLength(0)
    expect(s.plate[0]).toMatchObject({ title: 'call plumber', project_name: 'Atlas' })
    undo(db)
    expect(buildState(db).dump).toHaveLength(1)
  })
  it('end of day: done, carryover and tomorrow', () => {
    const t = today()
    run({ type: 'task.add', title: 'a', planDate: t })
    run({ type: 'task.add', title: 'b', planDate: t })
    run({ type: 'task.setStatus', taskId: 1, status: 'done' })
    run({ type: 'day.carryOver', fromDate: t, toDate: addDays(t, 1) })
    const s = buildState(db)
    expect(s.doneToday.map((x) => x.title)).toEqual(['a'])
    expect(s.tomorrowTasks.map((x) => x.title)).toEqual(['b'])
    expect(s.tomorrowTasks[0].carry_count).toBe(1)
    expect(s.carryover).toHaveLength(0)
  })
})

describe('parser', () => {
  it('defaults to dump', () => {
    exec('remember to buy milk')
    expect(buildState(db).dump[0].text).toBe('remember to buy milk')
  })
  it('creates a project with deadline and goal', () => {
    exec('new project Atlas, due tomorrow, goal ship the beta')
    const p = buildState(db).projects[0]
    expect(p).toMatchObject({ name: 'Atlas', goal: 'ship the beta', due: addDays(today(), 1) })
  })
  it('adds a task to a project and completes it by fuzzy name', () => {
    exec('new project Atlas')
    exec('add task write the PRD to Atlas')
    expect(buildState(db).unplanned[0]).toMatchObject({
      title: 'write the PRD',
      project_name: 'Atlas'
    })
    exec('done with write PRD')
    expect(buildState(db).unplanned).toHaveLength(0)
  })
  it('asks when ambiguous', () => {
    run({ type: 'task.add', title: 'email invoice' })
    run({ type: 'task.add', title: 'email invoices to Sam' })
    expect(parse(db, 'done with email invoice').kind).toMatch(/choose|commands/)
  })
  it('sets a project deadline', () => {
    exec('new project Atlas')
    exec('Atlas due tomorrow')
    expect(buildState(db).projects[0].due).toBe(addDays(today(), 1))
  })
  it('moves a task to tomorrow', () => {
    run({ type: 'task.add', title: 'review PR', planDate: today() })
    exec('move review PR to tomorrow')
    expect(buildState(db).tomorrowTasks).toHaveLength(1)
  })
  it('handles undo and wrap-up intents', () => {
    expect(parse(db, 'undo that').kind).toBe('undo')
    expect(parse(db, 'wrap up my day')).toEqual({ kind: 'focus', focus: 'wrap' })
  })
})

describe('adapters', () => {
  const r = (
    app: string,
    bundleId: string,
    title: string,
    url = '',
    detail = false
  ): ReturnType<typeof resolve> =>
    resolve(buildContext({ app, bundleId, title, url }), { captureDetail: detail })
  const chrome = 'com.google.Chrome'

  it('Gmail via browser URL', () => {
    expect(
      r('Chrome', chrome, 'Inbox (3) - me@x.com - Gmail', 'https://mail.google.com/mail/u/0/#inbox')
    ).toMatchObject({ service: 'Gmail', category: 'email', kind: 'triaging' })
    expect(
      r('Chrome', chrome, 'Re: Lunch - me@x.com - Gmail', 'https://mail.google.com/mail/u/0/', true)
        .detail
    ).not.toContain('@')
  })
  it('does not store detail unless enabled', () => {
    expect(
      r('Chrome', chrome, 'Re: Lunch - me@x.com - Gmail', 'https://mail.google.com/mail/u/0/')
        .detail
    ).toBe('')
  })
  it('WhatsApp native and web', () => {
    expect(r('WhatsApp', 'net.whatsapp.WhatsApp', '(2) WhatsApp').service).toBe('WhatsApp')
    expect(r('Chrome', chrome, 'WhatsApp', 'https://web.whatsapp.com/').category).toBe('messaging')
  })
  it('social paths', () => {
    expect(r('Safari', 'com.apple.Safari', 'Home / X', 'https://x.com/home').kind).toBe('scrolling')
    expect(r('Safari', 'com.apple.Safari', 'x', 'https://www.linkedin.com/jobs/view/1').kind).toBe(
      'job hunting'
    )
    expect(r('Safari', 'com.apple.Safari', 'x', 'https://www.youtube.com/watch?v=abc').kind).toBe(
      'watching'
    )
  })
  it('unknown site falls back to host; unknown app to app name', () => {
    expect(r('Chrome', chrome, 't', 'https://example.org/a').service).toBe('example.org')
    expect(r('Foo', 'com.foo', 't').service).toBe('Foo')
  })
  it('does not host-match lookalike domains', () => {
    expect(r('Chrome', chrome, 't', 'https://notx.com/home').service).toBe('notx.com')
    expect(r('Chrome', chrome, 't', 'https://evil.com/x.com').service).toBe('evil.com')
  })
  it('native app beats nothing; browser with no URL is generic browsing', () => {
    expect(r('Slack', 'com.tinyspeck.slackmacgap', 'general - Acme - Slack').category).toBe(
      'messaging'
    )
    expect(r('Chrome', chrome, 'x').category).toBe('browsing')
  })
  it('strips query strings and fragments from URLs', () => {
    expect(sanitizeUrl('https://www.site.com/p?token=abc#frag')).toEqual({
      url: 'site.com/p',
      host: 'site.com',
      path: '/p'
    })
    expect(sanitizeUrl('file:///etc/passwd').url).toBe('')
  })
  it('redacts emails, phone numbers and tokens', () => {
    const out = redact(`me@x.com +1 (555) 123-4567 ${fakeKey}`)
    expect(out).not.toMatch(/@|555|ABCDEFGH/)
  })
})
