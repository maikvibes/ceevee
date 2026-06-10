import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'

export class UpdateService {
  private mainWindow: BrowserWindow | null = null

  constructor() {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[UpdateService] Update downloaded:', info.version)
      this.notifyRenderer('update-downloaded', { version: info.version })
    })

    autoUpdater.on('error', (err) => {
      console.error('[UpdateService] Update error:', err.message)
    })

    // IPC: renderer requests install
    ipcMain.on('install-update', () => {
      autoUpdater.quitAndInstall(false, true)
    })
  }

  setWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  checkForUpdates() {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[UpdateService] Check for updates failed:', err.message)
    })
  }

  private notifyRenderer(channel: string, data: any) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }
}

export const updateService = new UpdateService()
