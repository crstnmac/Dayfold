import { Input } from '@renderer/components/ui/input'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CornerDownLeft, Plus, TriangleAlert } from 'lucide-react'
import type { InputResult } from '../../../../shared/types'
import { api } from '../../dash'
import { Kbd } from '@renderer/components/ui/kbd'
import { cn } from '@renderer/lib/utils'

const SUCCESS_MS = 1300
const ERROR_MS = 3200

/**
 * The quick-capture bar shown in its own frameless window (route `#capture`). Enter sends the text
 * through the same `submit` pipeline as the main command bar, shows one line of result, then hides.
 */
export function CaptureBar(): React.JSX.Element {
  const [text, setText] = useState('')
  const [result, setResult] = useState<InputResult | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback((): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
    setText('')
    setResult(null)
    setBusy(false)
    requestAnimationFrame(() => input.current?.focus())
  }, [])

  // The window is transparent: it must not paint the app background behind the rounded card.
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.title = 'Dayfold capture'
  }, [])

  useEffect(() => {
    input.current?.focus()
    return api.onCaptureShow(reset)
  }, [reset])

  async function submit(): Promise<void> {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    let r: InputResult
    try {
      r = await api.submit(t, 'hotkey')
    } catch (e) {
      r = { ok: false, message: (e as Error).message, undoable: false }
    }
    // Ambiguous input can't be resolved in this one-line bar; say so rather than pretending it saved.
    if (r.choices) r = { ...r, ok: false, message: `${r.message} Open Dayfold to choose.` }
    // Saved: the bar closes at once and the confirmation (with Undo) floats as its own card.
    if (r.ok && r.message) {
      await api.shellCaptureDone({ message: r.message, undoable: !!r.undoable })
      return
    }
    setResult(r)
    hideTimer.current = setTimeout(() => void api.shellHideCapture(), r.ok ? SUCCESS_MS : ERROR_MS)
  }

  const showResult = result !== null && result.message !== ''

  return (
    <div
      className="m-2 flex h-[68px] flex-col justify-center gap-1 rounded-2xl border bg-popover px-4 text-popover-foreground shadow-lg"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          void api.shellHideCapture()
        }
      }}
    >
      <div className="flex items-center gap-3">
        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          ref={input}
          value={text}
          readOnly={result !== null}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          maxLength={2000}
          autoFocus
          spellCheck={false}
          aria-label="Quick capture"
          placeholder="Capture a task or thought…"
          className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-lg shadow-none focus-visible:bg-transparent focus-visible:ring-0 dark:bg-transparent"
        />
        <CornerDownLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          'flex h-4 items-center gap-1.5 truncate pl-7 text-xs',
          showResult && !result.ok ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {showResult ? (
          <>
            {result.ok ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
            ) : (
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="truncate">{result.message}</span>
          </>
        ) : (
          <>
            <Kbd>↵</Kbd> save <Kbd>esc</Kbd> cancel
          </>
        )}
      </p>
    </div>
  )
}
