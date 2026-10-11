import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ShieldAlert, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ActivitySummary } from '../../../shared/types'
import { api, fmtClock, fmtDuration, sessionTotal } from '../dash'
import { Page } from '@renderer/components/dash/page'
import { Disclosure } from '@renderer/components/dash/disclosure'
import { ActivityTimeline } from '@renderer/components/dash/activity-timeline'
import { ActivitySessions } from '@renderer/components/dash/activity-sessions'
import { TopApps } from '@renderer/components/dash/activity-apps'
import { DayReviewPanel } from '@renderer/components/dash/day-review'
import { AppRecording } from '@renderer/components/dash/app-recording'
import { AppIcon } from '@renderer/components/dash/app-icon'
import { useAppInfo, useAppName } from '../lib/app-info'
import { Button } from '@renderer/components/ui/button'
import { DateInput } from '@renderer/components/dash/date-input'
import { isoToDate } from '@renderer/lib/iso-date'
import { Switch } from '@renderer/components/ui/switch'
import { Label } from '@renderer/components/ui/label'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Progress } from '@renderer/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Separator } from '@renderer/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@renderer/components/ui/alert-dialog'

const IDLE_CHOICES = [60, 120, 300, 600, 900, 1800]
const ACTIVITY_REFRESH_MS = 3000

