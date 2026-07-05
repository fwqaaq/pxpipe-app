import { app, BrowserWindow, dialog } from 'electron'
import { is } from '@electron-toolkit/utils'
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo
} from 'electron-updater'
import type { AppLanguage, AppUpdateStatus } from '../shared/types'

interface UpdateServiceOptions {
  broadcast: (channel: string, payload: unknown) => void
  getLanguage: () => AppLanguage
  beforeInstall: () => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function updateVersion(info: UpdateInfo | UpdateDownloadedEvent): string {
  return info.version || app.getVersion()
}

export class UpdateService {
  private status: AppUpdateStatus = {
    currentVersion: app.getVersion(),
    state: is.dev ? 'disabled' : 'idle',
    isSupported: !is.dev,
    autoCheck: !is.dev
  }

  private initialized = false
  private checking = false

  constructor(private readonly options: UpdateServiceOptions) {}

  init(): void {
    if (this.initialized) return
    this.initialized = true

    if (is.dev) {
      this.patchStatus({
        state: 'disabled',
        error: 'Update checks are available in packaged builds only.'
      })
      return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => {
      this.checking = true
      this.patchStatus({ state: 'checking', error: undefined })
    })

    autoUpdater.on('update-available', (info) => {
      this.patchStatus({
        state: 'available',
        availableVersion: updateVersion(info),
        releaseName: info.releaseName ?? undefined,
        releaseDate: info.releaseDate ?? undefined,
        error: undefined
      })
    })

    autoUpdater.on('update-not-available', (info) => {
      this.checking = false
      this.patchStatus({
        state: 'not-available',
        availableVersion: updateVersion(info),
        releaseName: info.releaseName ?? undefined,
        releaseDate: info.releaseDate ?? undefined,
        percent: undefined,
        error: undefined,
        lastCheckedAt: new Date().toISOString()
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      this.patchProgress(progress)
    })

    autoUpdater.on('update-downloaded', (event) => {
      this.checking = false
      this.patchStatus({
        state: 'downloaded',
        availableVersion: updateVersion(event),
        releaseName: event.releaseName ?? undefined,
        releaseDate: event.releaseDate ?? undefined,
        percent: 100,
        error: undefined,
        lastCheckedAt: new Date().toISOString()
      })
      void this.promptInstall()
    })

    autoUpdater.on('error', (error) => {
      this.checking = false
      this.patchStatus({
        state: 'error',
        error: errorMessage(error),
        lastCheckedAt: new Date().toISOString()
      })
    })

    setTimeout(() => {
      void this.checkForUpdates()
    }, 3000)
  }

  getStatus(): AppUpdateStatus {
    return this.status
  }

  async checkForUpdates(): Promise<AppUpdateStatus> {
    if (!this.status.isSupported) return this.status
    if (this.checking) return this.status

    try {
      this.checking = true
      this.patchStatus({ state: 'checking', error: undefined })
      const result = await autoUpdater.checkForUpdates()
      if (!result) {
        this.checking = false
        this.patchStatus({
          state: 'disabled',
          error: 'Updater is not active for this build.',
          lastCheckedAt: new Date().toISOString()
        })
      }
    } catch (error) {
      this.checking = false
      this.patchStatus({
        state: 'error',
        error: errorMessage(error),
        lastCheckedAt: new Date().toISOString()
      })
    }

    return this.status
  }

  async installUpdate(): Promise<AppUpdateStatus> {
    if (this.status.state !== 'downloaded') return this.status

    await this.options.beforeInstall()
    autoUpdater.quitAndInstall(false, true)
    return this.status
  }

  private patchProgress(progress: ProgressInfo): void {
    this.patchStatus({
      state: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
      error: undefined
    })
  }

  private patchStatus(patch: Partial<AppUpdateStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      currentVersion: app.getVersion(),
      isSupported: !is.dev,
      autoCheck: !is.dev
    }
    this.options.broadcast('pxpipe:updateStatus', this.status)
  }

  private async promptInstall(): Promise<void> {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    const zh = this.options.getLanguage() === 'zh'
    const options = {
      type: 'info',
      buttons: zh ? ['立即重启安装', '稍后'] : ['Restart to install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: zh ? 'pxpipe 有新版本' : 'pxpipe update ready',
      message: zh
        ? `版本 ${this.status.availableVersion ?? ''} 已下载完成。`
        : `Version ${this.status.availableVersion ?? ''} has been downloaded.`,
      detail: zh
        ? '重启后会安装更新并重新打开 pxpipe。'
        : 'Restart to install the update and reopen pxpipe.'
    } as const
    const response = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)

    if (response.response === 0) {
      await this.installUpdate()
    }
  }
}
