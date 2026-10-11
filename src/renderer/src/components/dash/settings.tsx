import { useCallback, useEffect, useState } from 'react'
import {
  DatabaseBackup,
  Download,
  FolderOpen,
  History,
  Settings,
  TriangleAlert,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import type { BackupInfo, BackupStatus, ExportFormat } from '../../../../shared/types'
import { api } from '../../dash'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@renderer/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { RadioCard, RadioGroup } from '@renderer/components/ui/radio-group'
import { Spinner } from '@renderer/components/ui/spinner'
import { Switch } from '@renderer/components/ui/switch'
import { ShellSettings } from './shell-settings'
import { DemoModeSettings } from './demo-mode'

const when = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const size = (b: number): string =>
  b < 1048576 ? `${Math.ceil(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`
const KIND_LABEL: Record<BackupInfo['kind'], string> = {
  daily: 'Daily backup',
  'pre-migration': 'Before update',
  'pre-restore': 'Before restore'
}

function Section({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3 border-t pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function RestoreDialog({ onClosed }: { onClosed: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function onOpenChange(o: boolean): void {
    setOpen(o)
    if (!o) return onClosed()
    setPicked(null)
    setBackups(null)
    api
      .listBackups()
      .then(setBackups)
      .catch((e: Error) => toast.error(e.message))
  }

  async function restore(): Promise<void> {
    if (!picked) return
    setBusy(true)
    const r = await api
      .restoreBackup(picked)
      .catch((e: Error) => ({ ok: false, message: e.message }))
    if (r.ok) toast.success(r.message)
    else {
      toast.error(r.message)
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="secondary">
          <History /> Restore from backup…
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Restore from backup</AlertDialogTitle>
          <AlertDialogDescription>
            Pick a backup. Dayfold saves your current data as a safety copy first, then restarts
            with the backup&apos;s contents.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <RadioGroup
          aria-label="Backups"
          value={picked ?? ''}
          onValueChange={setPicked}
          className="max-h-64 gap-1.5 overflow-y-auto"
        >
          {backups === null && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Loading…
            </p>
          )}
          {backups?.length === 0 && (
            <p className="text-sm text-muted-foreground">No backups yet.</p>
          )}
          {backups?.map((b) => (
            <RadioCard key={b.name} value={b.name} className="rounded-xl px-3 py-2 text-sm">
              <span className="font-medium">{when(b.modified)}</span>
              <span className="text-xs text-muted-foreground">
                {KIND_LABEL[b.kind]} · {size(b.size)}
              </span>
            </RadioCard>
          ))}
        </RadioGroup>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={restore} disabled={!picked || busy}>
            {busy && <Spinner />} Restore and restart
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeleteAllDialog({ onClosed }: { onClosed: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  function onOpenChange(o: boolean): void {
    setOpen(o)
    if (o) setText('')
    else onClosed()
  }

  async function wipe(): Promise<void> {
    setBusy(true)
    const r = await api.deleteAllData(text).catch((e: Error) => ({ ok: false, message: e.message }))
    setBusy(false)
    if (r.ok) {
      toast.success(r.message)
      onOpenChange(false)
    } else toast.error(r.message)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <Trash2 /> Delete all data…
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete all data?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently erases your Inbox, projects, tasks, history and Activity data, and
            deletes every backup. It cannot be undone. Your preferences are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex flex-col gap-1.5 text-sm">
          <span>
            Type <strong>DELETE</strong> to confirm
          </span>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && text === 'DELETE' && !busy && void wipe()}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            maxLength={20}
          />
        </label>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={wipe} disabled={text !== 'DELETE' || busy}>
            {busy ? <Spinner /> : <Trash2 />} Delete everything
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DataSection(): React.JSX.Element {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [busy, setBusy] = useState<'backup' | ExportFormat | null>(null)
  const [includeActivity, setIncludeActivity] = useState(false)

  const refresh = useCallback(() => {
    api
      .backupStatus()
      .then(setStatus)
      .catch((e: Error) => toast.error(e.message))
  }, [])
  useEffect(refresh, [refresh])

  async function backupNow(): Promise<void> {
    setBusy('backup')
    try {
      const s = await api.backupNow()
      setStatus(s)
      if (s.lastError) toast.error(`Backup failed: ${s.lastError}`)
      else toast.success('Backup saved')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function exportAs(format: ExportFormat): Promise<void> {
    setBusy(format)
    try {
      const r = await api.exportData(format, includeActivity)
      if (r.ok) toast.success(`Exported to ${r.path}`)
      else if (!r.canceled) toast.error(`Export failed: ${r.message ?? 'unknown error'}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Backups"
        description="Dayfold backs up your data daily on this Mac and keeps the 14 most recent."
      >
        {status?.lastError && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Last backup failed</AlertTitle>
            <AlertDescription>{status.lastError}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm" aria-live="polite">
          {status === null
            ? 'Checking…'
            : status.last
              ? `Last daily backup: ${when(status.last)} · ${status.count} stored`
              : 'No backup yet'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={backupNow} disabled={busy !== null}>
            {busy === 'backup' ? <Spinner /> : <DatabaseBackup />} Back up now
          </Button>
          <RestoreDialog onClosed={refresh} />
          <Button variant="ghost" onClick={() => void api.revealBackups()}>
            <FolderOpen /> Show in Finder
          </Button>
        </div>
      </Section>

      <Section
        title="Export"
        description="Save a copy of everything you have entered, to a place you choose."
      >
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="flex flex-col">
            <span className="font-medium">Include activity</span>
            <span className="text-muted-foreground">
              App and window history is sensitive, so it is left out unless you opt in.
            </span>
          </span>
          <Switch checked={includeActivity} onCheckedChange={setIncludeActivity} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => exportAs('json')} disabled={busy !== null}>
            {busy === 'json' ? <Spinner /> : <Download />} Export JSON
          </Button>
          <Button variant="secondary" onClick={() => exportAs('markdown')} disabled={busy !== null}>
            {busy === 'markdown' ? <Spinner /> : <Download />} Export Markdown
          </Button>
        </div>
      </Section>

      <Section title="Danger zone">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Erase everything Dayfold has stored, including backups. This cannot be undone.
          </p>
          <DeleteAllDialog onClosed={refresh} />
        </div>
      </Section>
    </div>
  )
}

export function SettingsDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // The tray's "Settings…" item asks the main window to open this dialog.
  useEffect(() => {
    const onOpen = (): void => setOpen(true)
    window.addEventListener('dash:open-settings', onOpen)
    return () => window.removeEventListener('dash:open-settings', onOpen)
  }, [])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="no-drag" aria-label="Settings">
          <Settings />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Your data lives on this Mac only.</DialogDescription>
        </DialogHeader>
        <DialogBody className="gap-6">
          <div className="flex flex-col gap-6">
            <Section title="General">
              <ShellSettings />
            </Section>
            <DemoModeSettings />
            <div className="border-t pt-6">
              <DataSection />
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
