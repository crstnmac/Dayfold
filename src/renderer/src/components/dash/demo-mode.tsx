import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../dash'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'

/** Whether the app is running on the sample-data database. Null until known. */
function useDemo(): boolean | null {
  const [demo, setDemo] = useState<boolean | null>(null)
  useEffect(() => {
    api
      .demoGet()
      .then(setDemo)
      .catch(() => setDemo(false))
  }, [])
  return demo
}

function useToggle(): { busy: boolean; set: (on: boolean) => Promise<void> } {
  const [busy, setBusy] = useState(false)
  async function set(on: boolean): Promise<void> {
    setBusy(true)
    const r = await api.demoSet(on).catch((e: Error) => ({ ok: false, message: e.message }))
    // On success the app relaunches, so the button stays busy until the window closes.
    if (!r.ok) {
      toast.error(r.message)
      setBusy(false)
    }
  }
  return { busy, set }
}

/** Settings section: switch to a copy of the app filled with sample data, and back. */
export function DemoModeSettings(): React.JSX.Element {
  const demo = useDemo()
  const { busy, set } = useToggle()
  return (
    <section className="flex flex-col gap-3 border-t pt-5">
      <div>
        <h3 className="font-semibold">Demo Mode</h3>
        <p className="text-sm text-muted-foreground">
          Explore Dayfold with realistic sample projects, tasks, wrap-ups and a week of activity.
          Your own data is not touched and is hidden until you turn Demo Mode off. The app restarts
          when you switch.
        </p>
      </div>
      <div>
        <Button
          variant={demo ? 'default' : 'secondary'}
          disabled={demo === null || busy}
          onClick={() => void set(!demo)}
        >
          {busy ? <Spinner /> : <FlaskConical />}
          {demo ? 'Exit Demo Mode' : 'Start Demo Mode'}
        </Button>
      </div>
    </section>
  )
}

/** Header pill shown while Demo Mode is on, so sample data is never mistaken for real data. */
export function DemoBadge(): React.JSX.Element | null {
  const demo = useDemo()
  const { busy, set } = useToggle()
  if (!demo) return null
  return (
    <div className="no-drag flex items-center gap-2 text-sm">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
        <FlaskConical className="size-3.5" /> Demo Mode
      </span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void set(false)}>
        {busy && <Spinner />} Exit
      </Button>
    </div>
  )
}
