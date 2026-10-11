// Demo Mode: a separate, throwaway database filled with realistic sample data, so the app can be
// shown without touching real data. The mode is a marker file next to the databases (not a
// setting inside either one), read once at startup; switching it relaunches the app.
import type { DatabaseSync } from 'node:sqlite'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DayReview, WrapupDetails, WrapupItem } from '../shared/types'
import { addDays, toISO } from './dates'

export const REAL_DB = 'dash.sqlite'
export const DEMO_DB = 'demo.sqlite'
const FLAG = 'demo-mode'

export const isDemoMode = (userData: string): boolean => existsSync(join(userData, FLAG))

export function setDemoFlag(userData: string, on: boolean): void {
  const flag = join(userData, FLAG)
  if (on) writeFileSync(flag, 'Demo Mode is on. Delete this file to use your own data.\n')
  else rmSync(flag, { force: true })
}

/** Removes the demo database and its WAL files so the next demo starts from fresh data. */
export function removeDemoDb(userData: string): void {
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(join(userData, DEMO_DB + suffix), { force: true })
}

// ------------------------------------------------------------------ seed data

const DAY = 86_400_000
const MIN = 60_000

interface ProjectSeed {
  name: string
  goal: string
  status: 'active' | 'paused' | 'done'
  due: number | null
  next: string
  notes: string
  age: number
}
const PROJECTS: ProjectSeed[] = [
  {
    name: 'Dayfold 1.0 launch',
    goal: 'Ship Dayfold 1.0 to the first 50 beta users',
    status: 'active',
    due: 9,
    next: 'Record the 90-second demo video',
    notes:
      '## Launch checklist\n- [x] Code signing and notarization\n- [x] Release notes for beta 3\n- [ ] Demo video\n- [ ] Landing page copy\n- [ ] Email the waitlist\n\n**Risk:** support load in launch week. Keep Thursday and Friday afternoons free.',
    age: 34
  },
  {
    name: 'Customer interviews',
    goal: 'Talk to 12 users and find the top three workflow gaps',
    status: 'active',
    due: 21,
    next: "Prep questions for Thursday's interview",
    notes:
      '## So far (5 of 12)\n- Most people plan the day in their head and lose it by noon\n- Carry-over guilt is real: they want to *defer on purpose*\n- Two asked for a weekly summary\n\nTemplate: 30 minutes, record with permission, ask about *last time* not hypotheticals.',
    age: 21
  },
  {
    name: 'Website redesign',
    goal: 'Landing page that explains Dayfold in ten seconds',
    status: 'active',
    due: 14,
    next: 'Draft the hero copy',
    notes: 'Direction: calm, lots of whitespace, one product screenshot above the fold.',
    age: 18
  },
  {
    name: 'Admin and finances',
    goal: 'Keep invoices, taxes and renewals out of my head',
    status: 'active',
    due: 5,
    next: 'Pay the estimated tax installment',
    notes: 'Accountant is Dana. Receipts go in the shared folder by the 3rd of each month.',
    age: 60
  },
  {
    name: 'Conference talk: local-first apps',
    goal: 'Get accepted at the Lisbon dev conference',
    status: 'paused',
    due: 40,
    next: 'Write the 150-word abstract',
    notes: 'Paused until the launch is out. CFP closes in six weeks.',
    age: 12
  },
  {
    name: 'Beta onboarding emails',
    goal: 'A three-email welcome sequence for beta users',
    status: 'done',
    due: -6,
    next: '',
    notes: 'Shipped. Open rate on email 1 was 71%.',
    age: 28
  }
]

