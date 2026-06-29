import type { ConfigSummary, ConnectionPhase } from '@shared/types'

interface Props {
  configs: ConfigSummary[]
  selectedId: string | null
  activeConfigId: string | null
  phase: ConnectionPhase
  disabled: boolean
  onSelect: (id: string) => void
  onNew: () => void
}

export default function Sidebar({
  configs,
  selectedId,
  activeConfigId,
  phase,
  onSelect,
  onNew
}: Props): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>Configurations</span>
        <button className="icon-btn" title="New configuration" onClick={onNew}>
          +
        </button>
      </div>
      <div className="config-list">
        {configs.length === 0 && <div className="muted pad">No configs</div>}
        {configs.map((c) => {
          const active = c.id === activeConfigId
          return (
            <button
              key={c.id}
              className={`config-item ${c.id === selectedId ? 'selected' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <span className={`dot ${active ? phase : 'idle'}`} />
              <span className="config-meta">
                <span className="config-name">{c.name}</span>
                <span className="config-host">{c.hostname}</span>
              </span>
              <span className="config-tag">{c.listener}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
