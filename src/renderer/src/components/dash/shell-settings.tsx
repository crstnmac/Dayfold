import { useCallback, useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { ShellPrefs, ShellStatus } from '../../../../shared/types'
import { acceleratorFromEvent, acceleratorSymbols } from '../../../../shared/shell-logic'
import { api } from '../../dash'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { TimeInput } from './time-input'
import { Kbd } from '@renderer/components/ui/kbd'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'

function Row({
  label,
  description,
  htmlFor,
  children
}: {
  label: string
  description?: string
  htmlFor?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-2">
      <label htmlFor={htmlFor} className="flex min-w-0 flex-col">
        <span className="font-medium">{label}</span>
        {description && <span className="text-sm text-muted-foreground">{description}</span>}
      </label>
      {children}
    </div>
  )
}

function HotkeyRecorder({
  value,
  disabled,
  onChange
}: {
  value: string
  disabled: boolean
  onChange: (accelerator: string) => void
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  return (
    <Button
      id="shell-hotkey"
      type="button"
      variant="secondary"
      disabled={disabled}
      aria-label={`Capture shortcut: ${acceleratorSymbols(value).join(' ')}. Activate, then press a new combination.`}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') return setRecording(false)
        const accelerator = acceleratorFromEvent(e.nativeEvent)
        if (!accelerator) return // still holding modifiers, or an unusable combination
        setRecording(false)
        if (accelerator !== value) onChange(accelerator)
      }}
      className={cn('min-w-36 gap-1 font-normal', recording && 'ring-2 ring-ring/40')}
    >
      {recording ? (
        <span className="text-muted-foreground">Press shortcut…</span>
      ) : (
        acceleratorSymbols(value).map((s, i) => <Kbd key={i}>{s}</Kbd>)
      )}
    </Button>
  )
}

/** Quick-capture hotkey, end-of-day reminder and menu-bar settings. Mount inside the Settings dialog. */
export function ShellSettings(): React.JSX.Element {
  const [prefs, setPrefs] = useState<ShellPrefs | null>(null)
  const [status, setStatus] = useState<ShellStatus | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([api.shellGetSettings(), api.shellStatus()]).then(([p, s]) => {
      if (cancelled) return
      setPrefs(p)
      setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(async (patch: Partial<ShellPrefs>): Promise<void> => {
    try {
      const r = await api.shellSetSettings(patch)
      setPrefs(r.prefs)
      setStatus(r.status)
      setWarning(r.warning)
    } catch (e) {
      toast.error(
        (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      )
    }
  }, [])

  if (!prefs || !status) return <p className="text-muted-foreground">Loading…</p>

  const nextReminder =
    status.nextReminderAt && prefs.reminderEnabled && !prefs.remindersPaused
      ? new Date(status.nextReminderAt).toLocaleString(undefined, {
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit'
        })
      : null
  const hotkeyError = warning ?? status.hotkey.error

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Row
          label="Quick capture shortcut"
          description="Capture from any app."
          htmlFor="shell-hotkey"
        >
          <span className="flex items-center gap-3">
            {prefs.hotkeyEnabled && !status.hotkey.registered && (
              <Badge variant="outline" className="text-warning">
                <TriangleAlert /> Not active
              </Badge>
            )}
            <HotkeyRecorder
              value={prefs.hotkey}
              disabled={!prefs.hotkeyEnabled}
              onChange={(hotkey) => void save({ hotkey })}
            />
            <Switch
              checked={prefs.hotkeyEnabled}
              onCheckedChange={(hotkeyEnabled) => void save({ hotkeyEnabled })}
              aria-label="Enable quick capture shortcut"
            />
          </span>
        </Row>
        {hotkeyError && (
          <p role="alert" className="pb-2.5 text-sm text-destructive">
            {hotkeyError}
          </p>
        )}
      </div>

      <div>
        <Row
          label="End-of-day reminder"
          description={
            !status.notificationsSupported
              ? 'Notifications are not available on this system.'
              : nextReminder
                ? `Next: ${nextReminder}. Skipped once you wrap up.`
                : 'A gentle nudge to wrap up your day.'
          }
        >
          <span className="flex items-center gap-3">
            <TimeInput
              label="Reminder time"
              value={prefs.reminderTime}
              disabled={!prefs.reminderEnabled}
              onChange={(reminderTime) => void save({ reminderTime })}
            />
            <Switch
              checked={prefs.reminderEnabled}
              onCheckedChange={(reminderEnabled) => void save({ reminderEnabled })}
              aria-label="Enable end-of-day reminder"
            />
          </span>
        </Row>
        <Row
          label="Pause reminders"
          description="Mute without changing the time."
          htmlFor="shell-paused"
        >
          <Switch
            id="shell-paused"
            checked={prefs.remindersPaused}
            disabled={!prefs.reminderEnabled}
            onCheckedChange={(remindersPaused) => void save({ remindersPaused })}
          />
        </Row>
      </div>

      <div>
        <Row
          label="Menu bar icon"
          description="Open Dayfold and see today's tasks from the menu bar."
          htmlFor="shell-tray"
        >
          <Switch
            id="shell-tray"
            checked={prefs.trayEnabled}
            onCheckedChange={(trayEnabled) => void save({ trayEnabled })}
          />
        </Row>
        <Row
          label="Launch at login"
          description={
            status.launchAtLoginSupported
              ? 'Start Dayfold in the menu bar when you sign in.'
              : 'Only in the installed app.'
          }
          htmlFor="shell-login"
        >
          <Switch
            id="shell-login"
            checked={prefs.launchAtLogin}
            disabled={!status.launchAtLoginSupported}
            onCheckedChange={(launchAtLogin) => void save({ launchAtLogin })}
          />
        </Row>
      </div>
    </div>
  )
}
