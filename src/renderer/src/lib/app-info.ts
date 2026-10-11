import { useEffect, useReducer } from 'react'
import type { AppInfo } from '../../../shared/types'
import { api, prettyBundleId } from '../dash'

// One shared cache for the whole renderer: icons are data URLs and never change in a session.
const cache = new Map<string, AppInfo>()
const wanted = new Set<string>()
const inflight = new Set<string>()
const listeners = new Set<() => void>()
let scheduled = false

const keyOf = (id: string): string => id.toLowerCase()

function flush(): void {
  scheduled = false
  const ids = [...wanted]
  wanted.clear()
  if (ids.length === 0) return
  ids.forEach((id) => inflight.add(id))
  const settle = (): void => {
    for (const id of ids) {
      inflight.delete(id)
      if (!cache.has(id)) cache.set(id, { bundleId: id, name: '', icon: null })
    }
    listeners.forEach((l) => l())
  }
  api
    .getAppInfo(ids)
    .then((list) => list.forEach((i) => cache.set(keyOf(i.bundleId), i)))
    .catch(() => {})
    .finally(settle)
}

function request(ids: string[]): void {
  for (const id of ids) {
    const k = keyOf(id)
    if (id && !cache.has(k) && !inflight.has(k)) wanted.add(k)
  }
  if (wanted.size > 0 && !scheduled) {
    scheduled = true
    queueMicrotask(flush) // batch every icon asked for in one render pass into one IPC call
  }
}

/** Looks up names and icons for bundle ids; the component re-renders as they arrive. */
export function useAppInfo(ids: string[]): (id: string) => AppInfo | undefined {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    listeners.add(bump)
    return () => void listeners.delete(bump)
  }, [])
  const key = ids.join('|')
  useEffect(() => request(ids), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return (id) => cache.get(keyOf(id))
}

/** The app's name: the installed app's own name, else what macOS reported, else a tidy bundle id. */
export function useAppName(): (bundleId: string, fallback?: string) => string {
  const info = (id: string): AppInfo | undefined => cache.get(keyOf(id))
  return (bundleId, fallback) =>
    info(bundleId)?.name || fallback || (bundleId ? prettyBundleId(bundleId) : 'Unknown app')
}