interface TaskSeed {
  title: string
  project: number | null
  status?: 'todo' | 'doing' | 'done' | 'dropped'
  /** Days from today. */
  due?: number
  plan?: number
  carry?: number
  /** Days ago the task was finished (done only). */
  doneAgo?: number
  hour?: number
}
const TASKS: TaskSeed[] = [
  // finished in the past days
  {
    title: 'Fix crash when restoring a backup from an older version',
    project: 0,
    status: 'done',
    doneAgo: 5,
    hour: 16
  },
  {
    title: 'Interview: Priya (product designer)',
    project: 1,
    status: 'done',
    doneAgo: 5,
    hour: 11
  },
  { title: 'Write release notes for beta 3', project: 0, status: 'done', doneAgo: 4, hour: 15 },
  { title: 'Pay the contractor invoice', project: 3, status: 'done', doneAgo: 4, hour: 10 },
  {
    title: 'Set up code signing and notarization',
    project: 0,
    status: 'done',
    doneAgo: 3,
    hour: 17,
    carry: 2
  },
  {
    title: 'Interview: Tom (engineering manager)',
    project: 1,
    status: 'done',
    doneAgo: 3,
    hour: 13
  },
  {
    title: 'Polish the capture hotkey animation',
    project: 0,
    status: 'done',
    doneAgo: 2,
    hour: 14
  },
  { title: 'Sketch three hero layouts in Figma', project: 2, status: 'done', doneAgo: 2, hour: 11 },
  {
    title: 'Run the full e2e suite on a clean Mac',
    project: 0,
    status: 'done',
    doneAgo: 1,
    hour: 15
  },
  { title: 'Reconcile September receipts', project: 3, status: 'done', doneAgo: 1, hour: 10 },
  {
    title: 'Send beta invite to the 20 waitlist leads',
    project: 0,
    status: 'done',
    doneAgo: 1,
    hour: 17
  },
  // finished today
  { title: 'Triage overnight support email', project: 0, status: 'done', doneAgo: 0 },
  { title: 'Update the roadmap doc', project: 0, status: 'done', doneAgo: 0 },
  // today's plate
  { title: 'Record the 90-second demo video', project: 0, status: 'doing', due: 2, plan: 0 },
  { title: 'Reply to beta feedback from Marcus', project: 0, plan: 0 },
  { title: "Prep questions for Thursday's interview", project: 1, plan: 0 },
  { title: 'Send the October invoice to Northwind', project: 3, due: 0, plan: 0 },
  { title: 'Review PR: weekly summary export', project: 0, plan: -1, carry: 1 },
  { title: 'Book flights for Lisbon', project: 4, due: -1, plan: -3, carry: 3 },
  // tomorrow
  { title: 'Interview: Marcus (operations lead)', project: 1, plan: 1 },
  { title: 'Launch readiness sync', project: 0, plan: 1 },
  { title: 'Export the demo screenshots at 2x', project: 2, plan: 1 },
  // backlog
  { title: 'Draft the landing page hero copy', project: 2, due: 6 },
  { title: 'Pick three testimonials for the website', project: 2 },
  { title: 'Pay the estimated tax installment', project: 3, due: 4 },
  { title: 'Renew the dayfold.app domain', project: 3, due: 12 },
  { title: 'Write the conference abstract', project: 4 },
  { title: 'Compare privacy-friendly analytics options', project: 0 },
  { title: 'Book a dentist appointment', project: null },
  { title: 'Build a Windows version', project: 0, status: 'dropped' }
]

const DUMP = [
  'idea: let me snooze a task to a specific weekday from the wrap-up screen',
  'ask Dana whether the home-office deduction changed this year',
  'beta user said the capture bar disappears on the second monitor',
  'read the local-first software essay before writing the talk abstract',
  'gift for mum, birthday on the 24th'
]

