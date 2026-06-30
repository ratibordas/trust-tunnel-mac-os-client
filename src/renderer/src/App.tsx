import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConfigSummary,
  ConnectionState,
  LogLine,
  NetStats,
  BinaryInfo
} from '@shared/types'
import Sidebar from './components/Sidebar'
import ConnectionView from './components/ConnectionView'
import EditorView from './components/EditorView'
import TitleBar from './components/TitleBar'

const DISCONNECTED: ConnectionState = {
  phase: 'disconnected',
  configId: null,
  configName: null,
  hostname: null,
  connectedAt: null,
  serverAddress: null,
  latencyMs: null,
  lastError: null
}

const MAX_LOG_LINES = 1000

export default function App(): JSX.Element {
  const [configs, setConfigs] = useState<ConfigSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)
  const [state, setState] = useState<ConnectionState>(DISCONNECTED)
  const [stats, setStats] = useState<NetStats | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [binary, setBinary] = useState<BinaryInfo | null>(null)
  const logBuf = useRef<LogLine[]>([])

  const refreshConfigs = useCallback(async () => {
    const list = await window.api.config.list()
    setConfigs(list)
    setSelectedId((cur) => cur ?? list[0]?.id ?? null)
  }, [])

  const refreshBinary = useCallback(async () => {
    setBinary(await window.api.binary.info())
  }, [])

  useEffect(() => {
    void refreshConfigs()
    void refreshBinary()
    void window.api.vpn.state().then(setState)

    const offState = window.api.events.onState(setState)
    const offStats = window.api.events.onStats(setStats)
    const offLog = window.api.events.onLog((l) => {
      logBuf.current = [...logBuf.current, l].slice(-MAX_LOG_LINES)
      setLogs(logBuf.current)
    })
    return () => {
      offState()
      offStats()
      offLog()
    }
  }, [refreshConfigs, refreshBinary])

  // Reset stats once fully disconnected.
  useEffect(() => {
    if (state.phase === 'disconnected') setStats(null)
  }, [state.phase])

  const busy =
    state.phase === 'connecting' ||
    state.phase === 'connected' ||
    state.phase === 'reconnecting' ||
    state.phase === 'disconnecting'

  const handleConnect = useCallback(async (id: string) => {
    logBuf.current = []
    setLogs([])
    try {
      await window.api.vpn.connect(id)
    } catch (err) {
      setState({ ...DISCONNECTED, phase: 'error', lastError: (err as Error).message })
    }
  }, [])

  const handleDisconnect = useCallback(async () => {
    await window.api.vpn.disconnect()
  }, [])

  const selected = configs.find((c) => c.id === selectedId) ?? null

  return (
    <div className="app">
      <TitleBar binary={binary} onBinaryChange={refreshBinary} />
      <div className="body">
        <Sidebar
          configs={configs}
          selectedId={selectedId}
          activeConfigId={state.configId}
          phase={state.phase}
          disabled={busy}
          onSelect={(id) => {
            setEditing(null)
            setSelectedId(id)
          }}
          onNew={() => setEditing({ id: null })}
        />
        <main className="content">
          {editing ? (
            <EditorView
              configId={editing.id}
              onClose={() => setEditing(null)}
              onSaved={async (id) => {
                setEditing(null)
                await refreshConfigs()
                setSelectedId(id)
              }}
            />
          ) : selected ? (
            <ConnectionView
              summary={selected}
              state={state}
              stats={stats}
              logs={logs}
              binaryReady={!!binary?.installed}
              onConnect={() => handleConnect(selected.id)}
              onDisconnect={handleDisconnect}
              onEdit={() => setEditing({ id: selected.id })}
              onDelete={async () => {
                await window.api.config.delete(selected.id)
                setSelectedId(null)
                await refreshConfigs()
              }}
            />
          ) : (
            <EmptyState onNew={() => setEditing({ id: null })} hasBinary={!!binary?.installed} />
          )}
        </main>
      </div>
    </div>
  )
}

function EmptyState({ onNew, hasBinary }: { onNew: () => void; hasBinary: boolean }): JSX.Element {
  return (
    <div className="empty">
      <h2>No configurations yet</h2>
      <p>Import an existing trusttunnel_client.toml or create one manually.</p>
      <button className="btn primary" onClick={onNew}>
        + New configuration
      </button>
      {!hasBinary && (
        <p className="warn">
          The trusttunnel_client binary is not installed yet — open the menu in the title bar to
          download it before connecting.
        </p>
      )}
    </div>
  )
}
