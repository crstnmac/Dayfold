export type ISODate = string // YYYY-MM-DD, local time

/**
 * How task lists are ordered. `default` keeps the most-carried first; `priority` puts overdue and
 * due-today work first, then in-progress, then what is due soonest.
 */
export type SortMode = 'default' | 'priority' | 'due' | 'project' | 'newest'

export type TaskStatus = 'todo' | 'doing' | 'done' | 'dropped'
export type ProjectStatus = 'active' | 'paused' | 'done'

export interface DumpItem {
  id: number
  text: string
  created_at: number
}
export interface Project {
  id: number
  name: string
  goal: string
  status: ProjectStatus
  due: ISODate | null
  next_action: string
  notes: string
  created_at: number
  touched_at: number
  open_tasks: number
}
export interface Task {
  id: number
  title: string
  project_id: number | null
  project_name: string | null
  status: TaskStatus
  due: ISODate | null
  plan_date: ISODate | null
  carry_count: number
  done_at: number | null
}

export type Command =
  | { type: 'dump.add'; text: string }
  | {
      type: 'dump.triage'
      dumpId: number
      to: 'task' | 'discard'
      projectId?: number
      planDate?: ISODate
    }
  | { type: 'project.create'; name: string; goal?: string; due?: ISODate }
  | { type: 'project.setDue'; projectId: number; due: ISODate | null }
  | { type: 'project.setStatus'; projectId: number; status: ProjectStatus }
  | { type: 'project.note'; projectId: number; text: string }
  | { type: 'task.add'; title: string; projectId?: number; due?: ISODate; planDate?: ISODate }
  | { type: 'task.setStatus'; taskId: number; status: TaskStatus }
  | { type: 'task.plan'; taskId: number; planDate: ISODate }
  | { type: 'day.carryOver'; fromDate: ISODate; toDate: ISODate }
  /** Wrap-up: plan for `toDate` (a future day) and count one more carry. */
  | { type: 'task.carry'; taskId: number; toDate: ISODate }
  /** Wrap-up: reschedule to `toDate` as a deliberate choice; resets carry_count to 0. */
  | { type: 'task.defer'; taskId: number; toDate: ISODate }
  | { type: 'task.drop'; taskId: number }
  /** Replaces the task with 1-5 subtasks in the same project; the original is dropped. */
  | { type: 'task.breakDown'; taskId: number; titles: string[] }
  | { type: 'wrapup.complete'; date: ISODate; note?: string }
  | { type: 'project.setNextAction'; projectId: number; text: string }
  | { type: 'project.setGoal'; projectId: number; text: string }
  /** Replaces the notes. `expected` (optional) guards against overwriting a newer edit. */
  | { type: 'project.setNotes'; projectId: number; notes: string; expected?: string }
  | { type: 'task.rename'; taskId: number; title: string }
  | { type: 'task.setDue'; taskId: number; due: ISODate | null }
  | { type: 'task.delete'; taskId: number }
  | { type: 'project.rename'; projectId: number; name: string }
  /** Tasks in the project are kept and become unassigned. */
  | { type: 'project.delete'; projectId: number }
  /** Orders every task list. Saved, so it stays until changed. */
  | { type: 'view.sort'; mode: SortMode }
  | { type: 'dump.edit'; dumpId: number; text: string }
  | { type: 'dump.delete'; dumpId: number }

export type UiFocus = 'dump' | 'projects' | 'plate' | 'wrap' | 'activity'

export interface InputResult {
  ok: boolean
  message: string
  undoable: boolean
  focus?: UiFocus
  /** Present when the input matched several candidates; user picks one. */
  choices?: { label: string; command: Command }[]
}

export interface AppState {
  /** How the task lists below are ordered. */
  sort: SortMode
  now: number
  today: ISODate
  tomorrow: ISODate
  dump: DumpItem[]
  projects: Project[]
  /** Today's plate: planned for today, plus overdue/carried-in open tasks. */
  plate: Task[]
  /** End of day: finished today. */
  doneToday: Task[]
  /** End of day: open tasks that were planned for today or earlier and will carry. */
  carryover: Task[]
  /** End of day: follow-up already planned for tomorrow. */
  tomorrowTasks: Task[]
  /** Open tasks with no plan date yet (backlog). */
  unplanned: Task[]
  /** Every open task (capped), for per-project lists. */
  openTasks: Task[]
  /** Past wrap-up summaries, newest first (capped). */
  wrapups: Wrapup[]
  /** Consecutive days with a wrap-up, ending today (or yesterday if today's isn't done yet). */
  wrapupStreak: number
}

