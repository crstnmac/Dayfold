import { MotionConfig } from 'motion/react'
import { NotifyCard } from '@renderer/components/dash/notify-card'

export default function NotifyEntry(): React.JSX.Element {
  return (
    <MotionConfig reducedMotion="user">
      <NotifyCard />
    </MotionConfig>
  )
}