interface Spec {
  app: string
  bundleId: string
  service: string
  category: string
  kind: string
  detail?: string
  url?: string
}
const CHROME = { app: 'Google Chrome', bundleId: 'com.google.Chrome' }
const SPEC = {
  code: (detail: string): Spec => ({
    app: 'Code',
    bundleId: 'com.microsoft.VSCode',
    service: 'VS Code',
    category: 'dev',
    kind: 'coding',
    detail
  }),
  term: {
    app: 'Terminal',
    bundleId: 'com.apple.Terminal',
    service: 'Terminal',
    category: 'dev',
    kind: 'using'
  },
  github: (detail: string): Spec => ({
    ...CHROME,
    service: 'GitHub',
    category: 'dev',
    kind: 'reviewing',
    detail,
    url: 'github.com'
  }),
  claude: {
    app: 'Claude',
    bundleId: 'com.anthropic.claudefordesktop',
    service: 'Claude',
    category: 'ai',
    kind: 'chatting with AI'
  },
  slack: (detail: string): Spec => ({
    app: 'Slack',
    bundleId: 'com.tinyspeck.slackmacgap',
    service: 'Slack',
    category: 'messaging',
    kind: 'messaging',
    detail
  }),
  gmail: (kind: string, detail = ''): Spec => ({
    ...CHROME,
    service: 'Gmail',
    category: 'email',
    kind,
    detail,
    url: 'mail.google.com'
  }),
  zoom: {
    app: 'zoom.us',
    bundleId: 'us.zoom.xos',
    service: 'Zoom',
    category: 'meeting',
    kind: 'in a call'
  },
  figma: {
    app: 'Figma',
    bundleId: 'com.figma.Desktop',
    service: 'Figma',
    category: 'work',
    kind: 'designing'
  },
  linear: {
    ...CHROME,
    service: 'Linear',
    category: 'work',
    kind: 'triaging',
    url: 'linear.app'
  } as Spec,
  notion: (detail: string): Spec => ({
    app: 'Notion',
    bundleId: 'notion.id',
    service: 'Notion',
    category: 'docs',
    kind: 'writing',
    detail
  }),
  docs: (detail: string): Spec => ({
    ...CHROME,
    service: 'Google Docs',
    category: 'docs',
    kind: 'writing',
    detail,
    url: 'docs.google.com'
  }),
  youtube: {
    ...CHROME,
    service: 'YouTube',
    category: 'media',
    kind: 'watching',
    url: 'youtube.com'
  } as Spec,
  hn: {
    ...CHROME,
    service: 'Hacker News',
    category: 'social',
    kind: 'reading',
    url: 'news.ycombinator.com'
  } as Spec
}

/** One work block: a main activity with brief detours, starting at `h` hours. */
interface Block {
  h: number
  min: number
  main: Spec
  detours?: Spec[]
}
const WORKDAY: Block[] = [
  { h: 8.5, min: 25, main: SPEC.gmail('triaging'), detours: [SPEC.slack('#beta-feedback')] },
  { h: 9.0, min: 20, main: SPEC.linear, detours: [SPEC.slack('Priya Nair')] },
  {
    h: 9.5,
    min: 85,
    main: SPEC.code('capture-bar.tsx'),
    detours: [SPEC.term, SPEC.claude, SPEC.hn]
  },
  {
    h: 11.25,
    min: 35,
    main: SPEC.github('Pull request: weekly summary export'),
    detours: [SPEC.slack('#eng')]
  },
  { h: 12.0, min: 30, main: SPEC.zoom },
  { h: 14.0, min: 60, main: SPEC.figma, detours: [SPEC.slack('Marcus Lee'), SPEC.youtube] },
  {
    h: 15.25,
    min: 45,
    main: SPEC.docs('Customer interview notes'),
    detours: [SPEC.gmail('reading')]
  },
  { h: 16.25, min: 40, main: SPEC.code('wrapup-flow.tsx'), detours: [SPEC.term, SPEC.claude] },
  { h: 17.0, min: 15, main: SPEC.notion('Launch checklist') }
]
const WEEKEND: Block[] = [
  { h: 10.0, min: 55, main: SPEC.code('demo.ts'), detours: [SPEC.term, SPEC.claude] },
  { h: 11.25, min: 30, main: SPEC.notion('Conference talk outline'), detours: [SPEC.hn] }
]

