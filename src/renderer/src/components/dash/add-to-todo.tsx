import { useId, useState } from 'react'
import { ListPlus } from 'lucide-react'
import { toast } from 'sonner'
import type { AppState } from '../../../../shared/types'
import { api } from '../../dash'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

type Plan = 'today' | 'tomorrow' | 'none'

/** Popover to turn a suggestion into a to-do: editable title, plan date and project. */
export function AddToTodo({
  linkId,
  suggestion,
  hint,
  isToday,
  label
}: {
  /** Session id or review key, remembered so the item shows as added. */
  linkId: string | null
  suggestion: string
  hint: string
  isToday: boolean
  label: string
}): React.JSX.Element {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(suggestion)
  const [plan, setPlan] = useState<Plan>(isToday ? 'today' : 'none')
  const [projectId, setProjectId] = useState('')
  const [state, setState] = useState<AppState | null>(null)
  const [busy, setBusy] = useState(false)

  const onOpenChange = (o: boolean): void => {
    setOpen(o)
    if (o) {
      setTitle(suggestion)
      void api.getState().then(setState)
    }
  }
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      const r = await api.addActivityTask({
        sessionId: linkId,
        title: title.trim(),
        planDate:
          plan === 'today'
            ? (state?.today ?? null)
            : plan === 'tomorrow'
              ? (state?.tomorrow ?? null)
              : null,
        projectId: projectId ? Number(projectId) : null
      })
      if (r.ok) {
        setOpen(false)
        toast(r.message, {
          action: {
            label: 'Undo',
            onClick: () =>
              void api.undo().then((u) => (u.ok ? toast(u.message) : toast.error(u.message)))
          }
        })
      } else toast.error(r.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Add to to-do: ${label}`}>
          <ListPlus data-icon="inline-start" /> Add to to-do
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3">
        <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`t-${uid}`}>To-do</Label>
            <Input
              id={`t-${uid}`}
              autoFocus
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{hint} Edit it before adding.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`p-${uid}`}>Plan for</Label>
              <Select value={plan} onValueChange={(v) => setPlan(v as Plan)}>
                <SelectTrigger id={`p-${uid}`} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="tomorrow">Tomorrow</SelectItem>
                    <SelectItem value="none">No date</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`j-${uid}`}>Project</Label>
              <Select
                value={projectId === '' ? 'none' : projectId}
                onValueChange={(v) => setProjectId(v === 'none' ? '' : v)}
              >
                <SelectTrigger id={`j-${uid}`} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">None</SelectItem>
                    {state?.projects
                      .filter((p) => p.status === 'active')
                      .map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" size="sm" disabled={!title.trim() || busy}>
            Add to to-do
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
