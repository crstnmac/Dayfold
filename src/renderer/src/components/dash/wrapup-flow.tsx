import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'motion/react'
import { EASE_OUT } from '@renderer/lib/motion'
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCheck,
  CircleCheck,
  Flame,
  Plus,
  Scissors,
  Sun,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import type { AppState, Command, DumpItem, ISODate, Task } from '../../../../shared/types'
import { addDaysIso, api, isStale, toneClass } from '../../dash'
import { BreakDownForm, DeferPicker } from './task-actions'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Kbd } from '@renderer/components/ui/kbd'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { cn } from '@renderer/lib/utils'
import { friendlyDate } from '@renderer/lib/iso-date'

type Step = 'tasks' | 'dump' | 'tomorrow' | 'done'
type Kind = 'done' | 'carry' | 'defer' | 'drop' | 'break'
type Pending = Kind | null

const STEPS: { id: Exclude<Step, 'done'>; label: string }[] = [
  { id: 'tasks', label: "Today's tasks" },
  { id: 'dump', label: 'Inbox' },
  { id: 'tomorrow', label: 'Tomorrow' }
]

const KIND_LABEL: Record<Kind, string> = {
  done: 'Done',
  carry: 'Carried to tomorrow',
  defer: 'Deferred',
  drop: 'Dropped',
  break: 'Broken down'
}

interface Entry {
  step: Step
  taskId?: number
  dumpId?: number
}

const isTyping = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null
  return (
    !!n &&
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName) ||
      n.isContentEditable ||
      n.getAttribute('role') === 'combobox')
  )
}

export function WrapupFlow({
  open,
  onOpenChange,
  state
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: AppState
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <FlowBody state={state} close={() => onOpenChange(false)} />}
    </Dialog>
  )
}

