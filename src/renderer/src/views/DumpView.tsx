import { useState } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'motion/react'
import { rowMotion } from '@renderer/lib/motion'
import { ArrowRight, CalendarClock, Check, Sparkles, Sun, Trash2, Ellipsis, X } from 'lucide-react'
import type { AppState, TriageSuggestion } from '../../../shared/types'
import { api, type Run } from '../dash'
import { Spinner } from '@renderer/components/ui/spinner'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Separator } from '@renderer/components/ui/separator'

export function DumpSection({ state, run }: { state: AppState; run: Run }): React.JSX.Element {
  const active = state.projects.filter((p) => p.status !== 'done')
  const [suggestions, setSuggestions] = useState<Record<number, TriageSuggestion>>({})
  const [sorting, setSorting] = useState(false)

  // Only suggestions for items that are still waiting are shown or counted.
  const live = state.dump.flatMap((d) => (suggestions[d.id] ? [suggestions[d.id]] : []))
  const liveTasks = live.filter((s) => s.action === 'task')
  const projectName = (id: number | null): string | undefined =>
    state.projects.find((p) => p.id === id)?.name
  const dropSuggestion = (id: number): void =>
    setSuggestions((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

  async function suggest(): Promise<void> {
    setSorting(true)
    try {
      const r = await api.llmTriage()
      if (!r.ok) return void toast.error(r.message)
      setSuggestions(Object.fromEntries(r.suggestions.map((s) => [s.dumpId, s])))
      if (r.suggestions.length === 0)
        toast('No clear suggestions. Everything stays for you to sort.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSorting(false)
    }
  }

  // Applies through the normal command path (validated, logged, undoable).
  async function apply(list: TriageSuggestion[]): Promise<void> {
    let done = 0
    for (const s of list) {
      const r = await api.dispatch({
        type: 'dump.triage',
        dumpId: s.dumpId,
        to: s.action,
        projectId: s.projectId ?? undefined,
        planDate: s.planDate ?? undefined
      })
      if (!r.ok) {
        toast.error(r.message)
        break
      }
      done++
      dropSuggestion(s.dumpId)
    }
    if (done > 1)
      toast(`Sorted ${done} items`, {
        action: {
          label: 'Undo all',
          onClick: () =>
            void (async () => {
              for (let i = 0; i < done; i++) await api.undo()
            })()
        }
      })
    else if (done === 1)
      toast('Sorted 1 item', { action: { label: 'Undo', onClick: () => void api.undo() } })
  }

  const triage = (dumpId: number, planDate?: string, projectId?: number): Promise<unknown> =>
    run({ type: 'dump.triage', dumpId, to: 'task', planDate, projectId })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm text-muted-foreground">
          Sort each into a to-do, a project, or let it go.
        </p>
        {liveTasks.length > 0 && (
          <Button size="xs" onClick={() => void apply(liveTasks)}>
            <Check data-icon="inline-start" /> Apply {liveTasks.length}
          </Button>
        )}
        <Button size="xs" variant="ghost" onClick={() => void suggest()} disabled={sorting}>
          {sorting ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
          {sorting ? 'Thinking…' : 'Sort with AI'}
        </Button>
      </div>
      <div className="flex flex-col">
        <AnimatePresence initial={false}>
          {state.dump.map((d, i) => {
            const sg = suggestions[d.id]
            return (
              <motion.div key={d.id} {...rowMotion} className="overflow-hidden">
                {i > 0 && <Separator />}
                <div className="flex flex-col gap-2 py-3">
                  <div className="min-w-0">
                    <p className="[overflow-wrap:anywhere]">{d.text}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {new Date(d.created_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                  {sg && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-accent px-2.5 py-1.5 text-xs">
                      <Sparkles className="size-3.5 text-chart-1" aria-hidden />
                      <span className="font-medium">
                        {sg.action === 'discard' ? 'Discard' : 'To-do'}
                      </span>
                      {sg.projectId !== null && <span>· {projectName(sg.projectId)}</span>}
                      {sg.planDate && <span className="tabular">· {sg.planDate}</span>}
                      <span className="min-w-0 basis-full text-muted-foreground [overflow-wrap:anywhere]">
                        {sg.reason}
                      </span>
                      <Button
                        size="xs"
                        variant={sg.action === 'discard' ? 'destructive' : 'default'}
                        onClick={() => void apply([sg])}
                      >
                        Apply
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Dismiss suggestion"
                        onClick={() => dropSuggestion(d.id)}
                      >
                        <X />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => triage(d.id, state.today)}>
                      <Sun data-icon="inline-start" /> To-do today
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => triage(d.id, state.tomorrow)}>
                      <CalendarClock data-icon="inline-start" /> Tomorrow
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`More actions for “${d.text}”`}
                        >
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {active.length > 0 && (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <ArrowRight /> Move to project
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {active.map((p) => (
                                <DropdownMenuItem
                                  key={p.id}
                                  onSelect={() => void triage(d.id, state.today, p.id)}
                                >
                                  {p.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )}
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            void run({ type: 'dump.triage', dumpId: d.id, to: 'discard' })
                          }
                        >
                          <Trash2 /> Discard
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
