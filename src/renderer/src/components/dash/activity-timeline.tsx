import { Reveal } from './disclosure'
import { useMemo, useRef, useState } from 'react'
import type { ActivitySegment } from '../../../../shared/types'
import { fmtDuration } from '../../dash'
import { AppIcon } from './app-icon'
import { categoryColor } from '../../lib/category-color'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'

const HOUR = 3600_000

const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function ActivityTimeline({
  segments,
  dayStart,
  dayEnd,
  now
}: {
  segments: ActivitySegment[]
  dayStart: number
  dayEnd: number
  now: number
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null)

  const { lo, hi, ticks, categories } = useMemo(() => {
    if (segments.length === 0)
      return { lo: dayStart, hi: dayStart + 8 * HOUR, ticks: [], categories: [] }
    // align to the local hour (not UTC)
    const d = new Date(segments[0].start)
    let lo = Math.max(
      dayStart,
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime()
    )
    const lastEnd = segments[segments.length - 1].end
    const e = new Date(Math.min(dayEnd, Math.max(lastEnd, Math.min(now, dayEnd))))
    let hi = Math.min(
      dayEnd,
      new Date(e.getFullYear(), e.getMonth(), e.getDate(), e.getHours() + 1).getTime()
    )
    if (hi - lo < 4 * HOUR) hi = Math.min(dayEnd, lo + 4 * HOUR)
    if (hi - lo < 4 * HOUR) lo = Math.max(dayStart, hi - 4 * HOUR)
    const step = hi - lo > 12 * HOUR ? 3 : hi - lo > 6 * HOUR ? 2 : 1
    const ticks: number[] = []
    const t0 = new Date(lo)
    for (let h = 0; lo + h * HOUR <= hi; h += step) {
      ticks.push(
        new Date(t0.getFullYear(), t0.getMonth(), t0.getDate(), t0.getHours() + h).getTime()
      )
    }
    const categories = [...new Set(segments.filter((g) => !g.idle).map((g) => g.category))].sort()
    return { lo, hi, ticks: ticks.filter((t) => t <= hi), categories }
  }, [segments, dayStart, dayEnd, now])

  const span = hi - lo
  const pct = (t: number): number => ((t - lo) / span) * 100

  const indexAt = (clientX: number): { i: number; x: number } | null => {
    const el = ref.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - r.left, 0), r.width)
    const t = lo + (x / r.width) * span
    let a = 0
    let b = segments.length - 1
    while (a <= b) {
      const m = (a + b) >> 1
      if (segments[m].end <= t) a = m + 1
      else if (segments[m].start > t) b = m - 1
      else return { i: m, x }
    }
    return null
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (segments.length === 0) return
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Escape') return
    e.preventDefault()
    if (e.key === 'Escape') return setHover(null)
    const cur = hover?.i ?? (e.key === 'ArrowRight' ? -1 : segments.length)
    const i = Math.min(segments.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)))
    const w = ref.current?.getBoundingClientRect().width ?? 0
    setHover({ i, x: (pct((segments[i].start + segments[i].end) / 2) / 100) * w })
  }

  const h = hover ? segments[hover.i] : null
  const barStyle = (g: ActivitySegment): React.CSSProperties => ({
    left: `${pct(g.start)}%`,
    width: `max(${((g.end - g.start) / span) * 100}%, 2px)`,
    background: g.idle
      ? 'repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklch, var(--muted-foreground) 35%, transparent) 3px 5px)'
      : categoryColor(g.category)
  })
  // The bars are the expensive part (one element per segment) and do not depend on the pointer,
  // so they are built once per day. Hover is a CSS dim on all of them plus one lit copy on top.
  const bars = useMemo(
    () =>
      segments.map((g) => (
        <div
          key={g.start}
          data-seg={g.idle ? 'idle' : g.category}
          className="absolute inset-y-0 border-s border-background/60"
          style={barStyle(g)}
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segments, lo, span]
  )
  const total = segments.filter((g) => !g.idle).reduce((a, g) => a + (g.end - g.start) / 1000, 0)
  const label = `Activity timeline, ${segments.length} blocks, ${fmtDuration(total)} active. Use the left and right arrow keys to move between blocks.`
  const rows = segments.filter((g) => g.end - g.start >= 60_000).slice(0, 300)

  return (
    <div className="flex flex-col gap-3 [--seg-l:0.62] dark:[--seg-l:0.74]">
      <div className="relative pb-5">
        <div
          ref={ref}
          role="img"
          tabIndex={0}
          aria-label={label}
          className="relative h-10 w-full cursor-crosshair overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-hover:[&>[data-seg]]:opacity-55"
          data-hover={hover ? '' : undefined}
          onMouseMove={(e) => {
            const next = indexAt(e.clientX)
            // while the pointer stays inside one block only the tooltip needs to follow it
            setHover((cur) => (cur && next && cur.i === next.i && cur.x === next.x ? cur : next))
          }}
          onMouseLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
          data-testid="timeline"
        >
          {bars}
          {h && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 border-s border-background/60"
              style={barStyle(h)}
            />
          )}
          {segments.length === 0 && (
            <span className="absolute inset-0 grid place-items-center text-muted-foreground">
              Nothing recorded for this day
            </span>
          )}
        </div>
        {ticks.map((t) => (
          <span
            key={t}
            aria-hidden
            className="tabular absolute top-11 -translate-x-1/2 whitespace-nowrap text-xs text-muted-foreground"
            style={{ left: `${pct(t)}%` }}
          >
            {new Date(t).toLocaleTimeString([], { hour: 'numeric' })}
          </span>
        ))}
        {h && hover && (
          <div
            role="status"
            className="pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
            style={{
              left: `clamp(8rem, ${hover.x}px, calc(100% - 8rem))`,
              transform: 'translate(-50%, -100%)'
            }}
          >
            <p className="flex items-center gap-1.5 font-medium">
              {!h.idle && <AppIcon bundleId={h.bundleId} name={h.service} size={16} />}
              {h.idle ? 'Idle or away' : h.service}
            </p>
            <p className="tabular text-muted-foreground">
              {h.idle ? '' : `${h.category} · ${h.kind} · `}
              {fmtTime(h.start)} to {fmtTime(h.end)} ({fmtDuration((h.end - h.start) / 1000)})
            </p>
          </div>
        )}
      </div>

      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        aria-label="Legend"
      >
        {categories.map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-sm"
              style={{ background: categoryColor(c) }}
            />
            <span className="capitalize">{c}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-sm border"
            style={{
              background:
                'repeating-linear-gradient(135deg, transparent 0 2px, color-mix(in oklch, var(--muted-foreground) 45%, transparent) 2px 3px)'
            }}
          />
          Idle or away
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-muted" />
          Not tracked
        </li>
      </ul>

      {segments.length > 0 && (
        <Reveal label="View as table" className="text-sm">
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-end">Length</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((g) => (
                <TableRow key={g.start}>
                  <TableCell className="tabular">{fmtTime(g.start)}</TableCell>
                  <TableCell className="tabular">{fmtTime(g.end)}</TableCell>
                  <TableCell>
                    {g.idle ? (
                      'Idle or away'
                    ) : (
                      <span className="flex items-center gap-2">
                        <AppIcon bundleId={g.bundleId} name={g.service} size={16} />
                        {g.service}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="capitalize">{g.idle ? '' : g.category}</TableCell>
                  <TableCell className="tabular text-end">
                    {fmtDuration((g.end - g.start) / 1000)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-1 text-xs text-muted-foreground">Blocks of a minute or longer.</p>
        </Reveal>
      )}
    </div>
  )
}
