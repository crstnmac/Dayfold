import type { DashApi } from '../shared/types'

declare global {
  interface Window {
    dash: DashApi
  }
}
