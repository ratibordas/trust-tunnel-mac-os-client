import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type {
  BinaryInfo,
  ClientConfig,
  ConfigSummary,
  ConnectionState,
  DownloadProgress,
  LogLine,
  NetStats,
  SaveConfigArgs,
  SaveConfigResult,
  UpdateInfo,
  ValidationResult
} from '../shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  config: {
    list: (): Promise<ConfigSummary[]> => ipcRenderer.invoke(IPC.configList),
    get: (id: string): Promise<{ id: string; name: string; config: ClientConfig } | null> =>
      ipcRenderer.invoke(IPC.configGet, id),
    save: (args: SaveConfigArgs): Promise<SaveConfigResult> =>
      ipcRenderer.invoke(IPC.configSave, args),
    importToml: (name: string, text: string): Promise<SaveConfigResult> =>
      ipcRenderer.invoke(IPC.configImportToml, name, text),
    exportToml: (id: string): Promise<string | null> => ipcRenderer.invoke(IPC.configExportToml, id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.configDelete, id),
    validate: (raw: unknown): Promise<ValidationResult> => ipcRenderer.invoke(IPC.configValidate, raw)
  },
  vpn: {
    connect: (configId: string): Promise<ConnectionState> =>
      ipcRenderer.invoke(IPC.vpnConnect, configId),
    disconnect: (): Promise<ConnectionState> => ipcRenderer.invoke(IPC.vpnDisconnect),
    state: (): Promise<ConnectionState> => ipcRenderer.invoke(IPC.vpnState)
  },
  binary: {
    info: (): Promise<BinaryInfo> => ipcRenderer.invoke(IPC.binaryInfo),
    checkUpdate: (): Promise<UpdateInfo> => ipcRenderer.invoke(IPC.binaryCheckUpdate),
    install: (): Promise<{ ok: boolean; version: string | null; error?: string }> =>
      ipcRenderer.invoke(IPC.binaryInstall)
  },
  events: {
    onState: (cb: (s: ConnectionState) => void) => on<ConnectionState>(IPC.evtState, cb),
    onStats: (cb: (s: NetStats) => void) => on<NetStats>(IPC.evtStats, cb),
    onLog: (cb: (l: LogLine) => void) => on<LogLine>(IPC.evtLog, cb),
    onDownloadProgress: (cb: (p: DownloadProgress) => void) =>
      on<DownloadProgress>(IPC.evtDownloadProgress, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
