import { useState } from 'react'
import { CalendarClock, MoonStar, Play, Plus, TriangleAlert } from 'lucide-react'
import type { AppState, Task } from '../../../shared/types'
import { isStale, toneClass, type Run } from '../dash'
import { StaleBadge, StalePrompt } from '@renderer/components/dash/task-actions'
import { Page } from '@renderer/components/dash/page'
import { DumpSection } from './DumpView'
import { WrapUpSection } from './EndOfDayView'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Separator } from '@renderer/components/ui/separator'
import { Disclosure } from '@renderer/components/dash/disclosure'
import { cn } from '@renderer/lib/utils'
import { friendlyDate } from '@renderer/lib/iso-date'
import { AnimatePresence, motion } from 'motion/react'
import { rowMotion } from '@renderer/lib/motion'

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** One line of quiet metadata under a task title: status, due date, carry count. */
function Meta({ t, state }: { t: Task; state: AppState }): React.JSX.Element | null {
  const carried = (t.plan_date ?? state.today) < state.today || t.carry_count > 0
  const stale = carried && isStale(t)
  const bits: React.ReactNode[] = []
  if (t.project_name) bits.push(<span key="p">{t.project_name}</span>)
  if (t.status === 'doing')
    bits.push(
      <span key="d" className={toneClass.good}>
        In progress
      </span>
    )
  if (carried && !stale)
    bits.push(
      <span key="c" className={cn('tabular', toneClass.warn)}>
        Carried {t.carry_count || 1}×
      </span>
    )
  if (t.due)
    bits.push(
      <span key="u" className="tabular">
        Due {friendlyDate(t.due, state.today)}
      </span>
    )
  if (bits.length === 0 && !stale) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      {bits.flatMap((b, i) => (i === 0 ? [b] : [<span key={`s${i}`}>·</span>, b]))}
      {stale && <StaleBadge count={t.carry_count} />}
    </div>
  )
}

export function TodayView({
  state,
  run,
  wrapOpen,
  onWrapOpenChange,
  onStartWrapup
}: {
  state: AppState
  run: Run
  wrapOpen: boolean
  onWrapOpenChange: (open: boolean) => void
  onStartWrapup: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const groups = new Map<number | null, { name: string; tasks: Task[] }>()
  for (const t of state.plate) {
    const g = groups.get(t.project_id) ?? { name: t.project_name ?? 'No project', tasks: [] }
    g.tasks.push(t)
    groups.set(t.project_id, g)
  }
  const dueSoon = state.projects.filter(
    (p) => p.status === 'active' && p.due && p.due <= state.tomorrow
  )
  const staleTasks = state.plate.filter(isStale)
  const total = state.plate.length + state.doneToday.length
  const pct = total ? Math.round((state.doneToday.length / total) * 100) : 0
  const wrapped = state.wrapups.some((w) => w.date === state.today)

  async function add(): Promise<void> {
    const t = title.trim()
    if (!t) return
    setTitle('')
    await run({ type: 'task.add', title: t, planDate: state.today })
  }

  return (
    <Page
      className="max-w-2xl gap-8"
      title="Today"
      description={
        <span className="tabular">
          {greeting()}.{' '}
          {state.plate.length === 0 ? 'Nothing left to do' : `${state.plate.length} to do`}
          {state.doneToday.length > 0 && ` · ${state.doneToday.length} done`}
        </span>
      }
      actions={
        <Button variant="outline" className="rounded-full" onClick={onStartWrapup}>
          <MoonStar data-icon="inline-start" /> {wrapped ? 'Redo wrap-up' : 'Wrap up'}
        </Button>
      }
    >
      {total > 0 && (
        <div
          className="-mt-4 h-0.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Today's progress"
          aria-valuenow={pct}
        >
          <div className="h-full bg-success transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}

      {(dueSoon.length > 0 || staleTasks.length > 0) && (
        <div className="flex flex-col gap-2">
          {dueSoon.length > 0 && (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Deadlines coming up</AlertTitle>
              <AlertDescription>
                {dueSoon.map((p) => `${p.name} (${p.due})`).join(', ')}
              </AlertDescription>
            </Alert>
          )}
          {staleTasks.map((t) => (
            <StalePrompt key={t.id} task={t} state={state} run={run} />
          ))}
        </div>
      )}

      <div className="flex flex-col">
        <div className="relative mb-2">
          <Plus
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void add()}
            placeholder="Add a to-do for today…"
            aria-label="Add a to-do for today"
            maxLength={2000}
            className="h-11 rounded-xl border-transparent bg-muted/60 pl-10 shadow-none focus-visible:bg-card"
          />
        </div>

        <AnimatePresence initial={false}>
          {state.plate.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {state.doneToday.length > 0
                ? 'All done. Nice work.'
                : 'A clear day. Add your first to-do.'}
            </p>
          ) : (
            state.plate.map((t, i) => (
              <motion.div key={t.id} {...rowMotion} className="overflow-hidden">
                {i > 0 && <Separator />}
                <div className="group flex items-center gap-3.5 py-3.5">
                  <Checkbox
                    checked={false}
                    className="size-5 rounded-full"
                    aria-label={`Complete ${t.title}`}
                    onCheckedChange={() =>
                      void run({ type: 'task.setStatus', taskId: t.id, status: 'done' })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-base [overflow-wrap:anywhere]">{t.title}</p>
                    <Meta t={t} state={state} />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    {t.status !== 'doing' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          run({ type: 'task.setStatus', taskId: t.id, status: 'doing' })
                        }
                      >
                        <Play data-icon="inline-start" /> Start
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        run({ type: 'task.plan', taskId: t.id, planDate: state.tomorrow })
                      }
                    >
                      <CalendarClock data-icon="inline-start" /> Tomorrow
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {state.dump.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Inbox">
          <h2 className="text-lg font-semibold">
            Inbox{' '}
            <span className="tabular font-normal text-muted-foreground">{state.dump.length}</span>
          </h2>
          <DumpSection state={state} run={run} />
        </section>
      )}

      <div className="flex flex-col">
        {state.unplanned.length > 0 && (
          <Disclosure label="Backlog" hint={state.unplanned.length}>
            <AnimatePresence initial={false}>
              {state.unplanned.slice(0, 8).map((t, i) => (
                <motion.div key={t.id} {...rowMotion} className="overflow-hidden">
                  {i > 0 && <Separator />}
                  <div className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="[overflow-wrap:anywhere]">{t.title}</p>
                      {t.project_name && (
                        <p className="text-xs text-muted-foreground">{t.project_name}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        run({ type: 'task.plan', taskId: t.id, planDate: state.today })
                      }
                    >
                      Add to today
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </Disclosure>
        )}
        <Disclosure
          label="Review the day"
          hint={`${state.doneToday.length} done · ${state.carryover.length} to carry over`}
          open={wrapOpen}
          onOpenChange={onWrapOpenChange}
          className="border-b"
        >
          <WrapUpSection state={state} run={run} />
        </Disclosure>
      </div>
    </Page>
  )
}
