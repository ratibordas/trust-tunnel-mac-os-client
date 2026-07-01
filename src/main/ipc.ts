import { BrowserWindow, dialog, ipcMain } from 'electron'
import { validateConfig } from '@shared/schema'
import { IPC, type SaveConfigArgs } from '@shared/types'
import {
  deleteConfig,
  exportToml,
  getConfig,
  importToml,
  listConfigs,
  saveConfig
} from './config/store'
import { vpnRunner } from './vpn/runner'
import { connectById } from './vpn/service'
import {
  checkUpdate,
  clearBinaryPath,
  getBinaryInfo,
  installLatest,
  setBinaryPath
} from './updater/binary'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerIpc(): void {
  // Forward runner events to every renderer window.
  vpnRunner.on('state', (s) => broadcast(IPC.evtState, s))
  vpnRunner.on('stats', (s) => broadcast(IPC.evtStats, s))
  vpnRunner.on('log', (l) => broadcast(IPC.evtLog, l))

  // ---- configs ----
  ipcMain.handle(IPC.configList, () => listConfigs())
  ipcMain.handle(IPC.configGet, (_e, id: string) => getConfig(id))
  ipcMain.handle(IPC.configSave, (_e, args: SaveConfigArgs) => saveConfig(args))
  ipcMain.handle(IPC.configImportToml, (_e, name: string, text: string) => importToml(name, text))
  ipcMain.handle(IPC.configExportToml, (_e, id: string) => exportToml(id))
  ipcMain.handle(IPC.configDelete, (_e, id: string) => deleteConfig(id))
  ipcMain.handle(IPC.configValidate, (_e, raw: unknown) => validateConfig(raw))

  // ---- vpn ----
  ipcMain.handle(IPC.vpnConnect, (_e, configId: string) => connectById(configId))
  ipcMain.handle(IPC.vpnDisconnect, async () => {
    await vpnRunner.disconnect()
    return vpnRunner.getState()
  })
  ipcMain.handle(IPC.vpnState, () => vpnRunner.getState())

  // ---- binary ----
  ipcMain.handle(IPC.binaryInfo, () => getBinaryInfo())
  ipcMain.handle(IPC.binaryCheckUpdate, () => checkUpdate())
  ipcMain.handle(IPC.binaryInstall, () =>
    installLatest((p) => broadcast(IPC.evtDownloadProgress, p))
  )
  ipcMain.handle(IPC.binaryBrowse, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      title: 'Select the trusttunnel_client executable',
      message: 'Choose an existing trusttunnel_client binary',
      properties: ['openFile', 'treatPackageAsDirectory', 'showHiddenFiles'],
      defaultPath: '/usr/local/bin'
    })
    if (res.canceled || !res.filePaths[0]) {
      return { ok: false, info: await getBinaryInfo() }
    }
    return setBinaryPath(res.filePaths[0])
  })
  ipcMain.handle(IPC.binaryClearPath, () => clearBinaryPath())
}
