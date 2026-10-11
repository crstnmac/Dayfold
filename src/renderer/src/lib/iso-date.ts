const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Parses "YYYY-MM-DD" as a local date, or undefined when it is not a real calendar day. */
export const isoToDate = (iso: string): Date | undefined => {
  if (!ISO.test(iso)) return undefined
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : undefined
}

export const dateToIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const dayDiff = (a: Date, b: Date): number => Math.round((a.getTime() - b.getTime()) / 86_400_000)

/**
 * A due date as a person would say it: "today", "tomorrow", "yesterday", a weekday within the
 * next week ("Fri"), or "Oct 24". Anything that is not an ISO day is returned unchanged.
 */
export function friendlyDate(iso: string, todayIso: string): string {
  const d = isoToDate(iso)
  const t = isoToDate(todayIso)
  if (!d || !t) return iso
  const diff = dayDiff(d, t)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== t.getFullYear() && { year: 'numeric' })
  })
}
