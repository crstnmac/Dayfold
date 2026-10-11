import { useEffect, useState } from 'react'
import { Sparkles, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type {
  LlmConfig,
  LlmProviderId,
  LlmProviderStatus,
  LlmStatus
} from '../../../../shared/types'
import { api } from '../../dash'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { RadioCard, RadioGroup } from '@renderer/components/ui/radio-group'
import { Reveal } from './disclosure'
import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/utils'

const usable = (p: LlmProviderStatus): boolean =>
  p.installed && p.loggedIn === true && p.authMethod === 'subscription'

function ProviderCard({ p }: { p: LlmProviderStatus }): React.JSX.Element {
  const ok = usable(p)
  return (
    <RadioCard value={p.id} disabled={!ok}>
      <span className="flex items-center gap-2 font-medium">
        {p.label}
        <span
          className={cn('size-1.5 rounded-full', ok ? 'bg-success' : 'bg-muted-foreground/50')}
          aria-hidden
        />
        <span className="sr-only">{ok ? 'Ready' : 'Not ready'}</span>
        {p.version && <span className="ml-auto text-xs text-muted-foreground">{p.version}</span>}
      </span>
      <span className="text-sm text-muted-foreground">
        {p.detail}
        {p.account ? ` (${p.account})` : ''}
      </span>
    </RadioCard>
  )
}

export function AiAssist(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [config, setConfig] = useState<LlmConfig>({ provider: null, model: '' })
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load once for the header indicator; re-detect on open so a terminal login is picked up.
  useEffect(() => {
    let cancelled = false
    api
      .llmStatus()
      .then((s) => {
        if (cancelled) return
        setStatus(s)
        setConfig(s.config)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [open])

  const dirty = status !== null && JSON.stringify(config) !== JSON.stringify(status.config)
  const active = status?.providers.find((p) => p.id === status.config.provider)

  async function save(): Promise<void> {
    setBusy('save')
    setError(null)
    try {
      const s = await api.llmSetConfig(config)
      setStatus(s)
      setConfig(s.config)
      toast(s.config.provider ? 'AI assist is on' : 'AI assist is off')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function test(): Promise<void> {
    setBusy('test')
    setError(null)
    try {
      const r = await api.llmTest()
      if (r.ok) toast.success(r.message)
      else setError(r.message)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const pick = (id: LlmProviderId | null): void => setConfig({ ...config, provider: id })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="no-drag" aria-label="AI assist settings">
          <Sparkles /> <span className="max-[960px]:sr-only">AI assist</span>
          {status?.config.provider && (
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>AI assist</DialogTitle>
          <DialogDescription>
            Let your Claude or ChatGPT subscription interpret what the built-in rules can&apos;t. It
            uses the CLI you&apos;re already signed in to, so no API key is stored.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <RadioGroup
            aria-label="Provider"
            value={config.provider ?? 'off'}
            onValueChange={(v) => pick(v === 'off' ? null : (v as LlmProviderId))}
          >
            <RadioCard value="off">
              <span className="font-medium">Off</span>
              <span className="text-sm text-muted-foreground">
                Rules only. Anything unrecognised goes to Inbox. Nothing leaves your Mac.
              </span>
            </RadioCard>
            {!status ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Checking installed CLIs…
              </p>
            ) : (
              status.providers.map((p) => <ProviderCard key={p.id} p={p} />)
            )}
          </RadioGroup>

          {config.provider && (
            <Reveal label="Model and privacy" className="text-sm">
              <div className="flex flex-col gap-4 pt-1">
                <label className="flex flex-col gap-1.5">
                  <span className="font-medium">Model (optional)</span>
                  <Input
                    value={config.model}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    placeholder={
                      status?.providers.find((p) => p.id === config.provider)?.defaultModel ||
                      'Provider default'
                    }
                    maxLength={64}
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                  <span className="text-xs text-muted-foreground">
                    Leave empty for the default. Smaller models are faster for this job.
                  </span>
                </label>
                <p className="text-xs text-muted-foreground">
                  The text you typed plus a short snapshot (today&apos;s date, project and open task
                  titles, Inbox items) is sent to{' '}
                  {config.provider === 'claude' ? 'Anthropic' : 'OpenAI'} through the CLI, only for
                  input the rules couldn&apos;t handle. The model can only propose changes; Dayfold
                  checks them and every change can be undone.
                </p>
              </div>
            </Reveal>
          )}

          {error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={test}
            disabled={
              busy !== null || dirty || !status?.config.provider || !active || !usable(active)
            }
          >
            {busy === 'test' && <Spinner />} Test connection
          </Button>
          <Button onClick={save} disabled={busy !== null || !dirty}>
            {busy === 'save' && <Spinner />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
