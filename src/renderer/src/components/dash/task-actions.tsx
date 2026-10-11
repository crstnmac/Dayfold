import { useEffect, useState } from 'react'
import { CalendarClock, Scissors, TriangleAlert, X } from 'lucide-react'
import type { AppState, ISODate, Task } from '../../../../shared/types'
import { api, type Run } from '../../dash'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { DateInput } from './date-input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Badge } from '@renderer/components/ui/badge'
import { Kbd } from '@renderer/components/ui/kbd'

const isoOk = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000

/**
 * Picks a future day by phrase ("friday", "in 3 days", 2026-11-02) or with the native date input.
 * Nothing is committed until Enter / the button, so no partial value ever reaches a command.
 */
export function DeferPicker({
  today,
  onSubmit,
  onCancel,
  submitLabel = 'Defer',
  autoFocus
}: {
  today: ISODate
  onSubmit: (date: ISODate) => void
  onCancel?: () => void
  submitLabel?: string
  autoFocus?: boolean
}): React.JSX.Element {
  const [phrase, setPhrase] = useState('')
  const [parsed, setParsed] = useState<{ phrase: string; date: ISODate | null } | null>(null)
  const [picked, setPicked] = useState('')

  useEffect(() => {
    if (!phrase.trim()) return
    let live = true
    void api.parseDate(phrase).then((date) => live && setParsed({ phrase, date }))
    return () => {
      live = false
    }
  }, [phrase])

  const typed = phrase.trim() !== ''
  const resolved = typed
    ? parsed?.phrase === phrase
      ? parsed.date
      : null
    : isoOk(picked)
      ? picked
      : null
  const valid = resolved !== null && resolved > today
  const submit = (): void => {
    if (valid && resolved) onSubmit(resolved)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            e.stopPropagation()
            submit()
          } else if (e.key === 'Escape' && onCancel) {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        autoFocus={autoFocus}
        placeholder="friday, in 3 days, Nov 2…"
        aria-label="Defer to date"
        className="h-8 w-48"
        maxLength={60}
      />
      <DateInput
        label="Pick a date"
        value={picked}
        min={today}
        onChange={(v) => {
          setPicked(v)
          setPhrase('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            submit()
          }
        }}
        className="w-44"
      />
      <span className="tabular min-w-24 text-xs text-muted-foreground" aria-live="polite">
        {resolved
          ? valid
            ? `→ ${resolved}`
            : 'Pick a day after today'
          : typed
            ? 'Not a date yet'
            : 'Type or pick a date'}
      </span>
      <Button size="sm" onClick={submit} disabled={!valid}>
        {submitLabel}
      </Button>
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  )
}

/** One subtask per line (2-5). Cmd/Ctrl+Enter submits. */
export function BreakDownForm({
  onSubmit,
  onCancel,
  autoFocus
}: {
  onSubmit: (titles: string[]) => void
  onCancel: () => void
  autoFocus?: boolean
}): React.JSX.Element {
  const [text, setText] = useState('')
  const titles = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const valid = titles.length >= 2 && titles.length <= 5
  const submit = (): void => {
    if (valid) onSubmit(titles)
  }
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        autoFocus={autoFocus}
        rows={4}
        className="min-h-24"
        placeholder={'One smaller step per line (2 to 5)\nCall the vendor\nDraft the outline'}
        aria-label="Subtasks, one per line"
        maxLength={1500}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={submit} disabled={!valid}>
          <Scissors data-icon="inline-start" /> Break into {titles.length || ''} task
          {titles.length === 1 ? '' : 's'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground tabular">
          {titles.length > 5 ? 'Max 5 subtasks' : <Kbd>⌘↵</Kbd>}
        </span>
      </div>
    </div>
  )
}

/** FR-12: shown for any task carried 3+ times. */
export function StalePrompt({
  task,
  state,
  run
}: {
  task: Task
  state: AppState
  run: Run
}): React.JSX.Element {
  const [mode, setMode] = useState<'break' | 'defer' | null>(null)
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <TriangleAlert className="size-4 text-warning" aria-hidden />
        <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="font-medium">{task.title}</span>
          <span className="text-muted-foreground">
            {' '}
            has been carried {task.carry_count}×. Break it down, defer it, or drop it?
          </span>
        </p>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={mode === 'break'}
          onClick={() => setMode(mode === 'break' ? null : 'break')}
        >
          <Scissors data-icon="inline-start" /> Break down
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={mode === 'defer'}
          onClick={() => setMode(mode === 'defer' ? null : 'defer')}
        >
          <CalendarClock data-icon="inline-start" /> Defer
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label={`Drop ${task.title}`}
          onClick={() => void run({ type: 'task.drop', taskId: task.id })}
        >
          <X data-icon="inline-start" /> Drop
        </Button>
      </div>
      {mode === 'break' && (
        <BreakDownForm
          autoFocus
          onCancel={() => setMode(null)}
          onSubmit={(titles) => void run({ type: 'task.breakDown', taskId: task.id, titles })}
        />
      )}
      {mode === 'defer' && (
        <DeferPicker
          autoFocus
          today={state.today}
          onCancel={() => setMode(null)}
          onSubmit={(toDate) => void run({ type: 'task.defer', taskId: task.id, toDate })}
        />
      )}
    </div>
  )
}

export function StaleBadge({ count }: { count: number }): React.JSX.Element {
  return (
    <Badge variant="secondary" className="tabular bg-destructive/15 px-2 text-destructive">
      stale · carried {count}×
    </Badge>
  )
}