function FlowBody({ state, close }: { state: AppState; close: () => void }): React.JSX.Element {
  // Snapshots taken when the flow opens, so items stay in place after they are resolved.
  const [tasks] = useState<Task[]>(() => state.plate)
  const [dumps] = useState<DumpItem[]>(() => state.dump)
  const [step, setStep] = useState<Step>('tasks')
  const [idx, setIdx] = useState(0)
  const [dIdx, setDIdx] = useState(0)
  const [pending, setPending] = useState<Pending>(null)
  const [resolved, setResolved] = useState<Record<number, string>>({})
  const [dumpDone, setDumpDone] = useState<Record<number, string>>({})
  const [history, setHistory] = useState<Entry[]>([])
  const [note, setNote] = useState('')
  const [newTask, setNewTask] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const refocus = (): void => {
    requestAnimationFrame(() => ref.current?.focus())
  }

  const task = tasks[idx] as Task | undefined
  const resolvedCount = tasks.filter((t) => resolved[t.id]).length
  const allResolved = resolvedCount === tasks.length
  const dump = dumps[dIdx] as DumpItem | undefined
  const stepIndex = STEPS.findIndex((s) => s.id === step)

  /** Dispatch straight to the main process (validated, logged, undoable) without a toast per item. */
  async function send(cmd: Command): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    try {
      const r = await api.dispatch(cmd)
      if (!r.ok) toast.error(r.message)
      return r.ok
    } catch (e) {
      toast.error((e as Error).message)
      return false
    } finally {
      setBusy(false)
      refocus()
    }
  }

  const nextOpenIndex = (from: number, map: Record<number, string>): number => {
    for (let k = 1; k <= tasks.length; k++) {
      const j = (from + k) % tasks.length
      if (!map[tasks[j].id]) return j
    }
    return from
  }

  async function applyTask(
    kind: Kind,
    extra?: { toDate?: ISODate; titles?: string[] }
  ): Promise<void> {
    if (!task || resolved[task.id]) return
    let cmd: Command
    let label: string = KIND_LABEL[kind]
    switch (kind) {
      case 'done':
        cmd = { type: 'task.setStatus', taskId: task.id, status: 'done' }
        break
      case 'carry':
        cmd = { type: 'task.carry', taskId: task.id, toDate: state.tomorrow }
        break
      case 'defer':
        cmd = { type: 'task.defer', taskId: task.id, toDate: extra?.toDate ?? state.tomorrow }
        label = `Deferred to ${extra?.toDate}`
        break
      case 'drop':
        cmd = { type: 'task.drop', taskId: task.id }
        break
      case 'break':
        cmd = { type: 'task.breakDown', taskId: task.id, titles: extra?.titles ?? [] }
        label = `Broken into ${extra?.titles?.length} tasks`
        break
    }
    if (!(await send(cmd))) return
    const next = { ...resolved, [task.id]: label }
    setResolved(next)
    setHistory((h) => [...h, { step: 'tasks', taskId: task.id }])
    setPending(null)
    if (tasks.every((t) => next[t.id])) return
    setIdx(nextOpenIndex(idx, next))
  }

  async function applyDump(
    to: 'task' | 'discard',
    planDate?: ISODate,
    projectId?: number
  ): Promise<void> {
    if (!dump) return
    const ok = await send({ type: 'dump.triage', dumpId: dump.id, to, planDate, projectId })
    if (!ok) return
    setDumpDone((m) => ({
      ...m,
      [dump.id]:
        to === 'discard' ? 'Discarded' : `To-do ${planDate === state.today ? 'today' : 'tomorrow'}`
    }))
    setHistory((h) => [...h, { step: 'dump', dumpId: dump.id }])
    setDIdx((i) => i + 1)
  }

  async function undoLast(): Promise<void> {
    const last = history[history.length - 1]
    if (!last || busy) return
    setBusy(true)
    try {
      const r = await api.undo()
      if (!r.ok) return void toast.error(r.message)
      setHistory((h) => h.slice(0, -1))
      setStep(last.step === 'done' ? 'tomorrow' : last.step)
      if (last.taskId !== undefined) {
        const id = last.taskId
        setResolved((m) => {
          const n = { ...m }
          delete n[id]
          return n
        })
        setIdx(
          Math.max(
            0,
            tasks.findIndex((t) => t.id === id)
          )
        )
        setPending(null)
      }
      if (last.dumpId !== undefined) {
        const id = last.dumpId
        setDumpDone((m) => {
          const n = { ...m }
          delete n[id]
          return n
        })
        setDIdx(
          Math.max(
            0,
            dumps.findIndex((d) => d.id === id)
          )
        )
      }
    } finally {
      setBusy(false)
      refocus()
    }
  }

  async function finish(): Promise<void> {
    if (
      await send({ type: 'wrapup.complete', date: state.today, note: note.trim() || undefined })
    ) {
      setHistory((h) => [...h, { step: 'done' }])
      setStep('done')
    }
  }

  const go = (s: Step): void => {
    setStep(s)
    setPending(null)
    refocus()
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && step === 'tomorrow') {
        e.preventDefault()
        void finish()
      }
      return
    }
    if (isTyping(e.target)) return
    const tag = (e.target as HTMLElement).tagName
    const k = e.key.toLowerCase()
    if (k === 'enter' && tag === 'BUTTON') return // let a focused button handle its own Enter
    if (k === 'u') {
      e.preventDefault()
      void undoLast()
      return
    }
    if (step === 'tasks') {
      if (k === 'arrowright' && tasks.length) setIdx((i) => Math.min(tasks.length - 1, i + 1))
      else if (k === 'arrowleft' && tasks.length) setIdx((i) => Math.max(0, i - 1))
      else if (task && !resolved[task.id] && 'dcfxb'.includes(k) && k.length === 1) {
        e.preventDefault()
        setPending({ d: 'done', c: 'carry', f: 'defer', x: 'drop', b: 'break' }[k] as Kind)
      } else if (k === 'enter') {
        e.preventDefault()
        if (pending === 'done' || pending === 'carry' || pending === 'drop') void applyTask(pending)
        else if (allResolved || !tasks.length) go('dump')
      } else if (k === 'escape' && pending) setPending(null)
      return
    }
    if (step === 'dump') {
      if (!dump) {
        if (k === 'enter') go('tomorrow')
        else if (k === 'arrowleft') go('tasks')
        return
      }
      if (k === 't') void applyDump('task', state.tomorrow)
      else if (k === 'y') void applyDump('task', state.today)
      else if (k === 'x') void applyDump('discard')
      else if (k === 's' || k === 'arrowright') setDIdx((i) => i + 1)
      else if (k === 'arrowleft') setDIdx((i) => Math.max(0, i - 1))
      else if (k === 'enter') go('tomorrow')
      return
    }
    if (step === 'done' && k === 'enter') close()
  }

  const wrapRow = state.wrapups.find((w) => w.date === state.today)

  return (
    <DialogContent
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        ref.current?.focus()
      }}
      onEscapeKeyDown={(e) => {
        if (pending === 'defer' || pending === 'break') {
          e.preventDefault()
          setPending(null)
          refocus()
        }
      }}
      className="sm:max-w-xl"
    >
      <DialogHeader>
        <DialogTitle>Wrap up your day</DialogTitle>
        <DialogDescription>
          {step === 'done'
            ? 'Done for today.'
            : `${STEPS[stepIndex].label}. Every choice can be undone.`}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="gap-6">
        {step !== 'done' && (
          <ol className="flex gap-1.5" aria-label="Wrap-up steps">
            {STEPS.map((st, i) => (
              <li
                key={st.id}
                aria-current={i === stepIndex ? 'step' : undefined}
                aria-label={`${st.label}${i < stepIndex ? ', done' : ''}`}
                className={cn(
                  'h-1 flex-1 rounded-full bg-muted transition-colors',
                  i <= stepIndex && 'bg-foreground'
                )}
              />
            ))}
          </ol>
        )}

        <motion.div
          key={step}
          className="flex flex-col gap-6"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
        >
          {step === 'tasks' && (
            <section className="flex flex-col gap-3" aria-label="Review your plate">
              {tasks.length === 0 ? (
                <p className="rounded-2xl bg-muted/50 p-6 text-center text-muted-foreground">
                  Your plate is already clear. Press <Kbd>Enter</Kbd> to continue.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Previous task"
                      disabled={idx === 0}
                      onClick={() => setIdx((i) => Math.max(0, i - 1))}
                    >
                      <ArrowLeft />
                    </Button>
                    <span className="tabular text-sm" aria-live="polite">
                      Task {Math.min(idx + 1, tasks.length)} of {tasks.length}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Next task"
                      disabled={idx >= tasks.length - 1}
                      onClick={() => setIdx((i) => Math.min(tasks.length - 1, i + 1))}
                    >
                      <ArrowRight />
                    </Button>
                    <span className="flex-1" />
                    <span className="tabular text-xs text-muted-foreground">
                      {resolvedCount}/{tasks.length} resolved
                    </span>
                  </div>

                  {task && (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, ease: EASE_OUT }}
                      className="flex flex-col gap-4 rounded-2xl bg-muted/50 p-5"
                    >
                      <div className="flex flex-col gap-1">
                        <p className="min-w-0 text-xl font-semibold [overflow-wrap:anywhere]">
                          {task.title}
                        </p>
                        <p className="tabular text-sm text-muted-foreground">
                          {[
                            task.project_name,
                            task.due && `due ${friendlyDate(task.due, state.today)}`,
                            task.carry_count > 0 &&
                              `${isStale(task) ? 'stale · ' : ''}carried ${task.carry_count}×`
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>

                      {isStale(task) && !resolved[task.id] && (
                        <p className="text-sm text-warning">
                          Carried {task.carry_count} times. Break it into smaller steps (
                          <Kbd>B</Kbd>
                          ), defer it (<Kbd>F</Kbd>), or drop it (<Kbd>X</Kbd>).
                        </p>
                      )}

                      {resolved[task.id] ? (
                        <p className="flex items-center gap-2 text-success">
                          <motion.span
                            className="inline-flex"
                            initial={{ scale: 0.4, rotate: -40 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: 'spring', stiffness: 520, damping: 16 }}
                          >
                            <CircleCheck className="size-4" aria-hidden />
                          </motion.span>{' '}
                          {resolved[task.id]}
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <ActionButton
                              k="D"
                              label="Done"
                              icon={<CheckCheck />}
                              active={pending === 'done'}
                              onClick={() => void applyTask('done')}
                            />
                            <ActionButton
                              k="C"
                              label="Carry"
                              icon={<ArrowRight />}
                              active={pending === 'carry'}
                              onClick={() => void applyTask('carry')}
                            />
                            <ActionButton
                              k="F"
                              label="Defer"
                              icon={<CalendarClock />}
                              active={pending === 'defer'}
                              onClick={() => setPending(pending === 'defer' ? null : 'defer')}
                            />
                            <ActionButton
                              k="X"
                              label="Drop"
                              icon={<X />}
                              active={pending === 'drop'}
                              onClick={() => void applyTask('drop')}
                            />
                            <ActionButton
                              k="B"
                              label="Break down"
                              icon={<Scissors />}
                              active={pending === 'break'}
                              onClick={() => setPending(pending === 'break' ? null : 'break')}
                            />
                          </div>
                          {pending === 'defer' && (
                            <DeferPicker
                              autoFocus
                              today={state.today}
                              onCancel={() => {
                                setPending(null)
                                refocus()
                              }}
                              onSubmit={(toDate) => void applyTask('defer', { toDate })}
                            />
                          )}
                          {pending === 'break' && (
                            <BreakDownForm
                              autoFocus
                              onCancel={() => {
                                setPending(null)
                                refocus()
                              }}
                              onSubmit={(titles) => void applyTask('break', { titles })}
                            />
                          )}
                          {(pending === 'done' || pending === 'carry' || pending === 'drop') && (
                            <p className="text-sm text-muted-foreground" aria-live="polite">
                              {pending === 'done' && 'Mark as done'}
                              {pending === 'carry' && `Carry to tomorrow (${state.tomorrow})`}
                              {pending === 'drop' && 'Drop this task'}. Press <Kbd>Enter</Kbd> to
                              confirm.
                            </p>
                          )}
                          {!pending && (
                            <p className="text-sm text-muted-foreground">
                              Press a letter, then <Kbd>Enter</Kbd>. <Kbd>←</Kbd> <Kbd>→</Kbd> to
                              move.
                            </p>
                          )}
                        </>
                      )}
                    </motion.div>
                  )}
                </>
              )}
            </section>
          )}

          {step === 'dump' && (
            <section className="flex flex-col gap-3" aria-label="Review your dump">
              {dump ? (
                <div className="flex flex-col gap-4 rounded-2xl bg-muted/50 p-5">
                  <p className="tabular text-sm text-muted-foreground" aria-live="polite">
                    Item {dIdx + 1} of {dumps.length}
                  </p>
                  <p className="text-xl font-semibold [overflow-wrap:anywhere]">{dump.text}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => void applyDump('task', state.tomorrow)}>
                      <CalendarClock data-icon="inline-start" /> To-do tomorrow <Kbd>T</Kbd>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void applyDump('task', state.today)}
                    >
                      <Sun data-icon="inline-start" /> To-do today <Kbd>Y</Kbd>
                    </Button>
                    <Select
                      value=""
                      onValueChange={(v) => void applyDump('task', state.tomorrow, Number(v))}
                    >
                      <SelectTrigger size="sm" aria-label="Move to a project for tomorrow">
                        <SelectValue placeholder="Project (tomorrow)…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {state.projects
                            .filter((p) => p.status !== 'done')
                            .map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" onClick={() => void applyDump('discard')}>
                      <Trash2 data-icon="inline-start" /> Discard <Kbd>X</Kbd>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDIdx((i) => i + 1)}>
                      Keep for later <Kbd>S</Kbd>
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="rounded-2xl bg-muted/50 p-6 text-center text-muted-foreground">
                  {dumps.length === 0
                    ? 'Your dump is empty.'
                    : `Dump reviewed: ${Object.keys(dumpDone).length} sorted, ${state.dump.length} kept.`}{' '}
                  Press <Kbd>Enter</Kbd> to continue.
                </p>
              )}
            </section>
          )}

          {step === 'tomorrow' && (
            <TomorrowStep
              state={state}
              note={note}
              setNote={setNote}
              newTask={newTask}
              setNewTask={setNewTask}
              send={send}
              pushHistory={() => setHistory((h) => [...h, { step: 'tomorrow' }])}
            />
          )}

          {step === 'done' && (
            <section
              className="flex flex-col items-center gap-3 rounded-2xl bg-muted/50 p-8 text-center"
              aria-label="Wrap-up summary"
            >
              <CircleCheck className="size-8 text-success" aria-hidden />
              <p className="text-base font-medium">Wrap-up saved</p>
              {wrapRow && (
                <p className="tabular text-sm text-muted-foreground">
                  {wrapRow.completed} done · {wrapRow.carried} carried · {wrapRow.deferred} deferred
                  · {wrapRow.dropped} dropped
                </p>
              )}
              {state.wrapupStreak > 1 && (
                <Badge variant="secondary" className={cn('tabular', toneClass.good)}>
                  <Flame /> {state.wrapupStreak}-day streak
                </Badge>
              )}
              {wrapRow?.note && <p className="max-w-prose italic">“{wrapRow.note}”</p>}
              <p className="text-sm text-muted-foreground">
                Press <Kbd>Enter</Kbd> to close.
              </p>
            </section>
          )}
        </motion.div>
      </DialogBody>

      <DialogFooter className="sm:justify-start">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void undoLast()}
          disabled={history.length === 0 || busy}
        >
          <Undo2 data-icon="inline-start" /> Undo <Kbd>U</Kbd>
        </Button>
        <span className="flex-1" />
        {step === 'tasks' && (
          <Button
            size="sm"
            variant={allResolved ? 'default' : 'outline'}
            onClick={() => go('dump')}
          >
            {allResolved ? 'Next: dump' : `Skip ${tasks.length - resolvedCount} left`}
            <ArrowRight data-icon="inline-end" />
          </Button>
        )}
        {step === 'dump' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => go('tasks')}>
              <ArrowLeft data-icon="inline-start" /> Back
            </Button>
            <Button size="sm" onClick={() => go('tomorrow')}>
              Next: tomorrow <ArrowRight data-icon="inline-end" />
            </Button>
          </>
        )}
        {step === 'tomorrow' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => go('dump')}>
              <ArrowLeft data-icon="inline-start" /> Back
            </Button>
            <Button size="sm" onClick={() => void finish()}>
              Finish wrap-up <Kbd>⌘↵</Kbd>
            </Button>
          </>
        )}
        {step === 'done' && (
          <Button size="sm" onClick={close}>
            Close
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  )
}

