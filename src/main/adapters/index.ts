import { ADAPTERS } from './registry'
import { isBlockedHost, isSensitivePage, redact, sanitizeUrl } from './privacy'
import type { Adapter, FocusContext, Resolved } from './types'

export type { Resolved, FocusContext, Category } from './types'

/** A leading "=" means exact host only; otherwise subdomains match too. */
const hostMatches = (host: string, pattern: string): boolean =>
  pattern.startsWith('=')
    ? host === pattern.slice(1)
    : host === pattern || host.endsWith(`.${pattern}`)

const BROWSER_BUNDLES = new Set([
  'com.apple.Safari',
  'com.google.Chrome',
  'com.google.Chrome.beta',
  'com.brave.Browser',
  'company.thebrowser.Browser',
  'com.microsoft.edgemac',
  'org.mozilla.firefox',
  'com.vivaldi.Vivaldi',
  'com.operasoftware.Opera',
  'app.zen-browser.zen',
  'com.google.Chrome.canary',
  'com.microsoft.edgemac.Beta',
  'com.apple.SafariTechnologyPreview',
  'com.kagi.kagimacOS',
  'company.thebrowser.dia',
  'org.mozilla.firefoxdeveloperedition',
  'org.chromium.Chromium',
  'com.operasoftware.OperaGX'
])

export const isBrowserBundle = (bundleId: string): boolean => BROWSER_BUNDLES.has(bundleId)

export function buildContext(input: {
  app: string
  bundleId: string
  title: string
  url: string
}): FocusContext {
  const { url, host, path } = sanitizeUrl(input.url)
  return { app: input.app, bundleId: input.bundleId, title: input.title, url, host, path }
}

function pick(ctx: FocusContext): Adapter | undefined {
  // A page's host beats the hosting browser; a native app beats nothing.
  if (ctx.host) {
    const byHost = ADAPTERS.find((a) => a.hosts?.some((h) => hostMatches(ctx.host, h)))
    if (byHost) return byHost
  }
  if (!BROWSER_BUNDLES.has(ctx.bundleId) || !ctx.host) {
    return ADAPTERS.find((a) => a.bundleIds?.includes(ctx.bundleId))
  }
  return undefined
}

/**
 * Resolve a focus context to a service. `detail` is only populated when
 * `captureDetail` is true and is redacted of emails, long numbers and tokens.
 */
export function resolve(ctx: FocusContext, opts: { captureDetail: boolean }): Resolved {
  if (ctx.host && isBlockedHost(ctx.host)) {
    return { service: 'Private site', category: 'browsing', kind: 'private', detail: '' }
  }
  if (ctx.host && isSensitivePage(ctx.host, ctx.path)) {
    return { service: ctx.host, category: 'browsing', kind: 'signing in', detail: '' }
  }
  const adapter = pick(ctx)
  if (!adapter) {
    const isBrowser = BROWSER_BUNDLES.has(ctx.bundleId)
    return {
      service: isBrowser && ctx.host ? ctx.host : ctx.app,
      category: isBrowser ? 'browsing' : 'other',
      kind: isBrowser ? 'browsing' : 'using',
      detail: ''
    }
  }
  const d = adapter.describe?.(ctx) ?? {}
  return {
    service: adapter.name,
    category: adapter.category,
    kind: d.kind ?? 'using',
    detail: opts.captureDetail && d.detail ? redact(d.detail).slice(0, 120) : ''
  }
}

export const ADAPTER_COUNT = ADAPTERS.length
