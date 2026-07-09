import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeTheme,
  Tray,
  Menu,
  nativeImage,
  type NativeImage
} from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { menubar, type Menubar } from 'menubar'
import icon from '../../resources/icon.png?asset'
import ringIcon from '../../resources/tray/ringTemplate.png?asset'
import ringIcon2x from '../../resources/tray/ringTemplate@2x.png?asset'
import ringDotIcon from '../../resources/tray/ringDotTemplate.png?asset'
import ringDotIcon2x from '../../resources/tray/ringDotTemplate@2x.png?asset'
import { AppDatabase } from './database'
import { ProxyService } from './proxy-service'
import { launchClient } from './launcher'
import { UpdateService } from './update-service'
import type { AppSettings, PersistedEvent, ProxyStatus } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let mb: Menubar | null = null
let trayMenu: Menu | null = null
let trayIconRunning: NativeImage | null = null
let trayIconStopped: NativeImage | null = null
let db: AppDatabase
let proxy: ProxyService
let updater: UpdateService
let databaseClosed = false
let quitAfterProxyStop = false
let isQuitting = false

function trayImage(basePath: string, retinaPath: string): NativeImage {
  const img = nativeImage.createFromPath(basePath)
  img.addRepresentation({
    scaleFactor: 2,
    dataURL: nativeImage.createFromPath(retinaPath).toDataURL()
  })
  img.setTemplateImage(true)
  return img
}

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

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  createWindow()
}

function updateTray(): void {
  if (!tray) return
  const status = proxy.getStatus()
  tray.setImage(status.running ? trayIconRunning! : trayIconStopped!)
  tray.setToolTip(status.running ? `pxpipe — ${status.url}` : 'pxpipe — stopped')
  trayMenu = Menu.buildFromTemplate([
    {
      label: status.running ? `Running on ${status.url}` : 'Proxy stopped',
      enabled: false
    },
    { type: 'separator' },
    status.running
      ? {
          label: 'Stop proxy',
          click: (): void => {
            void proxy.stop().catch(() => undefined)
          }
        }
      : {
          label: 'Start proxy',
          click: (): void => {
            void proxy.start(db.getSettings()).catch((error: unknown) => {
              broadcast('pxpipe:status', {
                ...proxy.getStatus(),
                running: false,
                error: error instanceof Error ? error.message : String(error)
              } satisfies ProxyStatus)
            })
          }
        },
    { type: 'separator' },
    { label: 'Show pxpipe', click: showMainWindow },
    { label: 'Quit pxpipe', role: 'quit' }
  ])
}

function createTray(): void {
  if (process.platform !== 'darwin' || tray) return
  trayIconRunning = trayImage(ringDotIcon, ringDotIcon2x)
  trayIconStopped = trayImage(ringIcon, ringIcon2x)
  tray = new Tray(trayIconStopped)
  tray.on('right-click', () => {
    if (trayMenu) tray?.popUpContextMenu(trayMenu)
  })
  updateTray()

  const popoverIndex =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? `${process.env['ELECTRON_RENDERER_URL']}#/popover`
      : `file://${join(__dirname, '../renderer/index.html')}#/popover`

  mb = menubar({
    tray,
    index: popoverIndex,
    showDockIcon: true,
    showOnRightClick: false,
    preloadWindow: true,
    browserWindow: {
      width: 360,
      height: 440,
      resizable: false,
      movable: false,
      fullscreenable: false,
      backgroundColor: '#171717',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    }
  })
  mb.on('show', () => {
    mb?.window?.webContents.send('pxpipe:popoverShow')
  })
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
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 12 }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // macOS: hide to tray instead of destroying the window, so the renderer
  // keeps its state and reopening does not trigger a full reload (issue 6).
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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
    const next = db.updateSettings(patch)
    nativeTheme.themeSource = next.theme
    return next
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

  ipcMain.handle('pxpipe:getUpdateStatus', () => updater.getStatus())
  ipcMain.handle('pxpipe:checkForUpdates', () => updater.checkForUpdates())
  ipcMain.handle('pxpipe:installUpdate', () => updater.installUpdate())

  ipcMain.handle('pxpipe:getPopoverStats', () => db.getPopoverStats())
  ipcMain.handle('pxpipe:showMainWindow', () => {
    mb?.hideWindow()
    showMainWindow()
  })
  ipcMain.handle('pxpipe:quitApp', () => {
    app.quit()
  })
}

async function bootstrap(): Promise<void> {
  electronApp.setAppUserModelId('com.pxpipe.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  db = new AppDatabase()
  nativeTheme.themeSource = db.getSettings().theme
  proxy = new ProxyService(
    db,
    (event: PersistedEvent) => broadcast('pxpipe:event', event),
    (status: ProxyStatus) => {
      broadcast('pxpipe:status', status)
      updateTray()
    }
  )
  updater = new UpdateService({
    broadcast,
    getLanguage: () => db.getSettings().language,
    beforeInstall: async () => {
      isQuitting = true
      if (proxy.getStatus().running) {
        await proxy.stop().catch(() => undefined)
      }
      closeDatabase()
    }
  })
  registerIpc()
  createWindow()
  createTray()
  updater.init()

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
    showMainWindow()
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
  isQuitting = true
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