/** One task as it was resolved in a wrap-up. `to` is the day it was moved to, when it was moved. */
export interface WrapupItem {
  title: string
  project: string | null
  to?: ISODate
}
/** What a wrap-up actually did, saved when it was completed. */
export interface WrapupDetails {
  done: WrapupItem[]
  carried: WrapupItem[]
  deferred: WrapupItem[]
  dropped: WrapupItem[]
  /** What was lined up for the next day when the wrap-up finished. */
  tomorrow: WrapupItem[]
}

export interface Wrapup {
  id: number
  date: ISODate
  completed: number
  carried: number
  dropped: number
  deferred: number
  note: string
  /** Null for wrap-ups saved before details were recorded. */
  details: WrapupDetails | null
  created_at: number
}

export interface ActivityEntry {
  id: number
  ts: number
  ended_ts: number | null
  app: string
  bundleId: string
  service: string
  category: string
  kind: string
  detail: string
  idle: boolean
}
export interface ActivityService {
  service: string
  category: string
  seconds: number
  /** App the service was mostly used in (a browser for web services). */
  bundleId: string
}
/** Time in one app, with the services (sites, products) used inside it. */
export interface ActivityApp {
  bundleId: string
  name: string
  category: string
  seconds: number
  /** Share of active time, 0..1. */
  share: number
  services: { service: string; seconds: number }[]
}
/** An app Dayfold has seen (or that is excluded), for the recording manager. */
export interface ActivityAppEntry {
  bundleId: string
  /** Name stored with the activity, '' for an app never seen. */
  name: string
  /** Active seconds stored for it, all retained days. */
  seconds: number
  excluded: boolean
  /** In the default exclude list (password managers and wallets). */
  isDefault: boolean
}
/** Name and icon of an installed app. `icon` is a PNG data URL, null when unavailable. */
export interface AppInfo {
  bundleId: string
  name: string
  icon: string | null
}
/** A stretch of focused work in one category, with a suggested follow-up task. */
export interface ActivitySession {
  /** Stable key: the start time in ms, as a string. */
  id: string
  start: number
  end: number
  /** Time actually spent in the category, excluding absorbed interruptions. */
  activeSeconds: number
  category: string
  /** What the user was doing, e.g. "Coding in VS Code and Terminal". */
  headline: string
  apps: { bundleId: string; name: string; seconds: number }[]
  /** Sites or products used, most time first. */
  services: string[]
  /** Redacted chat, doc or thread names. Empty unless detail capture is on. */
  details: string[]
  /** What was on screen during the session (redacted lines). Empty unless snippets are on. */
  context: string[]
  /** Short detours into other categories that were folded into this session. */
  interruptions: number
  suggestion: { title: string }
  /** Task created from this session, if any and still existing. */
  taskId: number | null
  taskStatus: TaskStatus | null
}
/** AI-written review of one day. Built only on request, from sessions and to-dos. */
export interface DayReview {
  date: ISODate
  generatedAt: number
  /** Two or three plain sentences on how the day went. */
  summary: string
  /** What got done, each tied to the sessions it came from. */
  done: { text: string; sessionIds: string[] }[]
  /** Follow-ups the activity implies that are not on the to-do list. */
  missed: {
    title: string
    reason: string
    sessionIds: string[]
    /** Task created from this item, if any and still existing. */
    taskId: number | null
    /** Stable key for remembering that the item was added. */
    key: string
  }[]
  /** To-dos planned for the day with no sign of work on them. */
  untouched: { taskId: number; title: string; reason: string }[]
  /** One line and an optional to-do per session. */
  sessionNotes: Record<string, { summary: string; todo: string | null }>
}
export interface DayReviewResult {
  ok: boolean
  message: string
}
export interface ActivityAddTaskResult extends InputResult {
  taskId?: number
}
export interface ActivitySummary {
  enabled: boolean
  trusted: boolean | null
  running: boolean
  todayTotalSeconds: number
  captureDetail: boolean
  byService: ActivityService[]
  byCategory: { category: string; seconds: number }[]
  recent: ActivityEntry[]
  /** Local day shown (ISO date); byService/byCategory/segments/stats all refer to it. */
  date: ISODate
  /** Earliest selectable day (retention window). */
  earliestDate: ISODate
  retentionDays: number
  dayStart: number
  dayEnd: number
  now: number
  segments: ActivitySegment[]
  idleSeconds: number
  stats: ActivityDayStats
  /** Idle threshold in seconds. */
  idleThreshold: number
  /** Excluded bundle ids (lowercase). */
  exclude: string[]
  defaultExclude: string[]
  /** Time per app, most first, for the active day. */
  byApp: ActivityApp[]
  /** Focused work blocks of the day, chronological. */
  sessions: ActivitySession[]
  /** Every app seen in the retained history plus excluded ones, for the recording manager. */
  apps: ActivityAppEntry[]
  /** Reading visible window text is on (separate opt-in). */
  snippets: boolean
  /** The saved AI review of the shown day, if one was generated. */
  review: DayReview | null
  /** Why the helper is not running (missing, restarting ...), or null. */
  helperError: string | null
}
export interface ActivitySegment {
  start: number
  end: number
  bundleId: string
  service: string
  category: string
  kind: string
  idle: boolean
}
export interface ActivityDayStats {
  longestFocusSeconds: number
  longestFocusCategory: string
  longestFocusStart: number | null
  switches: number
  switchesPerHour: number
}

