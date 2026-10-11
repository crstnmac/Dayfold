import { ChevronDown } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { cn } from '@renderer/lib/utils'

/** A quiet one-line row that expands in place. Secondary content lives here, not on the page. */
export function Disclosure({
  label,
  hint,
  open,
  onOpenChange,
  children,
  className
}: {
  label: string
  hint?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={className}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 border-t py-3.5 text-left outline-none focus-visible:text-foreground">
        <span className="font-medium">{label}</span>
        {hint !== undefined && <span className="tabular text-muted-foreground">{hint}</span>}
        <ChevronDown
          aria-hidden
          className={cn(
            'ml-auto size-4 -rotate-90 text-muted-foreground transition-transform',
            'group-data-[state=open]:rotate-0'
          )}
        />
      </CollapsibleTrigger>
      {/* Padding lives on an inner box: on the animated element it would hold the height at 20px. */}
      <CollapsibleContent>
        <div className="pb-5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Inline "show more" link for small secondary detail inside a section. */
export function Reveal({
  label,
  children,
  className
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <Collapsible className={className}>
      <CollapsibleTrigger className="group flex w-fit items-center gap-1 text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
        {label}
        <ChevronDown
          aria-hidden
          className="size-3.5 -rotate-90 transition-transform group-data-[state=open]:rotate-0"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
