import { Reveal } from './disclosure'
import { useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import type { ActivitySession, DayReview } from '../../../../shared/types'
import { fmtClock, fmtDuration } from '../../dash'
import { AddToTodo } from './add-to-todo'
import { AppIcon } from './app-icon'
import { useAppInfo, useAppName } from '../../lib/app-info'
import { categoryColor } from '../../lib/category-color'
import { cn } from '@renderer/lib/utils'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@renderer/components/ui/empty'

const INITIAL = 6

function SessionRow({
  s,
  isToday,
  first,
  note
}: {
  s: ActivitySession
  isToday: boolean
  first: boolean
  note?: { summary: string; todo: string | null }
}): React.JSX.Element {
  const nameOf = useAppName()
  useAppInfo(s.apps.map((a) => a.bundleId))
  const range = `${fmtClock(s.start)} to ${fmtClock(s.end)}`
  const done = s.taskStatus === 'done'
  return (
    <li
      className={cn(
        'flex flex-wrap items-start gap-x-4 gap-y-2 px-(--card-spacing) py-3 [--seg-l:0.62] dark:[--seg-l:0.74]',
        !first && 'border-t'
      )}
      data-testid="session"
    >
      <span
        aria-hidden
        className="mt-1 h-10 w-1 shrink-0 rounded-full"
        style={{ background: categoryColor(s.category) }}
      />
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
        <p className="font-medium">{s.headline}</p>
        {note && <p className="text-sm">{note.summary}</p>}
        <p className="tabular text-xs text-muted-foreground">
          {range} · {fmtDuration(s.activeSeconds)} active ·{' '}
          <span className="capitalize">{s.category}</span>
          {s.interruptions > 0 &&
            ` · ${s.interruptions} short ${s.interruptions === 1 ? 'detour' : 'detours'}`}
        </p>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Apps used">
          {s.apps.map((a) => (
            <li
              key={a.bundleId || a.name}
              className="flex items-center gap-1.5 text-xs"
              title={a.bundleId}
            >
              <AppIcon bundleId={a.bundleId} name={a.name} size={16} />
              <span>{nameOf(a.bundleId, a.name)}</span>
              <span className="tabular text-muted-foreground">{fmtDuration(a.seconds)}</span>
            </li>
          ))}
        </ul>
        {s.context.length > 0 && (
          <Reveal
            className="text-xs"
            label={`What was on screen (${s.context.length} ${s.context.length === 1 ? 'line' : 'lines'})`}
          >
            <ul className="mt-1 flex flex-col gap-0.5 border-s ps-3">
              {s.context.map((c) => (
                <li key={c} className="break-words">
                  {c}
                </li>
              ))}
            </ul>
          </Reveal>
        )}
        {s.details.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            {s.details.map((d) => `“${d}”`).join(' · ')}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        {s.taskId !== null ? (
          <Badge variant="secondary" className={done ? 'text-success' : undefined}>
            <Check /> {done ? 'To-do done' : 'On your to-do list'}
          </Badge>
        ) : (
          <AddToTodo
            linkId={s.id}
            suggestion={note?.todo || s.suggestion.title}
            hint={`${note?.todo ? 'Suggested by the AI review' : 'Suggested'} from ${fmtDuration(s.activeSeconds)} of ${s.category} work.`}
            isToday={isToday}
            label={s.headline}
          />
        )}
      </div>
    </li>
  )
}

export function ActivitySessions({
  sessions,
  isToday,
  tracking,
  review
}: {
  sessions: ActivitySession[]
  isToday: boolean
  tracking: boolean
  review: DayReview | null
}): React.JSX.Element {
  const [all, setAll] = useState(false)
  const newest = [...sessions].reverse()
  const shown = all ? newest : newest.slice(0, INITIAL)
  if (newest.length === 0) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyTitle>No work sessions yet</EmptyTitle>
          <EmptyDescription>
            {tracking
              ? 'A session appears once you spend 5 minutes in one kind of work. Short visits are left out.'
              : 'Turn tracking on to see your focused work here.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col">
      <p className="flex items-center gap-1.5 px-(--card-spacing) pb-2 text-xs text-muted-foreground">
        <Sparkles className="size-3.5" />
        Each session is time in one kind of work; short detours do not split it. Use Add to to-do to
        turn what you did into a follow-up.
      </p>
      <ul>
        {shown.map((s, i) => (
          <SessionRow
            key={s.id}
            s={s}
            isToday={isToday}
            first={i === 0}
            note={review?.sessionNotes[s.id]}
          />
        ))}
      </ul>
      {newest.length > INITIAL && (
        <div className="px-(--card-spacing) pt-2">
          <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${newest.length} sessions`}
          </Button>
        </div>
      )}
    </div>
  )
}
