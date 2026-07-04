import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { AppDatabase } from './database'
import { ProxyService } from './proxy-service'
import { launchClient } from './launcher'
import type { AppSettings, PersistedEvent, ProxyStatus } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let db: AppDatabase
let proxy: ProxyService
let databaseClosed = false
let quitAfterProxyStop = false

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

function closeDatabase(): void {
  if (databaseClosed || !db) return
  databaseClosed = true
  db.close()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'pxpipe desktop',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('pxpipe:getSettings', () => db.getSettings())

  ipcMain.handle('pxpipe:updateSettings', (_event, patch: Partial<AppSettings>) => {
    return db.updateSettings(patch)
  })

  ipcMain.handle('pxpipe:startProxy', async (_event, patch?: Partial<AppSettings>) => {
    const settings = patch ? db.updateSettings(patch) : db.getSettings()
    try {
      return await proxy.start(settings)
    } catch (error) {
      const status: ProxyStatus = {
        ...proxy.getStatus(),
        running: false,
        error: error instanceof Error ? error.message : String(error)
      }
      broadcast('pxpipe:status', status)
      return status
    }
  })

  ipcMain.handle('pxpipe:stopProxy', () => proxy.stop())
  ipcMain.handle('pxpipe:getProxyStatus', () => proxy.getStatus())
  ipcMain.handle('pxpipe:listEvents', (_event, limit?: number) => db.listEvents(limit))
  ipcMain.handle('pxpipe:getStats', () => db.getStats())
  ipcMain.handle('pxpipe:listSessions', (_event, limit?: number) => db.listSessions(limit))
  ipcMain.handle('pxpipe:getProxyVerification', () => {
    const status = proxy.getStatus()
    return db.getProxyVerification(status.running, status.url)
  })
  ipcMain.handle('pxpipe:getDashboardRecent', () => proxy.getDashboardRecent())
  ipcMain.handle('pxpipe:getProxyStats', () => proxy.getProxyStats())
  ipcMain.handle('pxpipe:getCurrentSession', () => proxy.getCurrentSession())
  ipcMain.handle('pxpipe:setCompressionEnabled', (_event, enabled: boolean) =>
    proxy.setCompressionEnabled(enabled)
  )
  ipcMain.handle('pxpipe:getImageVsTextBreakdown', (_event, id?: number) =>
    proxy.getImageVsTextBreakdown(id)
  )
  ipcMain.handle('pxpipe:getTokenImage', (_event, id?: number) => proxy.getTokenImage(id))
  ipcMain.handle('pxpipe:getImageSource', (_event, id?: number) => proxy.getImageSource(id))
  ipcMain.handle('pxpipe:launchClaude', (_event, cwd?: string) => {
    return launchClient('claude', db.getSettings(), cwd)
  })
  ipcMain.handle('pxpipe:launchCodex', (_event, cwd?: string) => {
    return launchClient('codex', db.getSettings(), cwd)
  })

  ipcMain.handle('pxpipe:importJsonl', (_event, path: string) => {
    const result = db.importJsonl(path)
    broadcast('pxpipe:status', proxy.getStatus())
    return result
  })
}

async function bootstrap(): Promise<void> {
  electronApp.setAppUserModelId('com.pxpipe.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  db = new AppDatabase()
  proxy = new ProxyService(
    db,
    (event: PersistedEvent) => broadcast('pxpipe:event', event),
    (status: ProxyStatus) => broadcast('pxpipe:status', status)
  )
  registerIpc()
  createWindow()

  const settings = db.getSettings()
  if (settings.autoStart) {
    try {
      await proxy.start(settings)
    } catch (error) {
      broadcast('pxpipe:status', {
        ...proxy.getStatus(),
        running: false,
        error: error instanceof Error ? error.message : String(error)
      } satisfies ProxyStatus)
    }
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

void app
  .whenReady()
  .then(bootstrap)
  .catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    dialog.showErrorBox('pxpipe desktop failed to start', message)
    app.quit()
  })

app.on('before-quit', (event) => {
  if (proxy?.getStatus().running && !quitAfterProxyStop) {
    event.preventDefault()
    quitAfterProxyStop = true
    proxy
      .stop()
      .catch(() => undefined)
      .finally(() => {
        closeDatabase()
        app.quit()
      })
    return
  }
  closeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
