import type { Project } from '../../../shared/types'

const STALE_MS = 7 * 86400000

/** FR-14: why an active project needs attention, or null when it is healthy. */
export function projectHealth(p: Project, now: number): string | null {
  if (p.status !== 'active') return null
  const idleDays = Math.floor((now - p.touched_at) / 86400000)
  const idle = now - p.touched_at > STALE_MS
  if (p.open_tasks === 0 && idle) return `No open to-dos and untouched for ${idleDays} days`
  if (p.open_tasks === 0) return 'No open to-dos'
  if (idle) return `Untouched for ${idleDays} days`
  return null
}
