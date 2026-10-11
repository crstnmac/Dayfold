import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { AppInfo } from '../shared/types'

const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const LIST_TTL_MS = 5 * 60_000
const CONCURRENCY = 8

export interface CatalogDeps {
  /** Run a program with fixed arguments (never through a shell) and return stdout. */
  exec(cmd: string, args: string[]): Promise<string>
  /** PNG data URL of the app's icon, or null. */
  icon(appPath: string): Promise<string | null>
  /** Folders that hold .app bundles. */
  dirs: string[]
  readDir(dir: string): Promise<string[]>
}

export const defaultDirs = (): string[] => [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  '/System/Library/CoreServices/Applications',
  join(homedir(), 'Applications')
]

export const defaultExec = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    )
  )

export const defaultReadDir = (dir: string): Promise<string[]> => readdir(dir)

/** Finder-style name: the bundle's file name without ".app". */
export const appNameFromPath = (p: string): string => basename(p).replace(/\.app$/i, '')

/** "com.google.Chrome" becomes "Chrome": the last meaningful part, for apps that are not installed. */
export function prettyBundleId(id: string): string {
  const parts = id.split('.').filter((p) => p && !/^(app|desktop|mac|macos|osx|electron)$/i.test(p))
  const last = parts[parts.length - 1] ?? id
  return last.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

interface Entry {
  bundleId: string
  name: string
  path: string
}

/**
 * Looks up app names and icons by bundle id. Installed apps are found by scanning the usual
 * application folders; anything else goes through Spotlight. Results are cached.
 */
export class AppCatalog {
  private installed: { at: number; apps: Entry[] } | null = null
  private pendingList: Promise<Entry[]> | null = null
  private paths = new Map<string, string | null>()
  private icons = new Map<string, string | null>()

  constructor(private deps: CatalogDeps) {}

  private async readEntry(path: string): Promise<Entry | null> {
    try {
      const json = await this.deps.exec('/usr/bin/plutil', [
        '-convert',
        'json',
        '-o',
        '-',
        '--',
        join(path, 'Contents', 'Info.plist')
      ])
      const p = JSON.parse(json) as Record<string, unknown>
      const id = p.CFBundleIdentifier
      if (typeof id !== 'string' || !BUNDLE_ID.test(id)) return null
      // helpers and menu-bar agents never take focus, so they are noise in an exclude picker
      if (p.LSBackgroundOnly === true || p.LSUIElement === true || p.LSUIElement === '1')
        return null
      return { bundleId: id, name: appNameFromPath(path), path }
    } catch {
      return null
    }
  }

  private async scan(): Promise<Entry[]> {
    const bundles: string[] = []
    for (const dir of this.deps.dirs) {
      let names: string[] = []
      try {
        names = await this.deps.readDir(dir)
      } catch {
        continue
      }
      for (const n of names) {
        if (n.endsWith('.app')) bundles.push(join(dir, n))
        else if (!n.startsWith('.') && !n.includes('.')) {
          // vendor folders such as "Adobe Photoshop" or "Setapp"
          try {
            for (const m of await this.deps.readDir(join(dir, n)))
              if (m.endsWith('.app')) bundles.push(join(dir, n, m))
          } catch {
            /* not a folder */
          }
        }
      }
    }
    const found: Entry[] = []
    let i = 0
    const worker = async (): Promise<void> => {
      while (i < bundles.length) {
        const e = await this.readEntry(bundles[i++])
        if (e) found.push(e)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    // first path wins when an app exists twice (e.g. /Applications beats ~/Applications)
    const byId = new Map<string, Entry>()
    for (const e of found.sort((a, b) => a.path.localeCompare(b.path))) {
      if (!byId.has(e.bundleId)) byId.set(e.bundleId, e)
    }
    for (const e of byId.values()) this.paths.set(e.bundleId.toLowerCase(), e.path)
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  private list(): Promise<Entry[]> {
    if (this.installed && Date.now() - this.installed.at < LIST_TTL_MS)
      return Promise.resolve(this.installed.apps)
    this.pendingList ??= this.scan()
      .then((apps) => {
        this.installed = { at: Date.now(), apps }
        return apps
      })
      .finally(() => {
        this.pendingList = null
      })
    return this.pendingList
  }

  private async pathFor(bundleId: string): Promise<string | null> {
    const key = bundleId.toLowerCase()
    if (this.paths.has(key)) return this.paths.get(key) ?? null
    await this.list()
    if (this.paths.has(key)) return this.paths.get(key) ?? null
    let found: string | null = null
    if (BUNDLE_ID.test(bundleId)) {
      try {
        const out = await this.deps.exec('/usr/bin/mdfind', [
          `kMDItemCFBundleIdentifier == '${bundleId}'`
        ])
        found = out.split('\n').find((l) => l.endsWith('.app')) ?? null
      } catch {
        found = null
      }
    }
    this.paths.set(key, found)
    return found
  }

  private async iconFor(bundleId: string, path: string): Promise<string | null> {
    const key = bundleId.toLowerCase()
    if (this.icons.has(key)) return this.icons.get(key) ?? null
    let icon: string | null = null
    try {
      icon = await this.deps.icon(path)
    } catch {
      icon = null
    }
    this.icons.set(key, icon)
    return icon
  }

  /** Name and icon for each id. An id that is not installed comes back with an empty name. */
  async info(bundleIds: string[]): Promise<AppInfo[]> {
    const ids = [...new Set(bundleIds.filter((id) => BUNDLE_ID.test(id)))].slice(0, 100)
    return Promise.all(
      ids.map(async (bundleId) => {
        const path = await this.pathFor(bundleId)
        if (!path) return { bundleId, name: '', icon: null }
        return { bundleId, name: appNameFromPath(path), icon: await this.iconFor(bundleId, path) }
      })
    )
  }

  /** Installed apps, without icons: the renderer asks for icons of the rows it shows. */
  async installedApps(): Promise<AppInfo[]> {
    return (await this.list()).map((e) => ({ bundleId: e.bundleId, name: e.name, icon: null }))
  }
}
