import { useState } from 'react'
import { DateInput } from '@renderer/components/dash/date-input'

/**
 * Date field that commits on blur/Enter or when a day is picked, never per keystroke, so typing
 * a partial date never creates an undo entry per character.
 */
export function DateField({
  value,
  onCommit,
  label,
  className
}: {
  value: string | null
  onCommit: (v: string | null) => void
  label: string
  className?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? '')

  const commitValue = (text: string): void => {
    const next = text || null
    if (next === value) return
    if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) return setDraft(value ?? '')
    if (next && Number(next.slice(0, 4)) < 2000) return setDraft(value ?? '')
    onCommit(next)
  }

  return (
    <DateInput
      label={label}
      className={className}
      value={draft}
      onChange={setDraft}
      onPick={(iso) => {
        setDraft(iso)
        commitValue(iso)
      }}
      onBlur={() => commitValue(draft)}
      onKeyDown={(e) => e.key === 'Enter' && commitValue(draft)}
    />
  )
}
