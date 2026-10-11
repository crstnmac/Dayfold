import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion, useAnimationControls } from 'motion/react'
import { EASE_OUT } from '@renderer/lib/motion'
import { ArrowUp } from 'lucide-react'
import type { AppState, Command, InputResult, UiFocus } from '../../shared/types'
import { api } from './dash'
import { Tabs, TabsContent } from '@renderer/components/ui/tabs'
import { NavPill } from '@renderer/components/dash/nav-pill'
import { Kbd } from '@renderer/components/ui/kbd'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@renderer/components/ui/input-group'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Toaster } from '@renderer/components/ui/sonner'
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { ProjectsView } from './views/ProjectsView'
import { TodayView } from './views/TodayView'
import { AiAssist } from '@renderer/components/dash/ai-assist'
import { SettingsDialog } from '@renderer/components/dash/settings'
import { DemoBadge } from '@renderer/components/dash/demo-mode'

// Loaded on first use: the Activity charts and the wrap-up flow are not needed to paint Today.
const ActivityView = lazy(() =>
  import('./views/ActivityView').then((m) => ({ default: m.ActivityView }))
)
const WrapupFlow = lazy(() =>
  import('@renderer/components/dash/wrapup-flow').then((m) => ({ default: m.WrapupFlow }))
)

type Tab = 'projects' | 'today' | 'activity'

const FOCUS_TAB: Record<UiFocus, Tab> = {
  dump: 'today',
  projects: 'projects',
  plate: 'today',
  wrap: 'today',
  activity: 'activity'
}

const isEvening = (): boolean => new Date().getHours() >= 17

/** Milliseconds until the next local midnight (+1s), so "today" rolls over while the app is open. */
const msToMidnight = (): number => {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime() + 1000
}

const isEditable = (el: Element | null): boolean =>
  !!el &&
  (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || (el as HTMLElement).isContentEditable)

