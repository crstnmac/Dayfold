import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarClock, Check, MoonStar, Sparkles } from 'lucide-react'
import type { NotifyPayload } from '../../../../shared/types'
import { api } from '../../dash'
import { Button } from '@renderer/components/ui/button'

const ICON = {
  reminder: MoonStar,
  capture: Check,
  deadline: CalendarClock,
  peek: Sparkles
} as const

/**
 * One notification card, shown in its own transparent always-on-top window (route `#notify`).
 * It slides in from the right, counts down on a hairline that pauses while the pointer is over
 * it, and slides out before the window is hidden.
 */
export function NotifyCard(): React.JSX.Element {
  const [card, setCard] = useState<NotifyPayload | null>(null)
  const [open, setOpen] = useState(false)
  const inner = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.title = 'Dayfold notification'
    const off = api.onNotify((p) => {
      setCard(p)
      setOpen(true)
    })
    void api.notifyReady()
    return off
  }, [])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  // The window is sized to the card, so report the card's height whenever it changes.
  useEffect(() => {
    const el = inner.current
    if (!el) return
    const report = (): void => void api.notifyResize(el.offsetHeight + 24)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [card, open])

  const act = (action: string): void => {
    if (card && action !== 'dismiss') void api.notifyAction(card.id, action)
    close()
  }

  const Icon = card ? ICON[card.kind] : null

  return (
    <div className="p-3">
      <AnimatePresence onExitComplete={() => void api.notifyDismiss()}>
        {open && card && Icon && (
          <motion.div
            key={card.id}
            ref={inner}
            role={card.kind === 'peek' ? 'dialog' : 'status'}
            aria-live="polite"
            aria-label={card.title}
            className="group relative overflow-hidden rounded-2xl bg-popover text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/8"
            initial={{ opacity: 0, x: 28, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <div className="flex gap-3 p-4">
              <motion.span
                className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted"
                initial={{ scale: 0.5, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 520, damping: 16, delay: 0.08 }}
              >
                <Icon className="size-4" aria-hidden />
              </motion.span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="font-display text-base leading-snug font-semibold [overflow-wrap:anywhere]">
                  {card.title}
                </p>
                {card.body && <p className="text-muted-foreground">{card.body}</p>}
                {card.lines && (
                  <ul className="flex flex-col gap-0.5 text-muted-foreground">
                    {card.lines.map((l) => (
                      <li key={l} className="[overflow-wrap:anywhere]">
                        {l}
                      </li>
                    ))}
                  </ul>
                )}
                {card.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {card.actions.map((a) => (
                      <Button
                        key={a.id}
                        size="sm"
                        variant={a.primary ? 'default' : 'ghost'}
                        onClick={() => act(a.id)}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {card.timeoutMs !== null && (
              <div className="h-0.5 w-full bg-muted/60" aria-hidden>
                <div
                  className="h-full origin-left bg-foreground/40 [animation-play-state:running] group-hover:[animation-play-state:paused]"
                  style={{
                    animation: `notify-countdown ${card.timeoutMs}ms linear forwards`
                  }}
                  onAnimationEnd={close}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