export type LlmProviderId = 'claude' | 'codex'

export interface LlmConfig {
  /** null = LLM fallback off; the deterministic parser handles everything. */
  provider: LlmProviderId | null
  /** Empty string = the provider's default model. */
  model: string
}
export interface LlmProviderStatus {
  id: LlmProviderId
  label: string
  installed: boolean
  version: string | null
  loggedIn: boolean | null
  account: string | null
  /** 'api-key' means the CLI would bill an API key, not the subscription. */
  authMethod: 'subscription' | 'api-key' | 'unknown'
  detail: string
  defaultModel: string
}
export interface LlmStatus {
  config: LlmConfig
  providers: LlmProviderStatus[]
}
export interface LlmTestResult {
  ok: boolean
  message: string
  ms: number
}

export interface TriageSuggestion {
  dumpId: number
  action: 'task' | 'discard'
  projectId: number | null
  planDate: ISODate | null
  reason: string
}
export interface TriageResult {
  ok: boolean
  message: string
  suggestions: TriageSuggestion[]
}

export type BackupKind = 'daily' | 'pre-migration' | 'pre-restore'
export interface BackupInfo {
  name: string
  kind: BackupKind
  size: number
  modified: number
}
export interface BackupStatus {
  dir: string
  /** Modified time (ms) of the newest daily backup, or null if none yet. */
  last: number | null
  count: number
  lastError: string | null
}
export type ExportFormat = 'json' | 'markdown'
export interface ExportResult {
  ok: boolean
  path?: string
  canceled?: boolean
  message?: string
}

/** Shell preferences (capture hotkey, tray, end-of-day reminder). Stored under settings 'shell.*'. */
export interface ShellPrefs {
  /** Electron accelerator, e.g. "Alt+Space". */
  hotkey: string
  hotkeyEnabled: boolean
  reminderEnabled: boolean
  /** 24-hour local time, HH:MM. */
  reminderTime: string
  remindersPaused: boolean
  trayEnabled: boolean
  /** Only takes effect in packaged builds. */
  launchAtLogin: boolean
}
export interface ShellStatus {
  hotkey: { accelerator: string; registered: boolean; error: string | null }
  trayActive: boolean
  notificationsSupported: boolean
  /** False in dev builds, where login items can't be set reliably. */
  launchAtLoginSupported: boolean
  /** Epoch ms of the next reminder, or null when off. */
  nextReminderAt: number | null
}
export interface ShellSettingsResult {
  prefs: ShellPrefs
  status: ShellStatus
  /** Set when part of the update could not be applied (e.g. the shortcut is taken). */
  warning: string | null
}
/** `settings` asks the renderer to open the Settings dialog. */
export type NavigateTarget = {
  tab: 'today' | 'dump' | 'projects' | 'eod' | 'activity' | 'settings'
}

