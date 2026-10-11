import { contextBridge, ipcRenderer } from 'electron'
import type { DashApi } from '../shared/types'

const api: DashApi = {
  getState: () => ipcRenderer.invoke('dash:getState'),
  demoGet: () => ipcRenderer.invoke('demo:get'),
  demoSet: (on) => ipcRenderer.invoke('demo:set', on),
  parseDate: (text) => ipcRenderer.invoke('dash:parseDate', text),
  shellGetSettings: () => ipcRenderer.invoke('shell:getSettings'),
  shellSetSettings: (patch) => ipcRenderer.invoke('shell:setSettings', patch),
  shellStatus: () => ipcRenderer.invoke('shell:status'),
  shellHideCapture: () => ipcRenderer.invoke('shell:hideCapture'),
  shellCaptureDone: (result) => ipcRenderer.invoke('shell:captureDone', result),
  onNotify: (cb) => {
    const h = (_e: unknown, p: Parameters<typeof cb>[0]): void => cb(p)
    ipcRenderer.on('shell:notify', h)
    return () => ipcRenderer.removeListener('shell:notify', h)
  },
  notifyReady: () => ipcRenderer.invoke('notify:ready'),
  notifyAction: (id, action) => ipcRenderer.invoke('notify:action', id, action),
  notifyResize: (height) => ipcRenderer.invoke('notify:resize', height),
  notifyDismiss: () => ipcRenderer.invoke('notify:dismiss'),
  navigateReady: () => ipcRenderer.invoke('dash:navReady'),
  onNavigate: (cb) => {
    const h = (_e: unknown, target: Parameters<typeof cb>[0]): void => cb(target)
    ipcRenderer.on('dash:navigate', h)
    return () => ipcRenderer.removeListener('dash:navigate', h)
  },
  onCaptureShow: (cb) => {
    const h = (): void => cb()
    ipcRenderer.on('shell:captureShown', h)
    return () => ipcRenderer.removeListener('shell:captureShown', h)
  },
  submit: (text, source) => ipcRenderer.invoke('dash:submit', text, source),
  dispatch: (command) => ipcRenderer.invoke('dash:dispatch', command),
  undo: () => ipcRenderer.invoke('dash:undo'),
  getActivity: (date) => ipcRenderer.invoke('activity:get', date),
  setActivityEnabled: (on) => ipcRenderer.invoke('activity:setEnabled', on),
  setActivityDetail: (on) => ipcRenderer.invoke('activity:setDetail', on),
  setActivityExclude: (ids) => ipcRenderer.invoke('activity:setExclude', ids),
  setActivityIdle: (sec) => ipcRenderer.invoke('activity:setIdle', sec),
  purgeActivity: () => ipcRenderer.invoke('activity:purge'),
  setActivitySnippets: (on) => ipcRenderer.invoke('activity:setSnippets', on),
  generateDayReview: (date) => ipcRenderer.invoke('activity:review', date),
  getAppInfo: (ids) => ipcRenderer.invoke('activity:appInfo', ids),
  listInstalledApps: () => ipcRenderer.invoke('activity:installedApps'),
  addActivityTask: (input) => ipcRenderer.invoke('activity:addTask', input),
  openAccessibilitySettings: () => ipcRenderer.invoke('activity:openSettings'),
  llmStatus: () => ipcRenderer.invoke('llm:status'),
  llmSetConfig: (config) => ipcRenderer.invoke('llm:setConfig', config),
  llmTest: () => ipcRenderer.invoke('llm:test'),
  llmTriage: () => ipcRenderer.invoke('llm:triage'),
  backupStatus: () => ipcRenderer.invoke('data:backupStatus'),
  backupNow: () => ipcRenderer.invoke('data:backupNow'),
  listBackups: () => ipcRenderer.invoke('data:listBackups'),
  exportData: (format, includeActivity) =>
    ipcRenderer.invoke('data:export', format, includeActivity),
  restoreBackup: (name) => ipcRenderer.invoke('data:restore', name),
  deleteAllData: (confirm) => ipcRenderer.invoke('data:deleteAll', confirm),
  revealBackups: () => ipcRenderer.invoke('data:revealBackups'),
  onChanged: (cb) => {
    const h = (_e: unknown, scope?: unknown): void =>
      cb(scope === 'activity' ? 'activity' : undefined)
    ipcRenderer.on('dash:changed', h)
    return () => ipcRenderer.removeListener('dash:changed', h)
  }
}

contextBridge.exposeInMainWorld('dash', api)
