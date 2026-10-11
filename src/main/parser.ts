import type { DatabaseSync } from 'node:sqlite'
import Fuse from 'fuse.js'
import type { Command, SortMode, UiFocus } from '../shared/types'
import { nextUp } from './next-up'
import { HELP_TEXT, countsAnswer, dueAnswer, tomorrowAnswer, type DuePeriod } from './answers'
import { addDays, parseDate, today } from './dates'

export type Parsed =
  | { kind: 'commands'; commands: Command[]; note?: string }
  | { kind: 'undo' }
  /** A read-only reply; nothing changes. */
  | { kind: 'answer'; message: string }
  | { kind: 'focus'; focus: UiFocus }
  | { kind: 'choose'; question: string; choices: { label: string; command: Command }[] }

interface Named {
  id: number
  name: string
}

type Match<T> = { kind: 'one'; item: T } | { kind: 'many'; items: T[] } | { kind: 'none' }

function fuzzy<T extends Named>(items: T[], query: string): Match<T> {
  const q = query.trim()
  if (!q || items.length === 0) return { kind: 'none' }
  const exact = items.filter((i) => i.name.toLowerCase() === q.toLowerCase())
  if (exact.length === 1) return { kind: 'one', item: exact[0] }
  const fuse = new Fuse(items, {
    keys: ['name'],
    includeScore: true,
    threshold: 0.4,
    ignoreLocation: true
  })
  const hits = fuse.search(q)
  if (hits.length === 0) return { kind: 'none' }
  const [a, b] = hits
  if (hits.length === 1) {
    // a lone weak hit is only auto-applied when every query word is a whole word of the name
    const words = new Set(a.item.name.toLowerCase().split(/\W+/))
    const covered = q
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean)
      .every((w) => words.has(w))
    return covered ? { kind: 'one', item: a.item } : { kind: 'many', items: [a.item] }
  }
  if ((a.score ?? 1) < 0.3 && (!b || (b.score ?? 1) - (a.score ?? 1) > 0.1))
    return { kind: 'one', item: a.item }
  return { kind: 'many', items: hits.slice(0, 5).map((h) => h.item) }
}

const openTasks = (db: DatabaseSync): Named[] =>
  db
    .prepare("SELECT id, title AS name FROM tasks WHERE status IN ('todo','doing')")
    .all() as unknown as Named[]
const projects = (db: DatabaseSync): Named[] =>
  db.prepare('SELECT id, name FROM projects').all() as unknown as Named[]

const dump = (text: string): Parsed => ({
  kind: 'commands',
  commands: [{ type: 'dump.add', text }]
})

const closedTasks = (db: DatabaseSync): Named[] =>
  db
    .prepare(
      "SELECT id, title AS name FROM tasks WHERE status IN ('done','dropped') ORDER BY id DESC LIMIT 300"
    )
    .all() as unknown as Named[]

function viaTask(
  db: DatabaseSync,
  query: string,
  question: string,
  build: (taskId: number) => Command,
  items: Named[] = openTasks(db)
): Parsed | null {
  const m = fuzzy(items, query)
  if (m.kind === 'one') return { kind: 'commands', commands: [build(m.item.id)] }
  if (m.kind === 'many')
    return {
      kind: 'choose',
      question,
      choices: m.items.map((t) => ({ label: t.name, command: build(t.id) }))
    }
  return null
}

function viaProject(
  db: DatabaseSync,
  query: string,
  question: string,
  build: (projectId: number) => Command
): Parsed | null {
  const m = fuzzy(projects(db), query)
  if (m.kind === 'one') return { kind: 'commands', commands: [build(m.item.id)] }
  if (m.kind === 'many')
    return {
      kind: 'choose',
      question,
      choices: m.items.map((p) => ({ label: p.name, command: build(p.id) }))
    }
  return null
}

type Kind = 'task' | 'project' | 'dump'
const allTasks = (db: DatabaseSync): Named[] =>
  db
    .prepare("SELECT id, title AS name FROM tasks WHERE status != 'dropped'")
    .all() as unknown as Named[]
const dumpItems = (db: DatabaseSync): Named[] =>
  db.prepare('SELECT id, text AS name FROM dump WHERE triaged = 0').all() as unknown as Named[]