function ActionButton({
  k,
  label,
  icon,
  active,
  onClick
}: {
  k: string
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      variant={active ? 'default' : 'outline'}
      className="gap-1.5"
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      <Kbd className={active ? 'bg-primary-foreground/20 text-primary-foreground' : undefined}>
        {k}
      </Kbd>
    </Button>
  )
}

function TomorrowStep({
  state,
  note,
  setNote,
  newTask,
  setNewTask,
  send,
  pushHistory
}: {
  state: AppState
  note: string
  setNote: (v: string) => void
  newTask: string
  setNewTask: (v: string) => void
  send: (c: Command) => Promise<boolean>
  pushHistory: () => void
}): React.JSX.Element {
  const dayAfter = addDaysIso(state.tomorrow, 1)
  const planned = state.tomorrowTasks
  const dueTomorrow = state.openTasks.filter(
    (t) => t.due === state.tomorrow && t.plan_date !== state.tomorrow
  )
  const nextActions = state.projects.filter(
    (p) =>
      p.status === 'active' &&
      p.next_action.trim() &&
      !planned.some((t) => t.project_id === p.id && t.title === p.next_action.trim())
  )

  async function act(c: Command): Promise<void> {
    if (await send(c)) pushHistory()
  }
  async function add(): Promise<void> {
    const title = newTask.trim()
    if (!title) return
    setNewTask('')
    await act({ type: 'task.add', title, planDate: state.tomorrow })
  }
  return (
    <section className="flex flex-col gap-4" aria-label="Confirm tomorrow">
      <div className="flex flex-col gap-1">
        <p className="pb-1 text-sm font-medium">
          Tomorrow, {state.tomorrow}{' '}
          <span className="tabular text-muted-foreground">({planned.length})</span>
        </p>
        {planned.length === 0 && (
          <p className="pb-2 text-sm text-muted-foreground">Nothing planned yet.</p>
        )}
        {planned.map((t) => (
          <div key={t.id} className="flex items-center gap-2 py-1.5">
            <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t.title}</p>
            {t.project_name && <Badge variant="outline">{t.project_name}</Badge>}
            {t.carry_count > 0 && (
              <Badge
                className={cn('tabular', isStale(t) ? toneClass.bad : toneClass.warn)}
                variant="secondary"
              >
                carried {t.carry_count}×
              </Badge>
            )}
            <Button
              size="xs"
              variant="ghost"
              aria-label={`Push ${t.title} to ${dayAfter}`}
              onClick={() => void act({ type: 'task.plan', taskId: t.id, planDate: dayAfter })}
            >
              Push a day
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Drop ${t.title}`}
              onClick={() => void act({ type: 'task.drop', taskId: t.id })}
            >
              <X />
            </Button>
          </div>
        ))}
        <div className="pt-2">
          <Input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void add()
              }
            }}
            placeholder="Add a task for tomorrow…"
            aria-label="Add a task for tomorrow"
            maxLength={2000}
            className="h-9"
          />
        </div>
      </div>

      {(dueTomorrow.length > 0 || nextActions.length > 0) && (
        <div className="flex flex-col gap-1">
          <p className="pb-1 text-sm font-medium">Suggested</p>
          {dueTomorrow.map((t) => (
            <div key={`due-${t.id}`} className="flex items-center gap-2 py-1">
              <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t.title}</p>
              <Badge variant="secondary" className={toneClass.bad}>
                due tomorrow
              </Badge>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  void act({ type: 'task.plan', taskId: t.id, planDate: state.tomorrow })
                }
              >
                <Plus data-icon="inline-start" /> Plan it
              </Button>
            </div>
          ))}
          {nextActions.map((p) => (
            <div key={`na-${p.id}`} className="flex items-center gap-2 py-1">
              <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{p.next_action}</p>
              <Badge variant="outline">{p.name}</Badge>
              <Button
                size="xs"
                variant="outline"
                aria-label={`Add next action of ${p.name} for tomorrow`}
                onClick={() =>
                  void act({
                    type: 'task.add',
                    title: p.next_action.trim(),
                    projectId: p.id,
                    planDate: state.tomorrow
                  })
                }
              >
                <Plus data-icon="inline-start" /> Add
              </Button>
            </div>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        One thing I want to remember
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          className="min-h-14 font-normal"
          placeholder="Optional. Shown in your wrap-up history."
        />
      </label>
    </section>
  )
}
