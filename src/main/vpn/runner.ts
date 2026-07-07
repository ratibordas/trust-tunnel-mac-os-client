import { EventEmitter } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import type { ClientConfig } from '@shared/schema'
import type { ConnectionState, LogLine, NetStats } from '@shared/types'
import { activeConfigPath, logFilePath, runtimeDir } from '../paths'
import { serializeToml } from '../config/toml'
import { resolveBinaryPath } from '../updater/binary'
import { FileTailer } from './tailer'
import { createStatsPoller, type StatsPoller } from '../stats/poller'
import { createController, type TunnelController } from './controller'

// The client exposes an explicit state machine in its logs, e.g.
//   VPNCORE raise_state: [0] VPN_SS_CONNECTED
// which is far more reliable than keyword guessing. We key state transitions
// off VPN_SS_* and only fall back to heuristics if those never appear.
const RE_STATE = /raise_state:\s*\[\d+\]\s*VPN_SS_([A-Z_]+)/
// "Using endpoint: name=host, address=1.2.3.4:8443, relay=none, ping=65ms"
const RE_ENDPOINT = /Using endpoint:.*?address=([^\s,]+).*?ping=(\d+)\s*ms/i
// "Waiting recovery: to next=1000ms error=1 <reason>"
const RE_RECOVERY = /Waiting recovery:.*?error=\d+\s*(.*)$/i
// Hard errors that should fail the connecting phase. NOTE: this client prefixes
// every line (even soft errors) with "INFO", so we only match explicit failures.
const RE_HARD_ERROR =
  /\b(fatal|panic|unauthor\w*|authentication failed|permission denied|invalid config\w*)\b/i

function parseLogLine(text: string): LogLine {
  let level: LogLine['level'] = 'raw'
  // Soft errors here are still tagged INFO by the client, so colour by content.
  if (RE_HARD_ERROR.test(text) || /\berror\b|timed out/i.test(text)) level = 'error'
  else if (/waiting recovery|\bwarn\b/i.test(text)) level = 'warn'
  else if (/\bDEBUG\b/.test(text)) level = 'debug'
  else if (/\bTRACE\b/.test(text)) level = 'trace'
  else if (/\bINFO\b/.test(text)) level = 'info'
  return { ts: Date.now(), level, text }
}

export interface VpnRunnerEvents {
  state: (s: ConnectionState) => void
  stats: (s: NetStats) => void
  log: (l: LogLine) => void
}

const DISCONNECTED: Omit<ConnectionState, 'phase'> = {
  configId: null,
  configName: null,
  hostname: null,
  connectedAt: null,
  serverAddress: null,
  latencyMs: null,
  lastError: null
}

export class VpnRunner extends EventEmitter {
  private state: ConnectionState = { phase: 'disconnected', ...DISCONNECTED }
  private tailer: FileTailer | null = null
  private stats: StatsPoller | null = null
  private controller: TunnelController | null = null
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
    if (this.state.phase === 'connecting' || this.state.phase === 'reconnecting') {
      this.setState({
        phase: 'connected',
        connectedAt: this.state.connectedAt ?? Date.now(),
        lastError: null
      })
    }
  }

  private handleLogChunk(chunk: string): void {
    for (const raw of chunk.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (!line.trim()) continue
      this.emit('log', parseLogLine(line))

      const ep = RE_ENDPOINT.exec(line)
      if (ep) this.setState({ serverAddress: ep[1], latencyMs: Number(ep[2]) })

      const sm = RE_STATE.exec(line)
      if (sm) {
        const s = sm[1]
        if (s === 'CONNECTED') this.markConnected()
        else if (s === 'WAITING_RECOVERY') {
          if (this.state.phase === 'connected' || this.state.phase === 'connecting') {
            this.setState({ phase: 'reconnecting' })
          }
        }
        continue
      }

      if (RE_RECOVERY.test(line)) {
        const m = RE_RECOVERY.exec(line)
        this.setState({ lastError: (m?.[1] || 'Connection lost, recovering…').slice(0, 300) })
      }

      if (RE_HARD_ERROR.test(line)) {
        this.sawError = true
        if (this.state.phase === 'connecting') this.setState({ lastError: line.slice(0, 300) })
      }
    }
  }

  private onSessionExit(result: { error?: string; cancelled?: boolean }): void {
    this.cleanupMonitors()
    if (this.state.phase === 'connecting' && (result.cancelled || result.error)) {
      // Keep configId so the error is shown against the selected config.
      this.setState({
        phase: 'error',
        connectedAt: null,
        lastError: result.cancelled ? 'Authorization cancelled.' : `Failed to start: ${result.error}`
      })
      return
    }
    // Clean stop or client death.
    const wasError = this.state.phase === 'error'
    this.setState({ phase: wasError ? 'error' : 'disconnected', ...DISCONNECTED })
  }

  async connect(opts: {
    configId: string
    configName: string
    config: ClientConfig
  }): Promise<void> {
    if (this.state.phase !== 'disconnected' && this.state.phase !== 'error') {
      throw new Error('A connection is already active')
    }
    const resolved = await resolveBinaryPath()
    if (!resolved.path) {
      throw new Error(
        'trusttunnel_client binary not found. Download it, or point to an existing one in the title-bar menu.'
      )
    }

    await mkdir(runtimeDir(), { recursive: true })
    await writeFile(logFilePath(), '', 'utf8')
    await writeFile(activeConfigPath(), serializeToml(opts.config), 'utf8')

    this.sawError = false
    this.setState({
      phase: 'connecting',
      configId: opts.configId,
      configName: opts.configName,
      hostname: opts.config.endpoint.hostname,
      connectedAt: null,
      serverAddress: null,
      latencyMs: null,
      lastError: null
    })

    // Tail logs + poll stats immediately (platform-specific poller).
    this.tailer = new FileTailer(logFilePath(), (c) => this.handleLogChunk(c))
    this.tailer.start()
    this.stats = createStatsPoller((s) => this.emit('stats', s))
    void this.stats.start(opts.config.listener.tun?.device_name)

    // Grace fallback: alive a few seconds with no error and no explicit
    // "connected" marker => assume the tunnel is up.
    this.connectGraceTimer = setTimeout(() => {
      if (this.state.phase === 'connecting' && !this.sawError) this.markConnected()
    }, 6000)

    // One elevation prompt for the whole session; onExit fires when it ends.
    this.controller = createController()
    await this.controller.start({
      binPath: resolved.path,
      configPath: activeConfigPath(),
      logPath: logFilePath(),
      onExit: (r) => this.onSessionExit(r)
    })
  }

  /** Signals the privileged manager to stop over its control channel. */
  async disconnect(): Promise<void> {
    if (this.state.phase === 'disconnected') return
    this.setState({ phase: 'disconnecting' })
    // If the manager already exited, onSessionExit has (or will) reset us.
    await this.controller?.stop().catch(() => {})
  }

  private cleanupMonitors(): void {
    if (this.connectGraceTimer) clearTimeout(this.connectGraceTimer)
    this.connectGraceTimer = null
    this.tailer?.stop()
    this.tailer = null
    this.stats?.stop()
    this.stats = null
    this.controller = null
  }
}

export const vpnRunner = new VpnRunner()
