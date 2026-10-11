import { motion } from 'motion/react'
import { EASE_OUT } from '@renderer/lib/motion'
import type { ActivityApp } from '../../../../shared/types'
import { fmtDuration } from '../../dash'
import { AppIcon } from './app-icon'
import { useAppInfo, useAppName } from '../../lib/app-info'

/** Time per app with the sites or products used inside it, so a browser is never a black box. */
export function TopApps({ apps }: { apps: ActivityApp[] }): React.JSX.Element {
  const nameOf = useAppName()
  useAppInfo(apps.map((a) => a.bundleId))
  if (apps.length === 0)
    return <p className="px-(--card-spacing) text-muted-foreground">No activity.</p>
  const max = Math.max(...apps.map((a) => a.seconds))
  return (
    <ol aria-label="Apps by time">
      {apps.map((a, i) => {
        const name = nameOf(a.bundleId, a.name)
        // for a native app the only "service" is the app itself; skip it
        const inside = a.services.filter((s) => s.service !== a.name && s.service !== name)
        return (
          <li
            key={a.bundleId || a.name}
            className={`flex items-center gap-3 px-(--card-spacing) py-2.5 ${i > 0 ? 'border-t' : ''}`}
          >
            <AppIcon bundleId={a.bundleId} name={name} size={32} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 truncate font-medium">{name}</span>
                <span className="tabular ms-auto shrink-0">{fmtDuration(a.seconds)}</span>
                <span className="tabular w-9 shrink-0 text-end text-xs text-muted-foreground">
                  {Math.round(a.share * 100)}%
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${name}: ${Math.round(a.share * 100)}% of active time`}
              >
                <motion.div
                  className="h-full rounded-full bg-chart-1"
                  initial={{ width: 0 }}
                  animate={{ width: `${(a.seconds / max) * 100}%` }}
                  transition={{ duration: 0.5, ease: EASE_OUT, delay: Math.min(i, 5) * 0.04 }}
                />
              </div>
              {inside.length > 0 && (
                <p className="truncate text-xs text-muted-foreground">
                  {inside.map((s) => `${s.service} ${fmtDuration(s.seconds)}`).join(' · ')}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
