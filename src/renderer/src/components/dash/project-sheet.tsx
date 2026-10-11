import { useRef, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import type { AppState, Project, ProjectStatus } from '../../../../shared/types'
import { deadlineChip, toneClass, type Run } from '../../dash'
import { CommitField } from './commit-field'
import { DateField } from './date-field'
import { Markdown } from './markdown'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { Kbd } from '@renderer/components/ui/kbd'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import { cn } from '@renderer/lib/utils'

export const NOTES_MAX = 20000

/**
 * FR-13 project detail. Every edit saves through run(command) on blur / Enter / Cmd+Enter, so it
 * is validated and undoable. Notes use an expected-value guard: if the stored notes changed since
 * editing began (for example "note on Atlas: ..." from the command bar), the save is refused and
 * the user chooses to overwrite or reload instead of silently losing either side.
 */
export function ProjectSheet({
  project,
  state,
  run,
  onClose
}: {
  project: Project | undefined
  state: AppState
  run: Run
  onClose: () => void
}): React.JSX.Element {
  return (
    <Sheet open={!!project} onOpenChange={(o) => !o && onClose()}>
      {project && <SheetBody key={project.id} project={project} state={state} run={run} />}
    </Sheet>
  )
}

function SheetBody({
  project: p,
  state,
  run
}: {
  project: Project
  state: AppState
  run: Run
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [base, setBase] = useState('')
  const [conflict, setConflict] = useState(false)
  const [title, setTitle] = useState('')
  const skip = useRef(false)

  const tasks = state.openTasks.filter((t) => t.project_id === p.id)
  const chip = deadlineChip(p, state.today)

  function startEdit(): void {
    setBase(p.notes)
    setDraft(p.notes)
    setConflict(false)
    skip.current = false
    setEditing(true)
  }

  async function save(force = false): Promise<void> {
    if (skip.current) return
    if (draft === (force ? p.notes : base)) {
      setEditing(false)
      return
    }
    const r = await run({
      type: 'project.setNotes',
      projectId: p.id,
      notes: draft,
      expected: force ? undefined : base
    })
    if (r.ok) {
      setEditing(false)
      setConflict(false)
    } else if (/changed since/i.test(r.message)) setConflict(true)
  }

  async function addTask(): Promise<void> {
    const t = title.trim()
    if (!t) return
    setTitle('')
    await run({ type: 'task.add', title: t, projectId: p.id })
  }

  return (
    <SheetContent
      className="w-full gap-0 overflow-y-auto sm:max-w-xl"
      onEscapeKeyDown={(e) => {
        if (editing) {
          e.preventDefault()
          skip.current = true
          setEditing(false)
        }
      }}
    >
      <SheetHeader className="gap-2 border-b pr-14">
        <SheetTitle className="text-lg [overflow-wrap:anywhere]">{p.name}</SheetTitle>
        <SheetDescription>
          Edits save when you leave a field, and each one can be undone.
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={p.status}
            onValueChange={(v) =>
              void run({ type: 'project.setStatus', projectId: p.id, status: v as ProjectStatus })
            }
          >
            <SelectTrigger size="sm" aria-label={`Status of ${p.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <DateField
            key={p.due ?? ''}
            label={`Deadline for ${p.name}`}
            value={p.due}
            className="h-8 w-40"
            onCommit={(v) => void run({ type: 'project.setDue', projectId: p.id, due: v })}
          />
          {chip && (
            <Badge variant="secondary" className={cn('tabular', toneClass[chip.tone])}>
              {chip.text}
            </Badge>
          )}
        </div>
      </SheetHeader>

      <div className="flex flex-col gap-5 p-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Goal
          <CommitField
            key={`goal:${p.goal}`}
            value={p.goal}
            label="Goal"
            placeholder="One line: what does done look like?"
            onCommit={(text) => void run({ type: 'project.setGoal', projectId: p.id, text })}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Next action
          <CommitField
            key={`next:${p.next_action}`}
            value={p.next_action}
            label="Next action"
            placeholder="The very next thing to do"
            onCommit={(text) => void run({ type: 'project.setNextAction', projectId: p.id, text })}
          />
        </label>

        <section className="flex flex-col gap-2" aria-label="Notes">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-sm font-medium">Notes</h2>
            {editing ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Kbd>⌘↵</Kbd> save · <Kbd>Esc</Kbd> discard
              </span>
            ) : (
              <Button size="sm" variant="outline" onClick={startEdit}>
                <Pencil data-icon="inline-start" /> Edit
              </Button>
            )}
          </div>
          {conflict && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
            >
              <p>These notes changed somewhere else while you were editing.</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void save(true)}>
                  Overwrite with mine
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    skip.current = true
                    setEditing(false)
                    setConflict(false)
                  }}
                >
                  Use the latest
                </Button>
              </div>
            </div>
          )}
          {editing ? (
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => !conflict && void save()}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void save()
                }
              }}
              maxLength={NOTES_MAX}
              rows={10}
              className="min-h-48 font-mono text-xs"
              aria-label="Project notes (markdown)"
              placeholder={'# Heading\n- a bullet\n**bold**, *italic*, `code`, [link](https://…)'}
            />
          ) : p.notes.trim() ? (
            <div className="rounded-lg border bg-card p-3">
              <Markdown source={p.notes} />
            </div>
          ) : (
            <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
              No notes yet. Markdown works here, or say “note on {p.name}: …”.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2" aria-label="Open to-dos">
          <h2 className="text-sm font-medium">
            Open to-dos <span className="tabular text-muted-foreground">({tasks.length})</span>
          </h2>
          {tasks.length === 0 && <p className="text-sm text-muted-foreground">Nothing open.</p>}
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3">
              <Checkbox
                checked={false}
                aria-label={`Complete ${t.title}`}
                onCheckedChange={() =>
                  void run({ type: 'task.setStatus', taskId: t.id, status: 'done' })
                }
              />
              <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{t.title}</p>
              {t.plan_date && (
                <Badge variant="outline" className="tabular">
                  {t.plan_date === state.today ? 'today' : t.plan_date}
                </Badge>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void addTask()}
              placeholder={`Add a to-do to ${p.name}…`}
              aria-label={`Add a to-do to ${p.name}`}
              maxLength={2000}
              className="h-8"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void addTask()}
              disabled={!title.trim()}
            >
              <Plus data-icon="inline-start" /> Add
            </Button>
          </div>
        </section>
      </div>
    </SheetContent>
  )
}
