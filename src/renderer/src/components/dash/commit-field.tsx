import { useState } from 'react'
import { Input } from '@renderer/components/ui/input'

/**
 * Text input that commits on blur / Enter only (never per keystroke), so each edit is one command
 * and one undo step. Esc reverts. Remount with a `key` containing the stored value to resync.
 */
export function CommitField({
  value,
  onCommit,
  label,
  placeholder,
  maxLength = 500,
  className
}: {
  value: string
  onCommit: (text: string) => void
  label: string
  placeholder?: string
  maxLength?: number
  className?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const commit = (): void => {
    const next = draft.trim()
    if (next === value.trim()) return setDraft(value)
    onCommit(next)
  }
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
      aria-label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      className={className}
    />
  )
}
