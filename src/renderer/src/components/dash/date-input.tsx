import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { Calendar } from '@renderer/components/ui/calendar'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@renderer/components/ui/input-group'
import { dateToIso, isoToDate } from '@renderer/lib/iso-date'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

/**
 * A date field you can type into (YYYY-MM-DD) or pick from a calendar popover. The caller owns the
 * text and decides when to commit, so partial typing never reaches a command.
 */
export function DateInput({
  value,
  onChange,
  onPick,
  min,
  max,
  label,
  className,
  onBlur,
  onKeyDown
}: {
  value: string
  onChange: (text: string) => void
  /** A day chosen in the calendar. Defaults to onChange. */
  onPick?: (iso: string) => void
  min?: string
  max?: string
  label: string
  className?: string
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = isoToDate(value)
  const lo = min ? isoToDate(min) : undefined
  const hi = max ? isoToDate(max) : undefined
  return (
    <InputGroup className={className}>
      <InputGroupInput
        aria-label={label}
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        maxLength={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className="tabular"
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <InputGroupButton size="icon-xs" aria-label="Open calendar">
              <CalendarIcon />
            </InputGroupButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-1">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected ?? hi ?? lo}
              disabled={[...(lo ? [{ before: lo }] : []), ...(hi ? [{ after: hi }] : [])]}
              onSelect={(d) => {
                if (!d) return
                setOpen(false)
                const iso = dateToIso(d)
                if (onPick) onPick(iso)
                else onChange(iso)
              }}
            />
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  )
}
