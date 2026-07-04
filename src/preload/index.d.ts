import { ElectronAPI } from '@electron-toolkit/preload'
import type { PxpipeDesktopApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    pxpipe: PxpipeDesktopApi
  }
}