/**
 * Resolves a name against tasks, projects and dump items (optionally narrowed to one kind) and
 * builds one command per hit. One clear hit applies directly; otherwise the user picks.
 */
function viaAny(
  db: DatabaseSync,
  query: string,
  kind: Kind | null,
  question: string,
  build: Record<Kind, (id: number) => Command>
): Parsed | null {
  const sources: [Kind, Named[]][] = [
    ['task', allTasks(db)],
    ['project', projects(db)],
    ['dump', dumpItems(db)]
  ]
  const hits: { kind: Kind; item: Named; exact: boolean }[] = []
  for (const [k, items] of sources) {
    if (kind && kind !== k) continue
    const m = fuzzy(items, query)
    const exact = (i: Named): boolean => i.name.toLowerCase() === query.trim().toLowerCase()
    if (m.kind === 'one') hits.push({ kind: k, item: m.item, exact: exact(m.item) })
    else if (m.kind === 'many')
      for (const item of m.items) hits.push({ kind: k, item, exact: exact(item) })
  }
  if (hits.length === 0) return null
  const exactHits = hits.filter((h) => h.exact)
  const pick = exactHits.length === 1 ? exactHits : hits
  if (pick.length === 1)
    return { kind: 'commands', commands: [build[pick[0].kind](pick[0].item.id)] }
  const label = (h: { kind: Kind; item: Named }): string =>
    kind ? h.item.name : `${h.kind[0].toUpperCase()}${h.kind.slice(1)}: ${h.item.name}`
  return {
    kind: 'choose',
    question,
    choices: pick.slice(0, 6).map((h) => ({ label: label(h), command: build[h.kind](h.item.id) }))
  }
}

const KIND_WORD = '(?:(task|project|dump(?: item)?|to-?do)\\s+)?'
const kindOf = (w: string | undefined): Kind | null =>
  !w ? null : w.startsWith('project') ? 'project' : w.startsWith('dump') ? 'dump' : 'task'

const strip = (s: string): string => s.replace(/[.!?]+$/, '').trim()
export const MAX_PARSE_INPUT = 2000
export const UNMATCHED = 'unmatched'

const WEEKDAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?'
const TRAILING_DATE = new RegExp(
  `\\s+(?:(by|due|before|until)\\s+|(?:for|on|to)\\s+)?(today|tonight|tomorrow|(?:next\\s+|this\\s+)?${WEEKDAY}|next week|in \\d+ (?:days?|weeks?))$`,
  'i'
)

/**
 * "buy milk tomorrow" -> the title and a plan date; "send report by friday" -> a due date.
 * Only a date at the very end counts, and it must parse as one.
 */
function splitTrailingDate(
  text: string,
  now: Date
): { title: string; planDate?: string; due?: string } {
  const m = text.match(TRAILING_DATE)
  if (!m || m.index === undefined || m.index === 0) return { title: text }
  const date = parseDate(m[2].toLowerCase() === 'tonight' ? 'today' : m[2], now)
  if (!date) return { title: text }
  const title = text.slice(0, m.index).trim()
  return m[1] ? { title, due: date } : { title, planDate: date }
}

const NAV_RE =
  /^(?:show|open|go to|switch to|take me to|view|see|list)(?: me)?(?: (?:the|my))?\s+(projects?|activity|today|inbox|dump|backlog|plate|tasks?|to-?dos?|day)$/i
const NAV_FOCUS: Record<string, UiFocus> = {
  project: 'projects',
  activity: 'activity',
  inbox: 'dump',
  dump: 'dump',
  backlog: 'dump'
}

