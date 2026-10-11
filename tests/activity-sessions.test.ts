import { describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { ActivityTracker } from '../src/main/activity'
import { buildDay, type DayRow } from '../src/main/activity-core'
import {
  buildSessions,
  headlineFor,
  suggestTask,
  MIN_SESSION_MS
} from '../src/main/activity-sessions'
import { AppCatalog, prettyBundleId, type CatalogDeps } from '../src/main/app-catalog'

const MIN = 60_000
const T0 = new Date(2026, 9, 10, 9, 0).getTime()
const END = T0 + 24 * 3600_000

let nextId = 1
const row = (fromMin: number, toMin: number, over: Partial<DayRow> = {}): DayRow => ({
  id: nextId++,
  ts: T0 + fromMin * MIN,
  ended_ts: T0 + toMin * MIN,
  app: 'Code',
  bundle_id: 'com.microsoft.VSCode',
  service: 'VS Code',
  category: 'dev',
  kind: 'using',
  detail: '',
  idle: false,
  ...over
})
const sessions = (rows: DayRow[]): ReturnType<typeof buildSessions> =>
  buildSessions(rows, T0, END, T0 + 600 * MIN, null)

describe('buildSessions', () => {
  it('turns consecutive rows of one category into one session', () => {
    const s = sessions([
      row(0, 20),
      row(20, 45, { app: 'Terminal', service: 'Terminal', bundle_id: 'com.apple.Terminal' })
    ])
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ category: 'dev', id: String(T0), activeSeconds: 45 * 60 })
    expect(s[0].apps.map((a) => a.name)).toEqual(['Terminal', 'Code'])
    expect(s[0].headline).toBe('Coding in Terminal and VS Code')
  })

  it('drops stretches shorter than the minimum', () => {
    expect(sessions([row(0, 4)])).toEqual([])
    expect(MIN_SESSION_MS).toBe(5 * MIN)
  })

  it('absorbs a short detour but splits on a long one', () => {
    const slack = { app: 'Slack', service: 'Slack', bundle_id: 'com.slack', category: 'messaging' }
    const brief = sessions([row(0, 20), row(20, 21, slack), row(21, 40)])
    expect(brief).toHaveLength(1)
    expect(brief[0].interruptions).toBe(1)
    expect(brief[0].activeSeconds).toBe(39 * 60) // the detour is not counted as dev time
    const long = sessions([row(0, 20), row(20, 30, slack), row(30, 50)])
    expect(long.map((x) => x.category)).toEqual(['dev', 'messaging', 'dev'])
  })

  it('splits on a pause over five minutes and ignores idle time', () => {
    const s = sessions([row(0, 20), row(30, 50)])
    expect(s).toHaveLength(2)
    const idle = sessions([row(0, 20), row(20, 40, { idle: true }), row(40, 60)])
    expect(idle).toHaveLength(2)
  })

  it('carries thread and document names into the suggestion only when stored', () => {
    const doc = sessions([
      row(0, 30, { category: 'docs', service: 'Google Docs', detail: 'Q3 plan' })
    ])
    expect(doc[0].details).toEqual(['Q3 plan'])
    expect(doc[0].suggestion.title).toBe('Finish Q3 plan')
    const bare = sessions([row(0, 30, { category: 'docs', service: 'Google Docs' })])
    expect(bare[0].suggestion.title).toBe('Continue the document in Google Docs')
  })
})

describe('wording', () => {
  it('headlines read as plain activity', () => {
    expect(headlineFor('email', 'composing', ['Gmail'])).toBe('Writing email in Gmail')
    expect(headlineFor('meeting', '', ['Zoom'])).toBe('In a meeting on Zoom')
    expect(headlineFor('other', '', [])).toBe('Using an app')
  })
  it('suggestions stay within the title limit', () => {
    expect(suggestTask('dev', ['x'], ['y'.repeat(500)]).length).toBeLessThanOrEqual(120)
    expect(suggestTask('email', ['Gmail'], [])).toBe('Follow up on emails in Gmail')
  })
})

