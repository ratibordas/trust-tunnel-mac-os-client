import { useEffect, useState } from 'react'
import type { ConfigSummary, ConnectionState, LogLine, NetStats } from '@shared/types'
import { formatBytes, formatDuration, formatSpeed } from '../lib/format'
import LogView from './LogView'

interface Props {
  summary: ConfigSummary
  state: ConnectionState
  stats: NetStats | null
  logs: LogLine[]
  binaryReady: boolean
  onConnect: () => void
  onDisconnect: () => void
  onEdit: () => void
  onDelete: () => void
}

const PHASE_LABEL: Record<string, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnecting: 'Disconnecting…',
  error: 'Error'
}

export default function ConnectionView({
  summary,
  state,
  stats,
  logs,
  binaryReady,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete
}: Props): JSX.Element {
  const isActive = state.configId === summary.id
  const phase = isActive ? state.phase : 'disconnected'
  const [now, setNow] = useState(Date.now())

  const uptimeRunning = phase === 'connected' || phase === 'reconnecting'

  useEffect(() => {
    if (!uptimeRunning) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [uptimeRunning])

  const duration = uptimeRunning && state.connectedAt ? now - state.connectedAt : 0

  const canConnect = binaryReady && (phase === 'disconnected' || phase === 'error')
  const canDisconnect =
    phase === 'connecting' ||
    phase === 'connected' ||
    phase === 'reconnecting' ||
    phase === 'disconnecting'

  return (
    <div className="connview">
      <div className="connview-head">
        <div>
          <h2>{summary.name}</h2>
          <div className="muted">{summary.hostname}</div>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={onEdit} disabled={canDisconnect}>
            Edit
          </button>
          <button className="btn ghost danger" onClick={onDelete} disabled={canDisconnect}>
            Delete
          </button>
        </div>
      </div>

      <div className={`status-card ${phase}`}>
        <div className="status-main">
          <span className={`status-dot ${phase}`} />
          <div>
            <div className="status-label">{PHASE_LABEL[phase]}</div>
            {uptimeRunning && (
              <div className="muted small">Connected for {formatDuration(duration)}</div>
            )}
            {phase === 'reconnecting' && state.lastError && (
              <div className="warn small">{state.lastError}</div>
            )}
            {phase === 'error' && state.lastError && (
              <div className="err small">{state.lastError}</div>
            )}
          </div>
        </div>
        {canConnect && (
          <button className="btn primary big" onClick={onConnect}>
            Connect
          </button>
        )}
        {canDisconnect && (
          <button className="btn danger big" onClick={onDisconnect} disabled={phase === 'disconnecting'}>
            {phase === 'disconnecting' ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
        {!binaryReady && phase === 'disconnected' && (
          <span className="muted small">Install the client binary to connect</span>
        )}
      </div>

      <div className="grid">
        <Stat label="Download" value={formatSpeed(stats?.downloadBps ?? 0)} sub={formatBytes(stats?.downloadTotal ?? 0)} />
        <Stat label="Upload" value={formatSpeed(stats?.uploadBps ?? 0)} sub={formatBytes(stats?.uploadTotal ?? 0)} />
        <Stat
          label="Ping"
          value={isActive && state.latencyMs != null ? `${state.latencyMs} ms` : '—'}
          sub={`${summary.vpnMode} · ${summary.listener}`}
        />
        <Stat
          label="Server"
          value={stats?.iface ?? '—'}
          sub={(isActive && state.serverAddress) || summary.hostname}
        />
      </div>

      <LogView logs={logs} />
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub muted">{sub}</div> : null}
    </div>
  )
}
