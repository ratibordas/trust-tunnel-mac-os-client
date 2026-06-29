import { BrowserWindow, ipcMain } from 'electron'
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
import { checkUpdate, getBinaryInfo, installLatest } from './updater/binary'

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
  ipcMain.handle(IPC.vpnConnect, async (_e, configId: string) => {
    const found = await getConfig(configId)
    if (!found) throw new Error('Config not found')
    await vpnRunner.connect({ configId, configName: found.name, config: found.config })
    return vpnRunner.getState()
  })
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
}
