import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// shadcn themes via a `.dark` class; follow the OS setting live.
const mq = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => {
  document.documentElement.classList.toggle('dark', mq.matches)
}
applyTheme()
mq.addEventListener('change', applyTheme)

// The overlay windows are transparent: never paint the app background while their chunk loads.
if (window.location.hash === '#capture' || window.location.hash === '#notify') {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
}

// One bundle serves three windows. Each loads only its own entry chunk, so the small overlay
// windows (quick capture, notification card) never parse or hold the main app in memory.
const load =
  window.location.hash === '#capture'
    ? () => import('./entry-capture')
    : window.location.hash === '#notify'
      ? () => import('./entry-notify')
      : () => import('./entry-app')

void load().then(({ default: Entry }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Entry />
    </StrictMode>
  )
})
