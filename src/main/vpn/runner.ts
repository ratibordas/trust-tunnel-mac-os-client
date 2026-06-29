import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import sudo from '@vscode/sudo-prompt'
import type { ClientConfig } from '@shared/schema'
import type { ConnectionState, LogLine, NetStats } from '@shared/types'
import {
  activeConfigPath,
  binaryPath,
  fifoPath,
  logFilePath,
  managerScriptPath,
  pidFilePath,
  runtimeDir
} from '../paths'
import { serializeToml } from '../config/toml'
import { MANAGER_SCRIPT } from './manager.sh'
import { FileTailer } from './tailer'
import { NetStatsPoller } from '../stats/netstats'

const exec = promisify(execFile)

// Heuristics for deriving connection state from log text. The CLI's exact
// output is not documented, so these are best-effort and easy to tune.
const RE_CONNECTED = /\b(connected|tunnel (is )?up|established|listening on|ready|started)\b/i
const RE_ERROR = /\b(error|failed|fatal|panic|refused|unauthor|denied|invalid)\b/i

function sh(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

function parseLogLine(text: string): LogLine {
  const lower = text.toLowerCase()
  let level: LogLine['level'] = 'raw'
  if (/\berror\b|\bfatal\b|\bpanic\b/.test(lower)) level = 'error'
  else if (/\bwarn\b/.test(lower)) level = 'warn'
  else if (/\bdebug\b/.test(lower)) level = 'debug'
  else if (/\btrace\b/.test(lower)) level = 'trace'
  else if (/\binfo\b/.test(lower)) level = 'info'
  return { ts: Date.now(), level, text }
}

export interface VpnRunnerEvents {
  state: (s: ConnectionState) => void
  stats: (s: NetStats) => void
  log: (l: LogLine) => void
}

export class VpnRunner extends EventEmitter {
  private state: ConnectionState = {
    phase: 'disconnected',
    configId: null,
    configName: null,
    hostname: null,
    connectedAt: null,
    lastError: null
  }
  private tailer: FileTailer | null = null
  private netstats: NetStatsPoller | null = null
  private connectGraceTimer: NodeJS.Timeout | null = null
  private sawError = false

  getState(): ConnectionState {
    return this.state
  }

  private setState(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  private markConnected(): void {
    if (this.state.phase === 'connecting') {
      this.setState({ phase: 'connected', connectedAt: Date.now() })
    }
  }

  private handleLogChunk(chunk: string): void {
    for (const raw of chunk.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (!line.trim()) continue
      const parsed = parseLogLine(line)
      this.emit('log', parsed)
      if (RE_ERROR.test(line)) {
        this.sawError = true
        if (this.state.phase === 'connecting') {
          this.setState({ lastError: line.slice(0, 300) })
        }
      }
      if (RE_CONNECTED.test(line)) this.markConnected()
    }
  }

  async connect(opts: {
    configId: string
    configName: string
    config: ClientConfig
  }): Promise<void> {
    if (this.state.phase !== 'disconnected' && this.state.phase !== 'error') {
      throw new Error('A connection is already active')
    }
    const bin = binaryPath()
    if (!existsSync(bin)) {
      throw new Error('trusttunnel_client binary is not installed. Download it in Settings.')
    }

    // Fresh runtime dir + FIFO + rendered config.
    await mkdir(runtimeDir(), { recursive: true })
    await rm(fifoPath(), { force: true })
    await rm(pidFilePath(), { force: true })
    await writeFile(logFilePath(), '', 'utf8')
    await writeFile(activeConfigPath(), serializeToml(opts.config), 'utf8')
    await writeFile(managerScriptPath(), MANAGER_SCRIPT, { mode: 0o755 })
    await exec('mkfifo', [fifoPath()])

    this.sawError = false
    this.setState({
      phase: 'connecting',
      configId: opts.configId,
      configName: opts.configName,
      hostname: opts.config.endpoint.hostname,
      connectedAt: null,
      lastError: null
    })

    // Start tailing logs and polling stats immediately.
    this.tailer = new FileTailer(logFilePath(), (c) => this.handleLogChunk(c))
    this.tailer.start()
    this.netstats = new NetStatsPoller((s) => this.emit('stats', s))
    void this.netstats.start(opts.config.listener.tun?.device_name)

    // Grace fallback: if the binary stays alive a few seconds with no error and
    // no explicit "connected" log marker, assume the tunnel is up.
    this.connectGraceTimer = setTimeout(() => {
      if (this.state.phase === 'connecting' && !this.sawError) this.markConnected()
    }, 6000)

    const command = `/bin/sh ${sh(managerScriptPath())} ${sh(bin)} ${sh(activeConfigPath())} ${sh(
      logFilePath()
    )} ${sh(fifoPath())} ${sh(pidFilePath())}`

    // sudo-prompt resolves only when the manager script EXITS (i.e. on
    // disconnect or client death). One password prompt for the whole session.
    sudo.exec(command, { name: 'TrustTunnel Desktop' }, (error, _stdout, stderr) => {
      this.cleanupMonitors()
      if (error && this.state.phase === 'connecting') {
        // Almost always: user cancelled the password dialog, or sudo failed.
        const msg = /cancel|denied|User did not/i.test(error.message)
          ? 'Authorization cancelled.'
          : `Failed to start: ${error.message}`
        this.setState({ phase: 'error', lastError: msg, connectedAt: null })
        return
      }
      if (error && stderr) this.emit('log', parseLogLine(`[manager] ${stderr}`))
      // Normal completion or client exit.
      const phase = this.state.phase
      this.setState({
        phase: phase === 'error' ? 'error' : 'disconnected',
        connectedAt: null,
        configId: null,
        configName: null,
        hostname: null
      })
    })
  }

  /** Signals the privileged manager to stop via the control FIFO. */
  async disconnect(): Promise<void> {
    if (this.state.phase === 'disconnected') return
    this.setState({ phase: 'disconnecting' })
    const fifo = fifoPath()
    if (!existsSync(fifo)) {
      // Manager already gone; just reset.
      this.cleanupMonitors()
      this.setState({ phase: 'disconnected', connectedAt: null })
      return
    }
    try {
      // Write through a short-lived shell so a missing reader can't hang us.
      await Promise.race([
        exec('/bin/sh', ['-c', `echo stop > ${sh(fifo)}`]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
      ])
    } catch {
      // The sudo-prompt callback will still finalize state when the manager exits.
    }
  }

  private cleanupMonitors(): void {
    if (this.connectGraceTimer) clearTimeout(this.connectGraceTimer)
    this.connectGraceTimer = null
    this.tailer?.stop()
    this.tailer = null
    this.netstats?.stop()
    this.netstats = null
  }
}

export const vpnRunner = new VpnRunner()