const NEXT_SHORT = /^(?:what'?s|whats) (?:up )?next\??$/i
const NEXT_QUESTION =
  /^(?:(?:please )?(?:check|show|tell|find|pick|suggest|recommend|decide|give)(?: me)?(?: (?:what|which))?|what|which)\b(?=.*\b(?:tasks?|to-?dos?|things?|stock|do|work|take|tackle|start|focus|priority|important|pick)\b).*\b(?:next|first|top priority|most important|work on|focus on|start with)\b/i

const SORT_RE =
  /^(?:sort|order|rank|arrange|organi[sz]e|prioriti[sz]e)(?: (?:out|up))?(?: (?:my|the|all|these|those|today'?s))*(?: (?:tasks?|to-?dos?|plate|list|day|work|things))?(?: (?:by|on|for|with|using) (?:the )?(due(?: dates?)?|deadlines?|dates?|projects?|newest(?: first)?|latest(?: first)?|recent(?: first)?|priority|urgency|importance|default|normal|original|most carried))?$/i

/** Deterministic rule parser (ADR-005). Anything unmatched becomes a dump item. */
export function parse(db: DatabaseSync, raw: string, now = new Date()): Parsed {
  const text = strip(
    raw
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(please|hey dash|dash)[, ]+/i, '')
  )
  if (!text) return { kind: 'commands', commands: [] }
  if (text.length > MAX_PARSE_INPUT)
    throw new Error(`Input too long (max ${MAX_PARSE_INPUT} characters)`)
  let m: RegExpMatchArray | null

  if (/^undo( that)?$/i.test(text)) return { kind: 'undo' }

  // "sort my tasks" / "sort by due date" / "organize my plate" / "reset the sort"
  if ((m = text.match(SORT_RE))) {
    const how = (m[1] ?? '').toLowerCase()
    const mode: SortMode = /^(?:due|deadline|date)/.test(how)
      ? 'due'
      : /^project/.test(how)
        ? 'project'
        : /^(?:new|latest|recent)/.test(how)
          ? 'newest'
          : /^(?:default|normal|original|carried)/.test(how)
            ? 'default'
            : 'priority'
    return { kind: 'commands', commands: [{ type: 'view.sort', mode }] }
  }
  // "what should I do next" / "check what task I would take next" / "what's my top priority"
  if (NEXT_SHORT.test(text) || NEXT_QUESTION.test(text))
    return { kind: 'answer', message: nextUp(db, now) }
  if (/^(?:reset|clear|undo) (?:the |my )?sort(?:ing)?$/i.test(text))
    return { kind: 'commands', commands: [{ type: 'view.sort', mode: 'default' }] }
  if (
    /^(wrap[ -]?up|end (my |the )?day|plan tomorrow|show tomorrow)( my day| the day)?$/i.test(text)
  )
    return { kind: 'focus', focus: 'wrap' }
  if (/^(what'?s on my plate( today)?|show (my )?(plate|today))$/i.test(text))
    return { kind: 'focus', focus: 'plate' }

  if (/^(?:help|\?|what can (?:i|you) (?:say|do|type)|commands|how does this work)$/i.test(text))
    return { kind: 'answer', message: HELP_TEXT }

  // "show projects" / "open activity" / "go to inbox"
  if ((m = text.match(NAV_RE))) {
    const word = m[1].toLowerCase().replace(/s$/, '')
    return { kind: 'focus', focus: NAV_FOCUS[word] ?? NAV_FOCUS[m[1].toLowerCase()] ?? 'plate' }
  }

  // read-only questions: nothing changes, the answer is the toast
  if (/^(?:what(?:'s| is| are)?|which|show|list|any|how many)\b.*\boverdue\b/i.test(text))
    return { kind: 'answer', message: dueAnswer(db, 'overdue', now) }
  if (
    (m = text.match(
      /^(?:what(?:'s| is| are)?|which|show|list)\b.*\b(?:due|deadlines?)\b.*\b(today|tomorrow|this week|next week)\b/i
    ))
  ) {
    const period = m[1].toLowerCase()
    return {
      kind: 'answer',
      message: dueAnswer(db, (period === 'this week' ? 'week' : period) as DuePeriod, now)
    }
  }
  if (
    /^(?:what(?:'s| is)?(?: on| my| the)*\s*tomorrow|what do i have tomorrow|(?:my |the )?(?:tasks?|to-?dos?|plan) for tomorrow)$/i.test(
      text
    )
  )
    return { kind: 'answer', message: tomorrowAnswer(db, now) }
  if (
    /^how many (?:tasks?|to-?dos?|things)(?: (?:do i have|are (?:left|there|open)|left|remain))?(?: (?:today|to do))?$/i.test(
      text
    )
  )
    return { kind: 'answer', message: countsAnswer(db, now) }
  if (/^(?:what(?:'s| do i have)(?: left)?(?: (?:for|on))? today|what'?s left)$/i.test(text))
    return { kind: 'focus', focus: 'plate' }

  // "add buy milk to the inbox"
  if (
    (m = text.match(
      /^(?:add|put|save|send|jot|dump)\s+(.+?)\s+(?:to|in|into|on)\s+(?:the |my )?(?:inbox|dump|quick dump)$/i
    ))
  )
    return dump(m[1])

  if ((m = text.match(/^dump:?\s+(.+)$/i))) return dump(m[1])

  if ((m = text.match(/^(?:new|create|add) project:?\s+(.+)$/i))) {
    const gm = m[1].match(/^(.+?),?\s+goal:?\s+(.+)$/i)
    let name = gm ? gm[1] : m[1]
    let goal = gm?.[2]
    let due: string | undefined
    const dm = name.match(/,?\s+(?:due|deadline|by)\s+(.+)$/i)
    if (dm) {
      due = parseDate(dm[1], now) ?? undefined
      if (due) name = name.slice(0, dm.index)
    } else if (goal) {
      const gd = goal.match(/,?\s+(?:due|deadline)\s+(.+)$/i)
      if (gd) {
        due = parseDate(gd[1], now) ?? undefined
        if (due) goal = goal.slice(0, gd.index)
      }
    }
    return {
      kind: 'commands',
      commands: [{ type: 'project.create', name: name.replace(/,\s*$/, '').trim(), goal, due }]
    }
  }

  if ((m = text.match(/^note (?:on|for) (.+?):\s*(.+)$/i))) {
    const note = m[2]
    const r = viaProject(db, m[1], 'Which project is the note for?', (projectId) => ({
      type: 'project.note',
      projectId,
      text: note
    }))
    if (r) return r
  }

  if ((m = text.match(/^(?:pause|park) (.+)$/i))) {
    const r = viaProject(db, m[1], 'Pause which project?', (projectId) => ({
      type: 'project.setStatus',
      projectId,
      status: 'paused'
    }))
    if (r) return r
  }

  // Wrap-up verbs. They resolve against open tasks only and never shadow the rules below.
  if ((m = text.match(/^carry (.+?) (?:over )?to tomorrow$/i))) {
    const toDate = addDays(today(now), 1)
    const r = viaTask(db, m[1], 'Carry which task to tomorrow?', (taskId) => ({
      type: 'task.carry',
      taskId,
      toDate
    }))
    if (r) return r
  }

  // never let "drop all" fuzzy-match one task called something like "all"
  if (/^(?:drop|delete|remove) (?:all|everything)(?: tasks?)?$/i.test(text))
    return {
      kind: 'answer',
      message: 'I will not remove everything at once. Say "drop <task>", or use Wrap up.'
    }

  // "delete task X" / "remove the project Y" / "delete X" (asks when X is ambiguous)
  if (
    (m = text.match(new RegExp(`^(?:delete|remove|erase|trash) (?:the )?${KIND_WORD}(.+)$`, 'i')))
  ) {
    const r = viaAny(db, m[2].replace(/^["']|["']$/g, ''), kindOf(m[1]), 'Delete which one?', {
      task: (taskId) => ({ type: 'task.delete', taskId }),
      project: (projectId) => ({ type: 'project.delete', projectId }),
      dump: (dumpId) => ({ type: 'dump.delete', dumpId })
    })
    if (r) return r
  }

  // "rename task X to Y" / "change X to Y" / "edit the project X to Y"
  if (
    (m = text.match(
      new RegExp(
        `^(?:rename|change|edit|update|retitle) (?:the )?${KIND_WORD}(.+?) (?:to|as|into) (.+)$`,
        'i'
      )
    ))
  ) {
    const next = m[3].replace(/^["']|["']$/g, '')
    // Try every " to " split so names containing "to" still work.
    const words = `${m[2]} to ${m[3]}`.split(/ to /i)
    const attempts: [string, string][] = words.map((_, i): [string, string] => [
      words.slice(0, i + 1).join(' to '),
      words.slice(i + 1).join(' to ')
    ])
    attempts.pop()
    attempts.unshift([m[2], next])
    for (const [name, to] of attempts) {
      const r = viaAny(db, name.replace(/^["']|["']$/g, ''), kindOf(m[1]), 'Rename which one?', {
        task: (taskId) => ({ type: 'task.rename', taskId, title: to }),
        project: (projectId) => ({ type: 'project.rename', projectId, name: to }),
        dump: (dumpId) => ({ type: 'dump.edit', dumpId, text: to })
      })
      if (r) return r
    }
  }

  if ((m = text.match(/^drop (.+)$/i))) {
    const r = viaTask(db, m[1], 'Drop which task?', (taskId) => ({ type: 'task.drop', taskId }))
    if (r) return r
  }

  if ((m = text.match(/^defer (.+)$/i))) {
    // Try every " to "/" until " split so task titles containing "to" still work.
    const parts = m[1].split(/ (?:to|until|till) /i)
    for (let i = 1; i < parts.length; i++) {
      const toDate = parseDate(parts.slice(i).join(' to '), now)
      if (!toDate || toDate <= today(now)) continue
      const r = viaTask(db, parts.slice(0, i).join(' to '), 'Defer which task?', (taskId) => ({
        type: 'task.defer',
        taskId,
        toDate
      }))
      if (r) return r
    }
  }

  // "set next action for Atlas to call Sam" / "next action for Atlas: call Sam"
  if (
    (m =
      text.match(/^(?:set )?next action (?:for|on|of) (.+?):\s*(.+)$/i) ??
      text.match(/^set next action (?:for|on|of) (.+)$/i))
  ) {
    const parts = m[2] !== undefined ? [m[1], m[2]] : null
    const attempts: [string, string][] = parts
      ? [[parts[0], parts[1]]]
      : (() => {
          const w = m[1].split(/ to /i)
          return w
            .slice(1)
            .map((_, i): [string, string] => [
              w.slice(0, i + 1).join(' to '),
              w.slice(i + 1).join(' to ')
            ])
        })()
    // A split whose left side is exactly a project name wins over fuzzy guesses.
    const names = new Set(projects(db).map((p) => p.name.toLowerCase()))
    attempts.sort(
      (a, b) => Number(names.has(b[0].toLowerCase())) - Number(names.has(a[0].toLowerCase()))
    )
    for (const [name, next] of attempts) {
      const r = viaProject(db, name, 'Set the next action on which project?', (projectId) => ({
        type: 'project.setNextAction',
        projectId,
        text: next
      }))
      if (r) return r
    }
  }

  // "due Friday: send report" is a task, and takes priority over project-deadline phrasing.
  if ((m = text.match(/^due (.+?):\s*(.+)$/i))) {
    const due = parseDate(m[1], now)
    if (due) return { kind: 'commands', commands: [{ type: 'task.add', title: m[2], due }] }
  }

  // "set deadline for Atlas to Friday" / "deadline Atlas: Friday" / "Atlas is due Friday"
  if (
    (m =
      text.match(/^(?:set )?(?:deadline|due date) (?:for|of|on) (.+?) (?:to|is|as) (.+)$/i) ??
      text.match(/^deadline (.+?):\s*(.+)$/i) ??
      text.match(/^(.+?) (?:deadline|is due|due on|due) (.+)$/i))
  ) {
    const due = parseDate(m[2], now)
    if (due) {
      const r =
        viaProject(db, m[1], 'Set the deadline on which project?', (projectId) => ({
          type: 'project.setDue',
          projectId,
          due
        })) ??
        viaTask(db, m[1], 'Set the due date on which task?', (taskId) => ({
          type: 'task.setDue',
          taskId,
          due
        }))
      if (r) return r
    }
  }

  if (
    (m = text.match(
      /^(?:move|push|plan|schedule|reschedule|postpone|delay|bump|put) (.+?) (?:to|for|until|till|on|by) (.+)$/i
    ))
  ) {
    const date = parseDate(m[2], now)
    if (date) {
      const r = viaTask(db, m[1], 'Move which task?', (taskId) => ({
        type: 'task.plan',
        taskId,
        planDate: date
      }))
      if (r) return r
    }
  }

  // "mark X done": a task or a project; ask if both match.
  if ((m = text.match(/^mark (.+?) (?:as )?done$/i))) {
    const t = viaTask(db, m[1], 'Which task is done?', (taskId) => ({
      type: 'task.setStatus',
      taskId,
      status: 'done'
    }))
    const p = viaProject(db, m[1], 'Mark which project done?', (projectId) => ({
      type: 'project.setStatus',
      projectId,
      status: 'done'
    }))
    if (t && p) {
      const choices = [t, p].flatMap((x) =>
        x.kind === 'commands'
          ? [
              {
                label:
                  x.commands[0].type === 'task.setStatus' ? `Task: ${m![1]}` : `Project: ${m![1]}`,
                command: x.commands[0]
              }
            ]
          : x.kind === 'choose'
            ? x.choices
            : []
      )
      return { kind: 'choose', question: 'Task or project?', choices }
    }
    if (t ?? p) return (t ?? p)!
  }

  // "complete project X" / "archive X": finish a project
  if ((m = text.match(/^(?:complete|finish|close|archive)\s+(?:the\s+)?project\s+(.+)$/i))) {
    const r = viaProject(db, m[1], 'Finish which project?', (projectId) => ({
      type: 'project.setStatus',
      projectId,
      status: 'done'
    }))
    if (r) return r
  }
  if ((m = text.match(/^archive\s+(.+)$/i))) {
    const r = viaProject(db, m[1], 'Archive which project?', (projectId) => ({
      type: 'project.setStatus',
      projectId,
      status: 'done'
    }))
    if (r) return r
  }

  // "resume X" / "unpause X" / "reactivate X": a project goes back to active, else a task is started
  if (
    (m = text.match(
      /^(?:resume|unpause|reactivate|restart|activate|unpark)\s+(?:the\s+)?(?:project\s+)?(.+)$/i
    ))
  ) {
    const r =
      viaProject(db, m[1], 'Resume which project?', (projectId) => ({
        type: 'project.setStatus',
        projectId,
        status: 'active'
      })) ??
      viaTask(db, m[1], 'Resume which task?', (taskId) => ({
        type: 'task.setStatus',
        taskId,
        status: 'doing'
      }))
    if (r) return r
  }

  // "reopen X" / "undone X" / "mark X as not done": a finished task goes back on the list
  if (
    (m =
      text.match(
        /^(?:reopen|re-open|uncomplete|undone|restore|bring back)\s+(?:the\s+)?(?:task\s+)?(.+)$/i
      ) ?? text.match(/^mark (.+?) (?:as )?(?:not done|undone|todo|to-?do|open|incomplete)$/i))
  ) {
    const r =
      viaTask(
        db,
        m[1],
        'Reopen which task?',
        (taskId) => ({ type: 'task.setStatus', taskId, status: 'todo' }),
        closedTasks(db)
      ) ??
      viaProject(db, m[1], 'Reopen which project?', (projectId) => ({
        type: 'project.setStatus',
        projectId,
        status: 'active'
      }))
    if (r) return r
  }

  // "stop X" / "pause X" (a task that is in progress goes back to to-do)
  if ((m = text.match(/^(?:stop|pause|unstart)\s+(?:working on\s+)?(.+)$/i))) {
    const r = viaTask(db, m[1], 'Stop which task?', (taskId) => ({
      type: 'task.setStatus',
      taskId,
      status: 'todo'
    }))
    if (r) return r
  }

  // "mark X as paused|active|started"
  if ((m = text.match(/^mark (.+?) (?:as )?(paused|active|started|in progress|doing)$/i))) {
    const word = m[2].toLowerCase()
    const r =
      word === 'paused' || word === 'active'
        ? viaProject(db, m[1], 'Which project?', (projectId) => ({
            type: 'project.setStatus',
            projectId,
            status: word === 'paused' ? 'paused' : 'active'
          }))
        : viaTask(db, m[1], 'Start which task?', (taskId) => ({
            type: 'task.setStatus',
            taskId,
            status: 'doing'
          }))
    if (r) return r
  }

  // "break down X into a, b and c" (two to five parts)
  if ((m = text.match(/^break(?: down| up)?\s+(.+?)\s+(?:into|as)\s+(.+)$/i))) {
    const titles = m[2]
      .split(/\s*(?:,|;|\band\b)\s*/i)
      .map((t) => t.trim())
      .filter(Boolean)
    if (titles.length >= 2 && titles.length <= 5) {
      const r = viaTask(db, m[1], 'Break down which task?', (taskId) => ({
        type: 'task.breakDown',
        taskId,
        titles
      }))
      if (r) return r
    }
  }

  // "carry everything to tomorrow" / "carry over"
  if (/^carry (?:everything|all|it all|over)(?: (?:over )?to tomorrow)?$/i.test(text))
    return {
      kind: 'commands',
      commands: [{ type: 'day.carryOver', fromDate: today(now), toDate: addDays(today(now), 1) }]
    }

  if (
    (m = text.match(
      /^(?:done with|done|finish(?:ed)?|complete(?:d)?|(?:check|tick|cross) off|knock out|i(?:'m| am|'ve| have)? (?:done|finished|completed)(?: with)?)[:\s]+(.+)$/i
    ))
  ) {
    const r = viaTask(db, m[1], 'Which task is done?', (taskId) => ({
      type: 'task.setStatus',
      taskId,
      status: 'done'
    }))
    if (r) return r
  }
  // "do X tomorrow" / "tackle X friday": a plan date, not a status
  if ((m = text.match(/^(?:do|tackle|handle|schedule|plan)\s+(.+)$/i))) {
    const { title, planDate } = splitTrailingDate(m[1], now)
    if (planDate) {
      const r = viaTask(db, title, 'Plan which task?', (taskId) => ({
        type: 'task.plan',
        taskId,
        planDate
      }))
      if (r) return r
    }
  }
  if ((m = text.match(/^(?:start|begin|work(?:ing)? on|tackle)\s+(.+)$/i))) {
    const r = viaTask(db, m[1], 'Start which task?', (taskId) => ({
      type: 'task.setStatus',
      taskId,
      status: 'doing'
    }))
    if (r) return r
  }

  // "add note on Atlas: ..." is a note, not a task
  if ((m = text.match(/^(?:add|put|write)(?: a)? note (?:on|for|to) (.+?):\s*(.+)$/i))) {
    const note = m[2]
    const r = viaProject(db, m[1], 'Which project is the note for?', (projectId) => ({
      type: 'project.note',
      projectId,
      text: note
    }))
    if (r) return r
  }

  // task creation: "add buy milk tomorrow", "add task X to Atlas", "new task X", "task: X",
  // "remind me to X", "I need to X", "don't forget to X"
  if (
    (m =
      text.match(
        /^(?:(?:add|new|create|make|put)(?: a| an| the| new)?(?: (?:task|todo|to-?do|item|reminder))?:?\s+|(?:todo|to-?do):?\s+|(?:task|reminder):\s*)(?!note\b)(.+)$/i
      ) ??
      text.match(
        /^(?:remind me (?:to|about)|(?:i|we) (?:need|have|got|want|should) to|(?:don'?t|do not) forget(?: to)?|(?:i )?(?:must|gotta))\s+(.+)$/i
      ))
  ) {
    const { title: rest, planDate, due } = splitTrailingDate(m[1].trim(), now)
    let title = rest
    let projectId: number | undefined
    const split = title.match(/^(.+)\s+(?:to|in|for|under)\s+(.+)$/i)
    if (split) {
      const pm = fuzzy(projects(db), split[2])
      if (pm.kind === 'one') {
        title = split[1]
        projectId = pm.item.id
      } else if (pm.kind === 'many') {
        const t = split[1]
        return {
          kind: 'choose',
          question: 'Which project?',
          choices: pm.items.map((p) => ({
            label: p.name,
            command: { type: 'task.add', title: t, projectId: p.id, planDate, due }
          }))
        }
      }
    }
    return { kind: 'commands', commands: [{ type: 'task.add', title, projectId, planDate, due }] }
  }

  // No rule matched: flagged so the optional LLM fallback can take a second look.
  return { kind: 'commands', commands: [{ type: 'dump.add', text }], note: UNMATCHED }
}
