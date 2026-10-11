import { cn } from '@renderer/lib/utils'

export function Page({
  title,
  description,
  actions,
  children,
  className
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section
      className={cn('mx-auto flex w-full max-w-5xl flex-col gap-(--space-section)', className)}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="max-w-prose text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
      </header>
      {children}
    </section>
  )
}
