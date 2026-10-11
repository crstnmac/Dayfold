import { useState } from 'react'
import { AlertTriangle, Check, CircleSlash, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { ActivitySummary } from '../../../../shared/types'
import { api, fmtClock } from '../../dash'
import { AddToTodo } from './add-to-todo'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'

function Section({
  icon,
  title,
  children
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 px-(--card-spacing)">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

/** The AI review of the day: what got done, what may have been missed, what was never touched. */
export function DayReviewPanel({
  s,
  aiOn,
  isToday
}: {
  s: ActivitySummary
  aiOn: boolean
  isToday: boolean
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const r = s.review
  const hasContext = s.sessions.some((x) => x.context.length > 0)
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await api.generateDayReview(s.date)
      if (!res.ok) toast.error(res.message)
    } finally {
      setBusy(false)
    }
  }
  const button = (
    <Button
      size="sm"
      variant={r ? 'outline' : 'default'}
      disabled={busy || !aiOn || s.sessions.length === 0}
      onClick={() => void run()}
    >
      {busy ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : r ? (
        <RefreshCw data-icon="inline-start" />
      ) : (
        <Sparkles data-icon="inline-start" />
      )}
      {busy ? 'Reviewing…' : r ? 'Review again' : 'Review my day'}
    </Button>
  )

  if (!r) {
    return (
      <div className="flex flex-col gap-3 px-(--card-spacing)">
        <p className="max-w-prose text-muted-foreground">
          {s.sessions.length === 0
            ? 'Once there are work sessions, Dayfold can write up what you did, spot follow-ups you may have missed, and list planned to-dos you never touched.'
            : hasContext
              ? 'Your AI assistant reads the day’s sessions and the redacted on-screen lines, then writes what you did and what you may have missed. It runs only when you ask.'
              : 'Your AI assistant reads the day’s sessions and writes what you did and what you may have missed. Turn on “Read visible text” below for much more specific results. It runs only when you ask.'}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {button}
          {!aiOn && (
            <span className="text-xs text-muted-foreground">
              Turn on AI assist in the header first.
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3 px-(--card-spacing)">
        <p className="min-w-0 flex-1 basis-80">{r.summary}</p>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {button}
          <span className="text-xs text-muted-foreground">
            Written at {fmtClock(r.generatedAt)}
          </span>
        </div>
      </div>

      {r.done.length > 0 && (
        <Section icon={<Check className="size-4 text-success" />} title="What you got done">
          <ul className="flex flex-col gap-1.5">
            {r.done.map((d) => (
              <li key={d.text} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-success" />
                {d.text}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section icon={<AlertTriangle className="size-4 text-warning" />} title="You may have missed">
        {r.missed.length === 0 ? (
          <p className="text-muted-foreground">Nothing stood out as left behind.</p>
        ) : (
          <ul className="flex flex-col">
            {r.missed.map((m, i) => (
              <li
                key={m.key}
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 ${i > 0 ? 'border-t' : ''}`}
              >
                <div className="min-w-0 flex-1 basis-64">
                  <p className="font-medium">{m.title}</p>
                  <p className="text-xs text-muted-foreground">{m.reason}</p>
                </div>
                {m.taskId !== null ? (
                  <Badge variant="secondary">
                    <Check /> On your to-do list
                  </Badge>
                ) : (
                  <AddToTodo
                    linkId={m.key}
                    suggestion={m.title}
                    hint="Spotted by the AI review."
                    isToday={isToday}
                    label={m.title}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {r.untouched.length > 0 && (
        <Section
          icon={<CircleSlash className="size-4 text-muted-foreground" />}
          title="Planned, but no sign of work"
        >
          <ul className="flex flex-col">
            {r.untouched.map((u, i) => (
              <li key={u.taskId} className={`py-2 ${i > 0 ? 'border-t' : ''}`}>
                <p className="font-medium">{u.title}</p>
                <p className="text-xs text-muted-foreground">{u.reason}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Move these from Today, or mark them done if you did them off the computer.
          </p>
        </Section>
      )}
    </div>
  )
}
