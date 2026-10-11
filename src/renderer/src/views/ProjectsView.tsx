import { useState } from 'react'
import { ChevronRight, FolderKanban, Pause, Plus, TriangleAlert, CheckCheck } from 'lucide-react'
import type { AppState } from '../../../shared/types'
import { deadlineChip, toneClass, type Run } from '../dash'
import type { Project } from '../../../shared/types'
import { Page } from '@renderer/components/dash/page'
import { projectHealth } from '../lib/health'
import { ProjectSheet } from '@renderer/components/dash/project-sheet'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Disclosure } from '@renderer/components/dash/disclosure'
import { Separator } from '@renderer/components/ui/separator'
import { cn } from '@renderer/lib/utils'
import { motion } from 'motion/react'
import { riseMotion } from '@renderer/lib/motion'

function HealthWarning({ p, why, run }: { p: Project; why: string; run: Run }): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState(p.next_action)
  async function add(): Promise<void> {
    const t = title.trim()
    if (!t) return
    const r = await run({ type: 'task.add', title: t, projectId: p.id })
    if (r.ok) setAdding(false)
  }
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-2.5"
      data-testid="project-warning"
    >
      <p className="flex items-center gap-2 text-sm">
        <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden /> {why}
      </p>
      {adding ? (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void add()
              else if (e.key === 'Escape') setAdding(false)
            }}
            placeholder="What is the next task?"
            aria-label={`Next task for ${p.name}`}
            maxLength={2000}
            className="h-8"
          />
          <Button size="sm" onClick={() => void add()} disabled={!title.trim()}>
            Add
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" /> Add next task
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void run({ type: 'project.setStatus', projectId: p.id, status: 'paused' })
            }
          >
            <Pause data-icon="inline-start" /> Pause
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void run({ type: 'project.setStatus', projectId: p.id, status: 'done' })}
          >
            <CheckCheck data-icon="inline-start" /> Mark done
          </Button>
        </div>
      )}
    </div>
  )
}

export function ProjectsView({ state, run }: { state: AppState; run: Run }): React.JSX.Element {
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  async function create(): Promise<void> {
    const n = name.trim()
    if (!n) return
    setName('')
    await run({ type: 'project.create', name: n })
  }

  const active = state.projects.filter((p) => p.status === 'active')
  const rest = state.projects.filter((p) => p.status !== 'active')

  const row = (p: Project, i: number): React.JSX.Element => {
    const chip = deadlineChip(p, state.today)
    const why = projectHealth(p, state.now)
    return (
      <motion.div key={p.id} {...riseMotion(i)}>
        {i > 0 && <Separator />}
        <div className={cn('flex flex-col gap-2 py-4', p.status === 'done' && 'opacity-60')}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpenId(p.id)}
            aria-label={`Open ${p.name}`}
            className="group -mx-3 h-auto w-[calc(100%+1.5rem)] justify-start gap-4 rounded-xl px-3 py-2 text-left font-normal whitespace-normal"
          >
            <div className="min-w-0 flex-1">
              <p className="text-lg font-medium [overflow-wrap:anywhere]">{p.name}</p>
              {(p.next_action || p.goal) && (
                <p className="truncate text-muted-foreground">{p.next_action || p.goal}</p>
              )}
            </div>
            <div className="tabular flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
              {p.status !== 'active' && <span className="capitalize">{p.status}</span>}
              {p.open_tasks > 0 && <span>{p.open_tasks} open</span>}
              {chip && <span className={toneClass[chip.tone]}>{chip.text}</span>}
              <ChevronRight
                className="size-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden
              />
            </div>
          </Button>
          {why && <HealthWarning key={`${p.id}:${why}`} p={p} why={why} run={run} />}
        </div>
      </motion.div>
    )
  }

  return (
    <Page
      className="max-w-2xl gap-8"
      title="My Projects"
      description={
        state.projects.length === 0
          ? 'What are you building?'
          : `${active.length} active${rest.length ? ` · ${rest.length} paused or done` : ''}`
      }
    >
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <Plus
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="new-project"
          aria-label="New project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          placeholder="New project…"
          className="h-11 rounded-xl border-transparent bg-muted/60 pl-10 shadow-none focus-visible:bg-card"
        />
      </form>

      {state.projects.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <FolderKanban className="size-6" aria-hidden />
          <p>Add one above, or say “new project Atlas, due Friday”.</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {active.map(row)}
          {rest.length > 0 && (
            <Disclosure label="Paused and done" hint={rest.length} className="mt-4 border-b">
              {rest.map(row)}
            </Disclosure>
          )}
        </div>
      )}
      <ProjectSheet
        project={state.projects.find((x) => x.id === openId)}
        state={state}
        run={run}
        onClose={() => setOpenId(null)}
      />
    </Page>
  )
}