function shiftDay(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** A switch with a plain-language line under it, so each setting says what it does. */
function Setting({
  id,
  label,
  description,
  checked,
  onChange
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} className="mt-0.5" checked={checked} onCheckedChange={onChange} />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export function ActivityView(): React.JSX.Element {
  const [s, setS] = useState<ActivitySummary | null>(null)
  const [date, setDate] = useState<string | undefined>(undefined)
  const [aiOn, setAiOn] = useState(false)
  const [consent, setConsent] = useState(false)
  const [dayDraft, setDayDraft] = useState<string | null>(null)
  useEffect(() => {
    const check = (): void => void api.llmStatus().then((l) => setAiOn(l.config.provider !== null))
    check()
    return api.onChanged((scope) => {
      if (scope !== 'activity') check() // the AI provider cannot change by switching apps
    })
  }, [])
  const load = useCallback(() => void api.getActivity(date).then(setS), [date])
  useEffect(() => {
    load()
    // Tracking reports every app switch. Those redraws are batched to one per ACTIVITY_REFRESH_MS;
    // anything the user did (add a to-do, change a setting) refreshes at once.
    let timer: ReturnType<typeof setTimeout> | null = null
    let last = Date.now()
    const off = api.onChanged((scope) => {
      if (scope !== 'activity') return load()
      if (timer) return
      timer = setTimeout(
        () => {
          timer = null
          last = Date.now()
          load()
        },
        Math.max(0, ACTIVITY_REFRESH_MS - (Date.now() - last))
      )
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [load])
  if (!s)
    return (
      <div
        className="mx-auto flex w-full max-w-5xl flex-col gap-6"
        role="status"
        aria-label="Loading"
      >
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  const max = Math.max(1, ...s.byCategory.map((c) => c.seconds))
  const isToday = s.dayEnd > s.now && s.dayStart <= s.now
  const hasData = s.segments.length > 0
  const fail = (e: unknown): void =>
    void toast.error(
      String((e as Error).message ?? e).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        ''
      )
    )
  const saveExclude = (ids: string[]): void =>
    void api.setActivityExclude(ids).then(setS).catch(fail)
  const dayLabel = new Date(s.dayStart).toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  })
  const tracked = s.todayTotalSeconds + s.idleSeconds
  const activePct = tracked > 0 ? Math.round((s.todayTotalSeconds / tracked) * 100) : 0

  const settings = (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
        <Setting
          id="trk"
          label="Tracking"
          description={
            s.enabled
              ? s.running
                ? 'Running. Records the app in front and how long you use it.'
                : 'Starting. Records the app in front and how long you use it.'
              : 'Off. Turn on to record the app in front and how long you use it.'
          }
          checked={s.enabled}
          onChange={(v) => void api.setActivityEnabled(v).then(setS)}
        />
        <Setting
          id="det"
          label="Capture detail"
          description="Also keep redacted chat, thread and document names. Turning it off deletes what was stored."
          checked={s.captureDetail}
          onChange={(v) => void api.setActivityDetail(v).then(setS)}
        />
        <Setting
          id="snip"
          label="Read visible text"
          description="Also keep a short, redacted summary of the text in the window in front, so sessions say what you worked on. Off by default."
          checked={s.snippets}
          onChange={(v) => (v ? setConsent(true) : void api.setActivitySnippets(false).then(setS))}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="idle">Count as idle after</Label>
          <Select
            value={String(s.idleThreshold)}
            onValueChange={(v) => void api.setActivityIdle(Number(v)).then(setS).catch(fail)}
          >
            <SelectTrigger id="idle" size="sm" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[...new Set([...IDLE_CHOICES, s.idleThreshold])]
                  .sort((x, y) => x - y)
                  .map((v) => (
                    <SelectItem key={v} value={String(v)}>
                      {v >= 60 ? `${Math.round(v / 60)} min` : `${v} s`} without input
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-fit">
            <Trash2 data-icon="inline-start" /> Purge history
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all tracked activity?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every activity row from this Mac.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await api.purgeActivity()
                load()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

  const consentDialog = (
    <AlertDialog open={consent} onOpenChange={setConsent}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Let Dayfold read visible text?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p>
                About every 30 seconds Dayfold reads the text visible in the window in front through
                macOS Accessibility, keeps only a few redacted lines, and stores them on this Mac
                for 14 days.
              </p>
              <ul className="list-disc ps-5">
                <li>Never read from password fields, private browser windows or excluded apps.</li>
                <li>Never kept from banking, sign-in or other sensitive sites.</li>
                <li>
                  Lines mentioning passwords, keys, tokens or card numbers are dropped, and emails,
                  phone numbers and IP addresses are masked.
                </li>
                <li>
                  Nothing is sent anywhere unless you press Review my day, which gives the redacted
                  lines to your AI assistant to write the review.
                </li>
                <li>Turning this off deletes everything it stored.</li>
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={() => void api.setActivitySnippets(true).then(setS)}>
            Turn on
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  if (!s.enabled)
    return (
      <Page className="max-w-xl gap-8" title="Activity" description="See where your time goes.">
        <div className="flex flex-col gap-6 rounded-3xl bg-muted/50 p-8">
          <div className="flex flex-col gap-2">
            <ShieldAlert className="size-6 text-muted-foreground" aria-hidden />
            <h2 className="text-xl font-semibold">Tracking is off</h2>
            <p className="text-muted-foreground">
              Turn it on and macOS will ask for Accessibility permission. By default Dayfold records
              the app in front, window titles and browser page hosts, never field contents, page
              text or messages. Banking, sign-in and password sites are never recorded, and private
              browsing windows are skipped. Everything stays on this Mac.
            </p>
          </div>
          <Setting
            id="trk"
            label="Tracking"
            description="Off. Turn on to record the app in front and how long you use it."
            checked={false}
            onChange={(v) => void api.setActivityEnabled(v).then(setS)}
          />
        </div>
        {consentDialog}
      </Page>
    )

  return (
    <Page
      className="max-w-3xl gap-8"
      title="Activity"
      description={isToday ? `Today, ${dayLabel}` : dayLabel}
    >
      {s.trusted === false && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Accessibility permission missing</AlertTitle>
          <AlertDescription>
            <span>
              Only app names are tracked until you allow Dayfold (or Electron in development) under
              Privacy &amp; Security, Accessibility. Tracking picks the change up automatically, no
              restart needed.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 w-fit"
              onClick={() => void api.openAccessibilitySettings()}
            >
              Open System Settings
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {s.helperError && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Tracking helper is not running</AlertTitle>
          <AlertDescription>{s.helperError}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="tabular text-6xl font-semibold tracking-tight">
            {fmtDuration(s.todayTotalSeconds)}
          </span>
          <span className="tabular text-muted-foreground">
            active
            {tracked > 0 && ` · ${activePct}% of ${fmtDuration(tracked)} tracked`}
            {s.stats.longestFocusSeconds > 0 &&
              ` · longest focus ${fmtDuration(s.stats.longestFocusSeconds)}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous day"
            disabled={s.date <= s.earliestDate}
            onClick={() => {
              setDayDraft(null)
              setDate(shiftDay(s.date, -1))
            }}
          >
            <ChevronLeft />
          </Button>
          <DateInput
            label="Day"
            className="w-44"
            value={dayDraft ?? s.date}
            min={s.earliestDate}
            max={shiftDay(s.earliestDate, s.retentionDays)}
            onChange={(v) => {
              const d = isoToDate(v)
              if (d && v >= s.earliestDate && v <= shiftDay(s.earliestDate, s.retentionDays)) {
                setDayDraft(null)
                setDate(v)
              } else setDayDraft(v)
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next day"
            disabled={isToday}
            onClick={() => {
              setDayDraft(null)
              setDate(shiftDay(s.date, 1))
            }}
          >
            <ChevronRight />
          </Button>
          {!isToday && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDayDraft(null)
                setDate(undefined)
              }}
            >
              Today
            </Button>
          )}
        </div>
      </div>

      {hasData ? (
        <ActivityTimeline
          segments={s.segments}
          dayStart={s.dayStart}
          dayEnd={s.dayEnd}
          now={s.now}
        />
      ) : (
        <p className="py-6 text-muted-foreground">
          {isToday
            ? s.trusted === false
              ? 'Allow Accessibility above, then switch between a few apps.'
              : 'Nothing recorded yet. Switch between a few apps and they will appear here.'
            : 'Nothing was recorded on this day.'}
        </p>
      )}

      {s.byApp.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Top apps">
          <h2 className="text-lg font-semibold">Top apps</h2>
          <TopApps apps={s.byApp} />
        </section>
      )}

      <div className="flex flex-col">
        <Disclosure
          label="Day review"
          hint={aiOn ? undefined : 'needs an AI assistant'}
          className="[&>button]:border-t"
        >
          <DayReviewPanel s={s} aiOn={aiOn} isToday={isToday} />
        </Disclosure>
        <Disclosure
          label="Work sessions"
          hint={s.sessions.length > 0 ? sessionTotal(s.sessions) : undefined}
        >
          <ActivitySessions
            sessions={s.sessions}
            isToday={isToday}
            tracking={s.enabled}
            review={s.review}
          />
        </Disclosure>
        {s.byCategory.length > 0 && (
          <Disclosure label="By category">
            <div className="flex flex-col gap-3">
              {s.byCategory.map((c) => (
                <div key={c.category} className="grid grid-cols-[6rem_1fr_4rem] items-center gap-3">
                  <span className="capitalize">{c.category}</span>
                  <Progress value={(c.seconds / max) * 100} aria-label={c.category} />
                  <span className="tabular text-end text-muted-foreground">
                    {fmtDuration(c.seconds)}
                  </span>
                </div>
              ))}
            </div>
          </Disclosure>
        )}
        <Disclosure label="Choose what is recorded">
          <p className="pb-3 text-muted-foreground">
            Turn an app off and Dayfold stops recording it completely: no name, title or time, and
            what was already stored for it is deleted.
          </p>
          <AppRecording s={s} onSave={saveExclude} />
        </Disclosure>
        <Disclosure label="Raw log" hint={`latest ${s.recent.length}`}>
          <RawLog s={s} />
        </Disclosure>
        <Disclosure label="Tracking settings" className="border-b">
          {settings}
        </Disclosure>
      </div>
      {consentDialog}
    </Page>
  )
}

/** The unprocessed log, for anyone who wants to check what was stored. */
function RawLog({ s }: { s: ActivitySummary }): React.JSX.Element {
  const nameOf = useAppName()
  useAppInfo(s.recent.map((r) => r.bundleId))
  return (
    <div>
      {s.recent.length === 0 && <p className="py-3 text-muted-foreground">Nothing yet.</p>}
      {s.recent.map((r, i) => (
        <div key={r.id}>
          {i > 0 && <Separator />}
          <div className="flex items-center gap-3 py-2">
            <span className="tabular w-14 text-xs text-muted-foreground">{fmtClock(r.ts)}</span>
            <AppIcon bundleId={r.bundleId} name={r.service} size={20} />
            <div className="min-w-0 flex-1">
              <p className="truncate">
                {nameOf(r.bundleId, r.service)}{' '}
                <span className="text-muted-foreground">· {r.idle ? 'idle' : r.kind}</span>
              </p>
              {r.detail && <p className="truncate text-xs text-muted-foreground">{r.detail}</p>}
            </div>
            <span className="text-xs text-muted-foreground">{r.category}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
