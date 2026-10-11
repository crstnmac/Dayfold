import { useAppInfo } from '../../lib/app-info'
import { cn } from '@renderer/lib/utils'

function hue(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export function AppIcon({
  bundleId,
  name,
  size = 24,
  className
}: {
  bundleId: string
  name: string
  size?: number
  className?: string
}): React.JSX.Element {
  const info = useAppInfo(bundleId ? [bundleId] : [])(bundleId)
  const style = { width: size, height: size }
  if (info?.icon) {
    return (
      <img
        src={info.icon}
        alt=""
        draggable={false}
        style={style}
        className={cn('shrink-0 select-none', className)}
      />
    )
  }
  // No icon (web service, uninstalled app, still loading): a tile with the initial, stable per app
  return (
    <span
      aria-hidden
      style={{
        ...style,
        fontSize: Math.round(size * 0.46),
        background: `oklch(0.58 0.08 ${hue(bundleId || name)})`
      }}
      className={cn(
        'grid shrink-0 place-items-center rounded-[22%] font-semibold text-white select-none',
        className
      )}
    >
      {(name || '?').trim().charAt(0).toUpperCase()}
    </span>
  )
}
