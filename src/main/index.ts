import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { vpnRunner } from './vpn/runner'
import { initTray } from './tray'
import { bundledResource } from './paths'
import type { ConnectionPhase } from '@shared/types'

let mainWindow: BrowserWindow | null = null

// Swap the Dock icon to reflect connection state: green=connected,
// amber=(re)connecting, purple=idle. (The bundled .icns / Finder icon stays
// the static idle artwork — only the live Dock icon changes.)
function dockIconFor(phase: ConnectionPhase): string {
  if (phase === 'connected') return 'dock-connected.png'
  if (phase === 'connecting' || phase === 'reconnecting') return 'dock-connecting.png'
  return 'dock-idle.png'
}

let currentDockIcon = ''
function updateDockIcon(phase: ConnectionPhase): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const file = dockIconFor(phase)
  if (file === currentDockIcon) return
  const img = nativeImage.createFromPath(bundledResource(file))
  if (!img.isEmpty()) {
    app.dock.setIcon(img)
    currentDockIcon = file
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite injects ELECTRON_RENDERER_URL in dev.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow) createWindow()
  else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  initTray(showWindow)

  // Reflect connection state in the Dock icon.
  updateDockIcon(vpnRunner.getState().phase)
  vpnRunner.on('state', (s) => updateDockIcon(s.phase))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
})

// Keep running in the menu bar on macOS when the window is closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Best-effort: tear down the tunnel when the app quits so we don't leave a
// root process running. (If the manager is mid-session this signals it to stop.)
app.on('before-quit', () => {
  void vpnRunner.disconnect().catch(() => {})
})
