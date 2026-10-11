import { MotionConfig } from 'motion/react'
import App from './App'

export default function AppEntry(): React.JSX.Element {
  return (
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  )
}
