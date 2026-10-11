import { useState } from 'react'
import { ChevronDown, Flame, History, Search } from 'lucide-react'
import type { Wrapup, WrapupDetails, WrapupItem } from '../../../../shared/types'
import { toneClass } from '../../dash'
import { Input } from '@renderer/components/ui/input'
import { Separator } from '@renderer/components/ui/separator'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { cn } from '@renderer/lib/utils'

const weekday = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

const GROUPS: { key: keyof WrapupDetails; label: string; tone?: string }[] = [
  { key: 'done', label: 'Done', tone: toneClass.good },
  { key: 'carried', label: 'Carried to tomorrow', tone: toneClass.warn },
  { key: 'deferred', label: 'Deferred' },
  { key: 'dropped', label: 'Dropped' },
  { key: 'tomorrow', label: 'Lined up for tomorrow' }
]

const summary = (w: Wrapup): string =>
  [
    `${w.completed} done`,
    w.carried > 0 && `${w.carried} carried`,
    w.deferred > 0 && `${w.deferred} deferred`,
    w.dropped > 0 && `${w.dropped} dropped`
  ]
    .filter(Boolean)
    .join(' · ')

const itemText = (i: WrapupItem): string =>
  [i.title, i.project, i.to && `→ ${i.to}`].filter(Boolean).join(' · ')

/** What a wrap-up covered: every task by outcome, what was lined up next, and the note. */
function Detail({ w }: { w: Wrapup }): React.JSX.Element {
  const d = w.details
  return (
    <div className="flex flex-col gap-4 pt-1 pb-4">
      {d ? (
        GROUPS.map(({ key, label, tone }) =>
          d[key].length === 0 ? null : (
            <section key={key} className="flex flex-col gap-1" aria-label={label}>
              <h4
                className={cn(
                  'text-xs font-medium tracking-wide uppercase',
                  tone ?? 'text-muted-foreground'
                )}
              >
                {label} <span className="tabular">{d[key].length}</span>
              </h4>
              <ul className="flex flex-col gap-0.5">
                {d[key].map((i, n) => (
                  <li key={`${i.title}-${n}`} className="[overflow-wrap:anywhere]">
                    {itemText(i)}
                  </li>
                ))}
              </ul>
            </section>
          )
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          This wrap-up was saved before task details were recorded, so only the counts are known.
        </p>
      )}
      {w.note && (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">“{w.note}”</p>
      )}
    </div>
  )
}

/** FR-11: past wrap-ups, each opening to the tasks it covered. Searchable by date, note or task. */
export function WrapupHistory({
  wrapups,
  streak
}: {
  wrapups: Wrapup[]
  streak: number
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const haystack = (w: Wrapup): string => {
    const items = w.details
      ? Object.values(w.details)
          .flat()
          .map((i: WrapupItem) => `${i.title} ${i.project ?? ''}`)
          .join(' ')
      : ''
    return `${w.date} ${weekday(w.date)} ${w.note} ${items}`.toLowerCase()
  }
  const shown = needle ? wrapups.filter((w) => haystack(w).includes(needle)) : wrapups

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-label="Wrap-up history">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-semibold">
          Wrap-up history{' '}
          <span className="tabular font-normal text-muted-foreground">{wrapups.length}</span>
        </h3>
        {streak > 0 && (
          <span className={cn('inline-flex items-center gap-1 text-xs', toneClass.good)}>
            <Flame className="size-3.5" aria-hidden /> {streak}-day streak
          </span>
        )}
      </div>

      {wrapups.length > 0 && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by date, note or task…"
            aria-label="Search wrap-up history"
            className="pl-8"
            maxLength={100}
          />
        </div>
      )}

      {wrapups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
          <History className="size-5" aria-hidden />
          <p>No wrap-ups yet. Finish one and it shows up here, with what it covered.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No wrap-ups match “{q.trim()}”.</p>
      ) : (
        <ul>
          {shown.map((w, i) => (
            <li key={w.id}>
              {i > 0 && <Separator />}
              <Collapsible>
                <CollapsibleTrigger className="group flex w-full items-center gap-3 py-3 text-left outline-none focus-visible:text-foreground">
                  <span className="tabular flex-1 font-medium">{weekday(w.date)}</span>
                  <span className="tabular text-sm text-muted-foreground">{summary(w)}</span>
                  <ChevronDown
                    aria-hidden
                    className="size-4 -rotate-90 text-muted-foreground transition-transform group-data-[state=open]:rotate-0"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Detail w={w} />
                </CollapsibleContent>
              </Collapsible>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
