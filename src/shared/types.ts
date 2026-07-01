import type { ClientConfig, ValidationResult } from './schema'

export type { ClientConfig, ClientConfigInput, ValidationResult, ValidationIssue } from './schema'

/** Lightweight metadata for the config list (no secrets in the summary). */
export interface ConfigSummary {
  id: string
  name: string
  hostname: string
  vpnMode: 'general' | 'selective'
  listener: 'tun' | 'socks'
  updatedAt: number
}

export type ConnectionPhase =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnecting'
  | 'error'

export interface ConnectionState {
  phase: ConnectionPhase
  configId: string | null
  configName: string | null
  hostname: string | null
  /** epoch ms when the tunnel reached "connected", else null. */
  connectedAt: number | null
  /** Resolved endpoint address (ip:port) reported by the client, if seen. */
  serverAddress: string | null
  /** Endpoint round-trip ping in ms reported by the client, if seen. */
  latencyMs: number | null
  lastError: string | null
}

export interface NetStats {
  /** Bytes/sec, smoothed. */
  downloadBps: number
  uploadBps: number
  /** Cumulative bytes since connect (per-interface counters). */
  downloadTotal: number
  uploadTotal: number
  /** The utun interface we are reading, if detected. */
  iface: string | null
}

export interface LogLine {
  ts: number
  level: 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'raw'
  text: string
}

export type BinarySource = 'custom' | 'downloaded' | 'system' | null

export interface BinaryInfo {
  installed: boolean
  installedVersion: string | null
  path: string | null
  /** Where the active binary comes from. */
  source: BinarySource
}

export interface UpdateInfo {
  latestVersion: string | null
  installedVersion: string | null
  updateAvailable: boolean
  downloadUrl: string | null
  publishedAt: string | null
}

export interface DownloadProgress {
  phase: 'downloading' | 'extracting' | 'installing' | 'done' | 'error'
  receivedBytes: number
  totalBytes: number | null
  message?: string
}

// ---- IPC channel names (single source of truth) ----
export const IPC = {
  // configs
  configList: 'config:list',
  configGet: 'config:get',
  configSave: 'config:save',
  configImportToml: 'config:importToml',
  configExportToml: 'config:exportToml',
  configDelete: 'config:delete',
  configValidate: 'config:validate',
  // vpn
  vpnConnect: 'vpn:connect',
  vpnDisconnect: 'vpn:disconnect',
  vpnState: 'vpn:state',
  // events (main -> renderer)
  evtState: 'evt:state',
  evtStats: 'evt:stats',
  evtLog: 'evt:log',
  evtDownloadProgress: 'evt:downloadProgress',
  // binary
  binaryInfo: 'binary:info',
  binaryCheckUpdate: 'binary:checkUpdate',
  binaryInstall: 'binary:install',
  binaryBrowse: 'binary:browse',
  binaryClearPath: 'binary:clearPath'
} as const

export interface SaveConfigArgs {
  id?: string
  name: string
  config: ClientConfig
}

export interface SaveConfigResult {
  ok: boolean
  id?: string
  validation: ValidationResult
}