describe('buildDay app totals', () => {
  it('groups by app, lists the services used in it and shares sum to one', () => {
    const rows = [
      row(0, 30, {
        app: 'Chrome',
        bundle_id: 'com.google.Chrome',
        service: 'Gmail',
        category: 'email'
      }),
      row(30, 40, {
        app: 'Chrome',
        bundle_id: 'com.google.Chrome',
        service: 'GitHub',
        category: 'dev'
      }),
      row(40, 70)
    ]
    const d = buildDay(rows, T0, END, T0 + 600 * MIN, null)
    expect(d.byApp.map((a) => a.bundleId)).toEqual(['com.google.Chrome', 'com.microsoft.VSCode'])
    expect(d.byApp[0].services.map((s) => s.service)).toEqual(['Gmail', 'GitHub'])
    expect(d.byApp.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1)
    expect(d.byService.find((s) => s.service === 'Gmail')?.bundleId).toBe('com.google.Chrome')
  })
})

describe('AppCatalog', () => {
  const plist = (id: string, extra: object = {}): string =>
    JSON.stringify({ CFBundleIdentifier: id, ...extra })
  const files: Record<string, string[]> = {
    '/Applications': ['Slack.app', 'Adobe', 'notes.txt'],
    '/Applications/Adobe': ['Photoshop.app'],
    '/System/Applications': ['Notes.app', 'Helper.app']
  }
  const plists: Record<string, string> = {
    '/Applications/Slack.app': plist('com.tinyspeck.slackmacgap'),
    '/Applications/Adobe/Photoshop.app': plist('com.adobe.Photoshop'),
    '/System/Applications/Notes.app': plist('com.apple.Notes'),
    '/System/Applications/Helper.app': plist('com.example.helper', { LSUIElement: true })
  }
  const calls: string[] = []
  const deps: CatalogDeps = {
    dirs: ['/Applications', '/System/Applications', '/missing'],
    readDir: async (d) => {
      if (!files[d]) throw new Error('ENOENT')
      return files[d]
    },
    exec: async (cmd, args) => {
      calls.push(cmd)
      if (cmd === '/usr/bin/plutil') {
        const p = plists[args[args.length - 1].replace('/Contents/Info.plist', '')]
        if (!p) throw new Error('no plist')
        return p
      }
      return '/Applications/Elsewhere.app\n' // mdfind
    },
    icon: async (p) => `data:image/png;base64,${Buffer.from(p).toString('base64')}`
  }

  it('lists installed apps, skipping helpers, and looks up names and icons', async () => {
    const c = new AppCatalog(deps)
    const names = (await c.installedApps()).map((a) => a.name)
    expect(names).toEqual(['Notes', 'Photoshop', 'Slack'])
    const [slack, unknown] = await c.info(['com.tinyspeck.slackmacgap', 'com.example.nothing'])
    expect(slack).toMatchObject({ name: 'Slack' })
    expect(slack.icon).toMatch(/^data:image\/png/)
    expect(unknown.name).toBe('Elsewhere') // found through Spotlight
  })

  it('never passes unsafe ids to a process', async () => {
    const c = new AppCatalog(deps)
    calls.length = 0
    const r = await c.info(["x'; rm -rf /; '", 'has space'])
    expect(r).toEqual([])
    expect(calls).toEqual([])
  })

  it('prettifies bundle ids for apps that are not installed', () => {
    expect(prettyBundleId('com.google.Chrome')).toBe('Chrome')
    expect(prettyBundleId('org.keepassxc.keepassxc')).toBe('Keepassxc')
  })
})

describe('session tasks', () => {
  it('links a session to a task, and forgets the link once the task is gone', () => {
    const db = openDb(':memory:')
    const t = new ActivityTracker(db, '/none', () => {})
    db.prepare("INSERT INTO tasks (title, status, created_at) VALUES ('x', 'todo', 1)").run()
    t.linkTask('123', 1)
    const get = (): number | null =>
      (t as unknown as { withTasks: (s: unknown[]) => { taskId: number | null }[] }).withTasks([
        { id: '123' }
      ])[0].taskId
    expect(get()).toBe(1)
    db.prepare('DELETE FROM tasks').run()
    expect(get()).toBeNull()
    expect(() => t.linkTask('abc', 1)).toThrow()
  })
})
