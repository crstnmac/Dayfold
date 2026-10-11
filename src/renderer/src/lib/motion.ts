/** Shared micro-animation presets. Subtle on purpose: short, springy, and never decorative. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const

/** A list row that grows open when it appears and folds away when it leaves. */
export const rowMotion = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.18, ease: EASE_OUT }
} as const

/** A gentle rise for items that appear together, offset by index (capped so long lists stay quick). */
export const riseMotion = (index: number) =>
  ({
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.22, ease: EASE_OUT, delay: Math.min(index, 5) * 0.03 }
  }) as const