/** A card shown in the floating notification overlay (its own window, above every app). */
export interface NotifyPayload {
  id: string
  kind: 'reminder' | 'capture' | 'deadline' | 'peek'
  title: string
  body?: string
  lines?: string[]
  actions: { id: string; label: string; primary?: boolean }[]
  /** Tab "open" should land on. */
  tab?: NavigateTarget['tab']
  /** Auto-dismiss after this many ms (paused while hovered), or null to stay until dismissed. */
  timeoutMs: number | null
}

export interface DashApi {
  getState(): Promise<AppState>
  /** True when running on the sample-data database. */
  demoGet(): Promise<boolean>
  /** Switches Demo Mode on or off and relaunches the app. Real data is never modified. */
  demoSet(on: boolean): Promise<{ ok: boolean; message: string }>
  /** Natural-language date ("friday", "in 3 days") to ISO, or null. Same parser as the command bar. */
  parseDate(text: string): Promise<ISODate | null>
  shellGetSettings(): Promise<ShellPrefs>
  shellSetSettings(patch: Partial<ShellPrefs>): Promise<ShellSettingsResult>
  shellStatus(): Promise<ShellStatus>
  /** Capture window only: hide it. */
  shellHideCapture(): Promise<void>
  /** Capture window only: a capture succeeded; hide the bar and show the confirmation card. */
  shellCaptureDone(result: { message: string; undoable: boolean }): Promise<void>
  /** Overlay window only. */
  onNotify(cb: (payload: NotifyPayload) => void): () => void
  notifyReady(): Promise<void>
  notifyAction(id: string, action: string): Promise<void>
  notifyResize(height: number): Promise<void>
  notifyDismiss(): Promise<void>
  onNavigate(cb: (target: NavigateTarget) => void): () => void
  /** Main window only: its onNavigate listener is registered, so queued navigation can be sent. */
  navigateReady(): Promise<void>
  /** Capture window only: fired each time the window is shown. */
  onCaptureShow(cb: () => void): () => void
  submit(text: string, source: 'typed' | 'voice' | 'hotkey'): Promise<InputResult>
  dispatch(command: Command): Promise<InputResult>
  undo(): Promise<InputResult>
  getActivity(date?: ISODate): Promise<ActivitySummary>
  setActivityEnabled(enabled: boolean): Promise<ActivitySummary>
  setActivityDetail(on: boolean): Promise<ActivitySummary>
  setActivityExclude(bundleIds: string[]): Promise<ActivitySummary>
  setActivityIdle(seconds: number): Promise<ActivitySummary>
  purgeActivity(): Promise<void>
  setActivitySnippets(on: boolean): Promise<ActivitySummary>
  /** Writes an AI review of the day with the configured CLI. Sends redacted context to it. */
  generateDayReview(date?: ISODate): Promise<DayReviewResult>
  /** Names and icons for installed apps by bundle id. Unknown ids come back with an empty name. */
  getAppInfo(bundleIds: string[]): Promise<AppInfo[]>
  /** Installed apps, for choosing which ones to exclude. */
  listInstalledApps(): Promise<AppInfo[]>
  /** Create a to-do from an activity session and remember the link. */
  addActivityTask(input: {
    /** A session id or a review item key; remembered so the item shows as added. */
    sessionId: string | null
    title: string
    planDate: ISODate | null
    projectId: number | null
  }): Promise<ActivityAddTaskResult>
  openAccessibilitySettings(): Promise<void>
  llmStatus(): Promise<LlmStatus>
  llmSetConfig(config: LlmConfig): Promise<LlmStatus>
  llmTest(): Promise<LlmTestResult>
  llmTriage(): Promise<TriageResult>
  backupStatus(): Promise<BackupStatus>
  backupNow(): Promise<BackupStatus>
  listBackups(): Promise<BackupInfo[]>
  exportData(format: ExportFormat, includeActivity: boolean): Promise<ExportResult>
  /** Restores the named backup, then relaunches the app. */
  restoreBackup(name: string): Promise<{ ok: boolean; message: string }>
  /** `confirm` must be exactly DELETE. */
  deleteAllData(confirm: string): Promise<{ ok: boolean; message: string }>
  revealBackups(): Promise<void>
  /** `scope` is 'activity' when only tracked activity changed (tasks and projects are untouched). */
  onChanged(cb: (scope?: 'activity') => void): () => void
}
