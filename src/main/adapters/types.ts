export type Category =
  | 'email'
  | 'messaging'
  | 'social'
  | 'meeting'
  | 'work'
  | 'docs'
  | 'dev'
  | 'media'
  | 'ai'
  | 'browsing'
  | 'other'

/** Raw focus context from the Accessibility helper. */
export interface FocusContext {
  app: string
  bundleId: string
  title: string
  /** Page URL for browsers (host + path only; query/fragment already stripped). */
  url: string
  host: string
  path: string
}

export interface Resolved {
  service: string
  category: Category
  /** Coarse, content-free activity: reading, composing, messaging, watching, ... */
  kind: string
  /** Content-bearing detail (thread, channel, doc name). Only kept when detail capture is on. */
  detail: string
}

export interface Adapter {
  id: string
  name: string
  category: Category
  bundleIds?: string[]
  /** Match on hostname suffix, e.g. "mail.google.com" or "x.com" (also matches www.x.com). */
  hosts?: string[]
  /** Derive kind/detail from the window title and URL path. Defaults to kind "using". */
  describe?: (ctx: FocusContext) => { kind?: string; detail?: string }
}
