import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

const pad = (n: number): string => String(n).padStart(2, '0')

/** A 12-hour time picker built from three selects; value and onChange use "HH:MM" (24-hour). */
export function TimeInput({
  value,
  onChange,
  disabled,
  label
}: {
  value: string
  onChange: (hhmm: string) => void
  disabled?: boolean
  label: string
}): React.JSX.Element {
  const [h24, m] = value.split(':').map(Number)
  const pm = h24 >= 12
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), m])].sort(
    (a, b) => a - b
  )
  const emit = (hour12: number, minute: number, isPm: boolean): void =>
    onChange(`${pad((hour12 % 12) + (isPm ? 12 : 0))}:${pad(minute)}`)

  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      <Select disabled={disabled} value={String(h12)} onValueChange={(v) => emit(Number(v), m, pm)}>
        <SelectTrigger aria-label={`${label}, hour`} className="w-16">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <SelectItem key={h} value={String(h)}>
                {h}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select disabled={disabled} value={String(m)} onValueChange={(v) => emit(h12, Number(v), pm)}>
        <SelectTrigger aria-label={`${label}, minute`} className="w-16">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {minutes.map((mm) => (
              <SelectItem key={mm} value={String(mm)}>
                {pad(mm)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        disabled={disabled}
        value={pm ? 'pm' : 'am'}
        onValueChange={(v) => emit(h12, m, v === 'pm')}
      >
        <SelectTrigger aria-label={`${label}, am or pm`} className="w-[4.5rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="am">AM</SelectItem>
            <SelectItem value="pm">PM</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
