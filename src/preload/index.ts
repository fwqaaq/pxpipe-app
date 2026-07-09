import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppSettings,
  AppUpdateStatus,
  PersistedEvent,
  ProxyStatus,
  PxpipeDesktopApi
} from '../shared/types'

const pxpipe: PxpipeDesktopApi = {
  getSettings: () => ipcRenderer.invoke('pxpipe:getSettings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke('pxpipe:updateSettings', patch),
  startProxy: (patch?: Partial<AppSettings>) => ipcRenderer.invoke('pxpipe:startProxy', patch),
  stopProxy: () => ipcRenderer.invoke('pxpipe:stopProxy'),
  getProxyStatus: () => ipcRenderer.invoke('pxpipe:getProxyStatus'),
  listEvents: (limit?: number) => ipcRenderer.invoke('pxpipe:listEvents', limit),
  getStats: () => ipcRenderer.invoke('pxpipe:getStats'),
  listSessions: (limit?: number) => ipcRenderer.invoke('pxpipe:listSessions', limit),
  getProxyVerification: () => ipcRenderer.invoke('pxpipe:getProxyVerification'),
  getDashboardRecent: () => ipcRenderer.invoke('pxpipe:getDashboardRecent'),
  getProxyStats: () => ipcRenderer.invoke('pxpipe:getProxyStats'),
  getCurrentSession: () => ipcRenderer.invoke('pxpipe:getCurrentSession'),
  setCompressionEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('pxpipe:setCompressionEnabled', enabled),
  getImageVsTextBreakdown: (id?: number) =>
    ipcRenderer.invoke('pxpipe:getImageVsTextBreakdown', id),
  getTokenImage: (id?: number) => ipcRenderer.invoke('pxpipe:getTokenImage', id),
  getImageSource: (id?: number) => ipcRenderer.invoke('pxpipe:getImageSource', id),
  launchClaude: (cwd?: string) => ipcRenderer.invoke('pxpipe:launchClaude', cwd),
  launchCodex: (cwd?: string) => ipcRenderer.invoke('pxpipe:launchCodex', cwd),
  importJsonl: (path: string) => ipcRenderer.invoke('pxpipe:importJsonl', path),
  getUpdateStatus: () => ipcRenderer.invoke('pxpipe:getUpdateStatus'),
  checkForUpdates: () => ipcRenderer.invoke('pxpipe:checkForUpdates'),
  installUpdate: () => ipcRenderer.invoke('pxpipe:installUpdate'),
  onProxyEvent: (callback: (event: PersistedEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PersistedEvent): void =>
      callback(payload)
    ipcRenderer.on('pxpipe:event', listener)
    return () => ipcRenderer.off('pxpipe:event', listener)
  },
  onProxyStatus: (callback: (status: ProxyStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ProxyStatus): void =>
      callback(payload)
    ipcRenderer.on('pxpipe:status', listener)
    return () => ipcRenderer.off('pxpipe:status', listener)
  },
  onUpdateStatus: (callback: (status: AppUpdateStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppUpdateStatus): void =>
      callback(payload)
    ipcRenderer.on('pxpipe:updateStatus', listener)
    return () => ipcRenderer.off('pxpipe:updateStatus', listener)
  },
  getPopoverStats: () => ipcRenderer.invoke('pxpipe:getPopoverStats'),
  showMainWindow: () => ipcRenderer.invoke('pxpipe:showMainWindow'),
  quitApp: () => ipcRenderer.invoke('pxpipe:quitApp'),
  onPopoverShow: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('pxpipe:popoverShow', listener)
    return () => {
      ipcRenderer.removeListener('pxpipe:popoverShow', listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('pxpipe', pxpipe)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore defined in d.ts
  window.electron = electronAPI
  // @ts-ignore defined in d.ts
  window.pxpipe = pxpipe
}