function LoadingSkeleton(): React.JSX.Element {
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6"
      role="status"
      aria-label="Loading"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-36" />
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [tab, setTab] = useState<Tab>('today')
  const [wrapShown, setWrapShown] = useState(isEvening)
  const [text, setText] = useState('')
  const [choice, setChoice] = useState<InputResult | null>(null)
  const [wrapOpen, setWrapOpen] = useState(false)
  // Mount the wrap-up flow on first open and keep it, so its close animation still plays.
  const [wrapLoaded, setWrapLoaded] = useState(false)
  if (wrapOpen && !wrapLoaded) setWrapLoaded(true)
  const [, forceRender] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const pulse = useAnimationControls()
  const [sent, setSent] = useState(0)
  const busy = useRef(false)
  const footer = useRef<HTMLElement>(null)
  const [focused, setFocused] = useState(false)

  const inflight = useRef(false)
  const stale = useRef(false)
  const lastJson = useRef('')

  // One state request at a time: a burst (focus + visibility + change events) becomes one fetch plus
  // at most one follow-up, and an identical result keeps the old object so nothing re-renders.
  const refresh = useCallback(function load(): void {
    if (inflight.current) {
      stale.current = true
      return
    }
    inflight.current = true
    api
      .getState()
      .then((next) => {
        const json = JSON.stringify({ ...next, now: 0 })
        if (json === lastJson.current) return
        lastJson.current = json
        setState(next)
      })
      .catch(() => undefined)
      .finally(() => {
        inflight.current = false
        if (stale.current) {
          stale.current = false
          load()
        }
      })
  }, [])

  const show = useCallback((r: InputResult): void => {
    if (r.focus) setTab(FOCUS_TAB[r.focus])
    if (r.focus === 'wrap') {
      setWrapShown(true)
      setWrapOpen(true)
    }
    if (r.choices) return setChoice(r)
    if (!r.message) return
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast(r.message, {
      duration: 6000,
      action: r.undoable
        ? {
            label: 'Undo',
            onClick: () =>
              void api.undo().then((u) => (u.ok ? toast(u.message) : toast.error(u.message)))
          }
        : undefined
    })
  }, [])

  useEffect(() => {
    refresh()
    // Activity-only changes (every app switch) never touch tasks or projects.
    return api.onChanged((scope) => {
      if (scope !== 'activity') refresh()
    })
  }, [refresh])

  // Main process asks us to jump to a tab (reminder click, tray menu). 'settings' is announced to
  // the Settings dialog via a window event so this file stays decoupled from it.
  useEffect(() => {
    const off = api.onNavigate(({ tab: target }) => {
      if (target === 'settings') window.dispatchEvent(new CustomEvent('dash:open-settings'))
      else {
        setTab(target === 'dump' || target === 'eod' ? 'today' : target)
        if (target === 'eod') setWrapShown(true)
      }
    })
    // Tells the main process a freshly (re)created window can now receive a queued jump.
    void api.navigateReady()
    return off
  }, [])

  // Roll "today" over at midnight and refresh when the window regains focus.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const bump = (): void => {
      refresh()
      forceRender((n) => n + 1)
    }
    const arm = (): void => {
      t = setTimeout(() => {
        bump()
        arm()
      }, msToMidnight())
    }
    arm()
    // Coming back to the window fires both events; the second would only repeat the first.
    let last = 0
    const wake = (): void => {
      if (document.visibilityState === 'hidden') return
      const n = Date.now()
      if (n - last < 500) return
      last = n
      bump()
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      clearTimeout(t)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [refresh])

  // Keeps toasts clear of the command bar however tall the footer gets.
  useEffect(() => {
    const el = footer.current
    if (!el) return
    const set = (): void =>
      document.documentElement.style.setProperty('--footer-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
      } else if (
        mod &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'z' &&
        !isEditable(document.activeElement)
      ) {
        e.preventDefault()
        void api.undo().then((u) => show({ ...u, undoable: false }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show])

  const run = useCallback(
    async (c: Command): Promise<InputResult> => {
      try {
        const r = await api.dispatch(c)
        show(r)
        return r
      } catch (e) {
        const r = { ok: false, message: (e as Error).message, undoable: false }
        show(r)
        return r
      }
    },
    [show]
  )

  async function submit(): Promise<void> {
    const t = text.trim()
    if (!t || busy.current) return
    busy.current = true
    setText('')
    setSent((n) => n + 1)
    void pulse.start({ scale: [1, 1.014, 1], transition: { duration: 0.3, ease: EASE_OUT } })
    try {
      show(await api.submit(t, 'typed'))
    } catch (e) {
      show({ ok: false, message: (e as Error).message, undoable: false })
    } finally {
      busy.current = false
    }
  }

  return (
    <div className="relative flex h-full flex-col bg-background">
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 flex-1 gap-0">
        <header className="drag grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-3 pr-3 pl-20 sm:pr-5 sm:pl-22">
          <div>
            <DemoBadge />
          </div>
          <NavPill value={tab} />
          <div className="no-drag flex items-center justify-end gap-2">
            <AiAssist />
            <SettingsDialog />
            <span className="tabular text-muted-foreground max-[1100px]:hidden">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric'
              })}
            </span>
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <main className="px-6 pt-7 pb-[calc(var(--footer-h)+1.5rem)] sm:px-10">
            {!state ? (
              <LoadingSkeleton />
            ) : (
              <>
                <TabsContent value="today">
                  <TodayView
                    state={state}
                    run={run}
                    wrapOpen={wrapShown}
                    onWrapOpenChange={setWrapShown}
                    onStartWrapup={() => setWrapOpen(true)}
                  />
                </TabsContent>
                <TabsContent value="projects">
                  <ProjectsView state={state} run={run} />
                </TabsContent>
                <TabsContent value="activity">
                  <Suspense fallback={<LoadingSkeleton />}>
                    <ActivityView />
                  </Suspense>
                </TabsContent>
              </>
            )}
          </main>
        </ScrollArea>
      </Tabs>

      <footer
        ref={footer}
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background from-40% to-transparent px-6 pt-8 pb-5 sm:px-10"
      >
        <div className="pointer-events-auto relative mx-auto max-w-2xl">
          <AnimatePresence>
            {focused && text === '' && (
              <motion.div
                className="absolute bottom-full mb-2 flex flex-wrap gap-1.5"
                onMouseDown={(e) => e.preventDefault()}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
              >
                {['add task ', 'done with ', 'new project ', 'move '].map((p, i) => (
                  <motion.div
                    key={p}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.18, ease: EASE_OUT, delay: i * 0.03 }}
                  >
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="rounded-full text-muted-foreground"
                      onClick={() => setText(p)}
                    >
                      {p.trim()}…
                    </Button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30, delay: 0.12 }}
          >
            <motion.div animate={pulse}>
              <InputGroup className="h-12 rounded-2xl border-border/60 bg-card/95 pr-1.5 shadow-lg shadow-foreground/5 transition-[box-shadow,transform] duration-200 focus-within:-translate-y-px focus-within:shadow-xl">
                <InputGroupInput
                  ref={input}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onFocus={() => {
                    setFocused(true)
                    void pulse.start({
                      scale: [1, 1.01, 1],
                      transition: { duration: 0.28, ease: EASE_OUT }
                    })
                  }}
                  onBlur={() => setFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit()
                  }}
                  maxLength={2000}
                  className="h-full pl-4 text-base"
                  placeholder="Add, finish or move anything…"
                  aria-label="Command bar"
                  autoFocus
                />
                <InputGroupAddon align="inline-end">
                  <AnimatePresence initial={false}>
                    {text === '' && (
                      <motion.span
                        key="kbd"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.12 }}
                      >
                        <Kbd>⌘K</Kbd>
                      </motion.span>
                    )}
                  </AnimatePresence>
                  <motion.span
                    animate={{ scale: text.trim() ? 1 : 0.85, opacity: text.trim() ? 1 : 0.6 }}
                    whileTap={{ scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                    className="inline-flex"
                  >
                    <InputGroupButton
                      variant="default"
                      size="icon-sm"
                      className="overflow-hidden rounded-xl"
                      disabled={!text.trim()}
                      onClick={() => void submit()}
                      aria-label="Send"
                    >
                      <motion.span
                        key={sent}
                        className="inline-flex"
                        initial={sent > 0 ? { y: 14, opacity: 0 } : false}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.22, ease: EASE_OUT }}
                      >
                        <ArrowUp />
                      </motion.span>
                    </InputGroupButton>
                  </motion.span>
                </InputGroupAddon>
              </InputGroup>
            </motion.div>
          </motion.div>
        </div>
      </footer>

      <Dialog open={!!choice} onOpenChange={(o) => !o && setChoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{choice?.message}</DialogTitle>
            <DialogDescription>Pick the one you meant.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-2">
              {choice?.choices?.map((c) => (
                <Button
                  key={c.label}
                  variant="outline"
                  className="h-auto justify-start py-2 text-left whitespace-normal"
                  onClick={async () => {
                    setChoice(null)
                    await run(c.command)
                  }}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {state && (wrapOpen || wrapLoaded) && (
        <Suspense fallback={null}>
          <WrapupFlow open={wrapOpen} onOpenChange={setWrapOpen} state={state} />
        </Suspense>
      )}

      <Toaster
        position="bottom-right"
        offset={{ bottom: 'calc(var(--footer-h) + 0.75rem)' }}
        mobileOffset={{ bottom: 'calc(var(--footer-h) + 0.75rem)' }}
      />
    </div>
  )
}
