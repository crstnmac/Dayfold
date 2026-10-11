import { useEffect, useMemo, useState } from 'react'
import { EyeOff, Lock, Plus, RotateCcw, Search } from 'lucide-react'
import type { ActivityAppEntry, ActivitySummary, AppInfo } from '../../../../shared/types'
import { api, fmtDuration, prettyBundleId } from '../../dash'
import { AppIcon } from './app-icon'
import { useAppInfo } from '../../lib/app-info'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'

type Filter = 'all' | 'recorded' | 'excluded'
const BUNDLE_LIKE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9_-]+)+$/i
const MAX_PICKER = 40

interface Row extends ActivityAppEntry {
  label: string
}

/** Picks an installed app to stop recording. */
function AppPicker({
  entries,
  onPick
}: {
  entries: ActivityAppEntry[]
  onPick: (e: ActivityAppEntry) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [installed, setInstalled] = useState<AppInfo[] | null>(null)
  useEffect(() => {
    if (open && !installed) void api.listInstalledApps().then(setInstalled)
  }, [open, installed])
  const known = useMemo(() => new Map(entries.map((e) => [e.bundleId, e])), [entries])
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (installed ?? [])
      .filter((a) => !known.get(a.bundleId.toLowerCase())?.excluded)
      .filter(
        (a) =>
          !needle ||
          a.name.toLowerCase().includes(needle) ||
          a.bundleId.toLowerCase().includes(needle)
      )
      .slice(0, MAX_PICKER)
  }, [installed, q, known])
  useAppInfo(matches.map((a) => a.bundleId))
  const typed = q.trim()
  const pick = (id: string, name: string): void => {
    const lower = id.toLowerCase()
    onPick(
      known.get(lower) ?? { bundleId: lower, name, seconds: 0, excluded: false, isDefault: false }
    )
    setOpen(false)
    setQ('')
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus data-icon="inline-start" /> Stop recording an app
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search installed apps" value={q} onValueChange={setQ} />
          <CommandList>
            {installed === null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Finding apps…</p>
            ) : (
              <>
                <CommandEmpty>No matching app.</CommandEmpty>
                <CommandGroup>
                  {matches.map((a) => (
                    <CommandItem
                      key={a.bundleId}
                      value={a.bundleId}
                      onSelect={() => pick(a.bundleId, a.name)}
                    >
                      <AppIcon bundleId={a.bundleId} name={a.name} size={24} />
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    </CommandItem>
                  ))}
                  {BUNDLE_LIKE.test(typed) &&
                    !matches.some((a) => a.bundleId.toLowerCase() === typed.toLowerCase()) && (
                      <CommandItem value={`id:${typed}`} onSelect={() => pick(typed, '')}>
                        <EyeOff />
                        <span className="min-w-0 flex-1 truncate">
                          Use bundle id <span className="font-mono">{typed}</span>
                        </span>
                      </CommandItem>
                    )}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The include/exclude manager: every app Dayfold has seen, with a switch for whether it is recorded.
 * Turning one off deletes its history, so that asks first when there is any.
 */
export function AppRecording({
  s,
  onSave
}: {
  s: ActivitySummary
  onSave: (ids: string[]) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState<ActivityAppEntry | null>(null)
  const info = useAppInfo(s.apps.map((a) => a.bundleId))

  const rows: Row[] = s.apps.map((a) => ({
    ...a,
    label: info(a.bundleId)?.name || a.name || prettyBundleId(a.bundleId)
  }))
  // a protected app that was never seen and is not installed is not worth a row
  const visible = rows.filter((r) => {
    const i = info(r.bundleId)
    const notInstalled = i !== undefined && !i.name
    if (r.isDefault && r.seconds === 0 && notInstalled) return false
    if (filter === 'recorded' && r.excluded) return false
    if (filter === 'excluded' && !r.excluded) return false
    const n = q.trim().toLowerCase()
    return !n || r.label.toLowerCase().includes(n) || r.bundleId.includes(n)
  })
  const hiddenDefaults = rows.filter((r) => {
    const i = info(r.bundleId)
    return r.isDefault && r.seconds === 0 && i !== undefined && !i.name
  }).length
  const excludedCount = rows.filter((r) => r.excluded).length - hiddenDefaults
  const recordedCount = rows.filter((r) => !r.excluded).length

  const exclude = (e: ActivityAppEntry): void => {
    if (e.seconds > 0) setConfirm(e)
    else onSave([...s.exclude, e.bundleId])
  }
  const include = (e: ActivityAppEntry): void => onSave(s.exclude.filter((x) => x !== e.bundleId))
  const labelOf = (e: ActivityAppEntry): string =>
    info(e.bundleId)?.name || e.name || prettyBundleId(e.bundleId)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 px-(--card-spacing)">
        <div className="relative min-w-40 flex-1 basis-48">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search apps"
            placeholder="Search apps"
            className="ps-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          aria-label="Show"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="recorded">Recorded {recordedCount}</ToggleGroupItem>
          <ToggleGroupItem value="excluded">Off {excludedCount}</ToggleGroupItem>
        </ToggleGroup>
        <AppPicker entries={s.apps} onPick={exclude} />
      </div>

      {visible.length === 0 ? (
        <p className="px-(--card-spacing) py-6 text-center text-muted-foreground">
          {s.apps.length === 0
            ? 'Apps show up here once Dayfold has seen you use them.'
            : 'No apps match.'}
        </p>
      ) : (
        <ul className="max-h-96 overflow-y-auto" aria-label="Apps">
          {visible.map((r, i) => (
            <li
              key={r.bundleId}
              className={`flex items-center gap-3 px-(--card-spacing) py-2 ${i > 0 ? 'border-t' : ''}`}
            >
              <AppIcon bundleId={r.bundleId} name={r.label} size={32} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span
                    className={`truncate font-medium ${r.excluded ? 'text-muted-foreground' : ''}`}
                  >
                    {r.label}
                  </span>
                  {r.isDefault && (
                    <Badge variant="outline" className="shrink-0 gap-1">
                      <Lock className="size-3" /> Protected
                    </Badge>
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {r.excluded
                    ? 'Not recorded'
                    : r.seconds > 0
                      ? `${fmtDuration(r.seconds)} recorded`
                      : 'Seen, no active time yet'}
                  <span className="font-mono"> · {r.bundleId}</span>
                </span>
              </div>
              <Switch
                aria-label={`Record ${r.label}`}
                checked={!r.excluded}
                onCheckedChange={(on) => (on ? include(r) : exclude(r))}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 px-(--card-spacing) text-xs text-muted-foreground">
        <span className="flex-1">
          {hiddenDefaults > 0
            ? `${hiddenDefaults} password managers and wallets are never recorded by default.`
            : 'Password managers and wallets are never recorded by default.'}
        </span>
        <Button variant="ghost" size="xs" onClick={() => onSave(s.defaultExclude)}>
          <RotateCcw data-icon="inline-start" /> Reset to defaults
        </Button>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Stop recording {confirm ? labelOf(confirm) : 'this app'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Dayfold will no longer record its name, window titles or time. The{' '}
              {confirm ? fmtDuration(confirm.seconds) : ''} already recorded for it is deleted from
              this Mac and cannot be brought back. You can turn it on again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep recording</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) onSave([...s.exclude, confirm.bundleId])
                setConfirm(null)
              }}
            >
              Stop and delete history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
