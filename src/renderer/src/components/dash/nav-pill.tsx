import { Activity as ActivityIcon, FolderKanban, SunMedium } from 'lucide-react'
import { MotionConfig, motion } from 'motion/react'
import { TabsList, TabsTrigger } from '@renderer/components/ui/tabs'

const ITEMS = [
  { value: 'today', label: 'Today', icon: SunMedium },
  { value: 'projects', label: 'My Projects', icon: FolderKanban },
  { value: 'activity', label: 'Activity', icon: ActivityIcon }
] as const

const GLIDE = { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 } as const
const POP = { type: 'spring', stiffness: 600, damping: 16 } as const

// Below 960px only the active tab keeps its label.
const LABEL = 'max-[960px]:group-data-[state=inactive]/nav:sr-only'

const MotionTrigger = motion.create(TabsTrigger)

/**
 * The floating section switcher: a shadcn Tabs list whose active pill glides between tabs on a
 * spring, with a tap squeeze and an icon pop. Motion respects the system reduced-motion setting.
 */
export function NavPill({ value }: { value: string }): React.JSX.Element {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className="no-drag"
        initial={{ opacity: 0, y: -12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <TabsList
          className="h-10 gap-0.5 rounded-full border bg-card/95 p-1 shadow-lg shadow-foreground/5 sm:gap-1"
          aria-label="Sections"
        >
          {ITEMS.map(({ value: v, label, icon: Icon }) => {
            const active = value === v
            return (
              <MotionTrigger
                key={v}
                value={v}
                whileTap={{ scale: 0.94 }}
                transition={GLIDE}
                className="group/nav h-8 rounded-full px-2.5 transition-colors data-active:bg-transparent data-active:text-primary-foreground data-active:hover:text-primary-foreground sm:px-3.5 dark:data-active:border-transparent dark:data-active:bg-transparent dark:data-active:text-primary-foreground dark:data-active:hover:text-primary-foreground"
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill-indicator"
                    className="absolute inset-0 rounded-full bg-primary shadow-sm"
                    transition={GLIDE}
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1.5">
                  <motion.span
                    key={active ? 'on' : 'off'}
                    className="inline-flex"
                    initial={active ? { scale: 0.55, rotate: -24 } : false}
                    animate={{ scale: 1, rotate: 0 }}
                    whileHover={active ? undefined : { scale: 1.12, rotate: -6 }}
                    transition={POP}
                  >
                    <Icon />
                  </motion.span>
                  <span className={LABEL}>{label}</span>
                </span>
              </MotionTrigger>
            )
          })}
        </TabsList>
      </motion.div>
    </MotionConfig>
  )
}