/** Deterministic pseudo-random numbers so the demo looks the same every time it is enabled. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedActivity(db: DatabaseSync, now: number): void {
  const ins = db.prepare(
    `INSERT INTO activity (ts, ended_ts, app, bundle_id, title, idle, service, category, kind, detail, url)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
  // Today is squeezed into the part of the day that has already happened, so the demo shows
  // activity at any hour instead of an empty day when it is opened early.
  let remap = (t: number): number => t
  const put = (s: Spec, ts: number, end: number, idle = false): void => {
    ts = Math.round(remap(ts))
    end = Math.min(Math.round(remap(end)), now)
    if (end - ts < 1000) return
    ins.run(
      ts,
      end,
      s.app,
      s.bundleId,
      '',
      idle ? 1 : 0,
      idle ? '' : s.service,
      idle ? 'other' : s.category,
      idle ? '' : s.kind,
      idle ? '' : (s.detail ?? ''),
      idle ? '' : (s.url ?? '')
    )
  }
  const d0 = new Date(now)
  for (let back = 6; back >= 0; back--) {
    const dayStart = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - back)
    const dow = dayStart.getDay()
    const blocks = dow === 0 || dow === 6 ? WEEKEND : WORKDAY
    const rand = rng(1000 + back * 97)
    remap = (t) => t
    if (back === 0) {
      const dayMs = dayStart.getTime()
      const origLo = dayMs + Math.min(...blocks.map((b) => b.h)) * 60 * MIN - 20 * MIN
      const origHi = dayMs + Math.max(...blocks.map((b) => b.h + b.min / 60)) * 60 * MIN + 30 * MIN
      const hi = now - 2 * MIN
      if (hi < origHi) {
        const lo = Math.min(origLo, Math.max(dayMs, hi - 90 * MIN))
        remap = (t) => lo + ((t - origLo) * (hi - lo)) / (origHi - origLo)
      }
    }
    for (const b of blocks) {
      // jitter so no two days look identical
      let t = dayStart.getTime() + (b.h + (rand() - 0.5) * 0.3) * 60 * MIN
      const end = t + b.min * (0.85 + rand() * 0.3) * MIN
      while (t < end) {
        const detour =
          b.detours && rand() < 0.28 ? b.detours[Math.floor(rand() * b.detours.length)] : null
        const len = detour ? (1 + rand() * 2.5) * MIN : (4 + rand() * 10) * MIN
        const spec = detour ?? b.main
        const e = Math.min(t + len, end)
        put(spec, Math.round(t), Math.round(e))
        t = e
      }
    }
    // lunch break: idle
    const lunch = dayStart.getTime() + 12.6 * 60 * MIN
    if (dow !== 0 && dow !== 6) put(SPEC.slack(''), lunch, lunch + 50 * MIN, true)
  }
}

const item = (title: string, project: string | null, to?: string): WrapupItem => ({
  title,
  project,
  ...(to ? { to } : {})
})

export function seedDemo(db: DatabaseSync, nowDate = new Date()): void {
  const now = nowDate.getTime()
  const todayIso = toISO(nowDate)
  const startOfDay = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate()
  ).getTime()
  const dayIso = (offset: number): string => addDays(todayIso, offset)
  const put = (key: string, value: string): void => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  }
  db.exec('BEGIN')
  try {
    // projects
    const projectIds: number[] = []
    const insP = db.prepare(
      `INSERT INTO projects (name, goal, status, next_action, notes, created_at, touched_at, due)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    PROJECTS.forEach((p, i) => {
      const r = insP.run(
        p.name,
        p.goal,
        p.status,
        p.next,
        p.notes,
        now - p.age * DAY,
        now - i * 3 * 3_600_000,
        p.due === null ? null : dayIso(p.due)
      )
      projectIds.push(Number(r.lastInsertRowid))
    })

    // tasks
    const insT = db.prepare(
      `INSERT INTO tasks (title, project_id, status, due, plan_date, carry_count, created_at, done_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    const doneByDay = new Map<number, WrapupItem[]>()
    const taskIds = new Map<string, number>()
    let todayDone = 0
    TASKS.forEach((t, i) => {
      const status = t.status ?? 'todo'
      let doneAt: number | null = null
      if (status === 'done') {
        const ago = t.doneAgo ?? 0
        doneAt =
          ago === 0
            ? Math.max(startOfDay + MIN, now - ++todayDone * 25 * MIN)
            : startOfDay - ago * DAY + (t.hour ?? 12) * 3_600_000
        if (ago > 0)
          doneByDay.set(ago, [
            ...(doneByDay.get(ago) ?? []),
            item(t.title, t.project === null ? null : PROJECTS[t.project].name)
          ])
      }
      const r = insT.run(
        t.title,
        t.project === null ? null : projectIds[t.project],
        status,
        t.due === undefined ? null : dayIso(t.due),
        t.plan === undefined ? null : dayIso(t.plan),
        t.carry ?? 0,
        now - (30 - i) * 8 * 3_600_000,
        doneAt
      )
      taskIds.set(t.title, Number(r.lastInsertRowid))
    })

    // inbox
    const insD = db.prepare('INSERT INTO dump (text, created_at, triaged) VALUES (?,?,0)')
    DUMP.forEach((text, i) => insD.run(text, now - (i * 70 + 12) * MIN))

    // wrap-ups for the last six days: a streak to show off
    const insW = db.prepare(
      `INSERT INTO wrapups (date, completed, carried, dropped, deferred, note, created_at, details)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    const notes: Record<number, string> = {
      1: 'Good day. E2E is green, so launch is unblocked.',
      2: 'Hotkey animation finally feels right.',
      3: 'Signing took longer than planned, but it is done.',
      4: '',
      5: 'Two interviews back to back. Tiring but useful.',
      6: ''
    }
    for (let ago = 1; ago <= 6; ago++) {
      const done = doneByDay.get(ago) ?? [item('Inbox zero', null)]
      const carried =
        ago === 1 ? [item('Review PR: weekly summary export', 'Dayfold 1.0 launch', todayIso)] : []
      const deferred =
        ago === 3
          ? [item('Book flights for Lisbon', 'Conference talk: local-first apps', dayIso(-1))]
          : []
      const dropped = ago === 4 ? [item('Build a Windows version', 'Dayfold 1.0 launch')] : []
      const details: WrapupDetails = {
        done,
        carried,
        deferred,
        dropped,
        tomorrow: [item('Record the 90-second demo video', 'Dayfold 1.0 launch', dayIso(1 - ago))]
      }
      insW.run(
        dayIso(-ago),
        done.length,
        carried.length,
        dropped.length,
        deferred.length,
        notes[ago] ?? '',
        startOfDay - (ago - 1) * DAY - 2 * 3_600_000,
        JSON.stringify(details)
      )
    }
    put('wrapup.lastDate', dayIso(-1))

    // activity and settings
    seedActivity(db, now)
    put('activity.enabled', '1')
    put('activity.detail', '1')
    put('activity.snippets', '0')

    // a saved AI review for yesterday, so the Activity tab shows one without calling a model
    const review: DayReview = {
      date: dayIso(-1),
      generatedAt: startOfDay - 2 * 3_600_000,
      summary:
        'A focused build day: most of the morning went into the capture bar, then the afternoon into a clean end-to-end run and beta invites. Slack and email stayed mostly out of the way.',
      done: [
        { text: 'Ran the full e2e suite and fixed the failures it found', sessionIds: [] },
        { text: 'Sent beta invites to the waitlist', sessionIds: [] }
      ],
      missed: [
        {
          title: 'Reply to the beta tester who reported the second-monitor bug',
          reason: 'A Slack thread about it stayed open after the call.',
          sessionIds: [],
          taskId: null,
          key: 'demo-missed-1'
        }
      ],
      untouched: [
        {
          taskId: taskIds.get('Review PR: weekly summary export') ?? 0,
          title: 'Review PR: weekly summary export',
          reason: 'Planned for yesterday, but only the pull request list was opened.'
        }
      ],
      sessionNotes: {}
    }
    put(`activity.review.${review.date}`, JSON.stringify(review))
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
