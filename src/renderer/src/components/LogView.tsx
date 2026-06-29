import { useEffect, useRef, useState } from 'react'
import type { LogLine } from '@shared/types'

export default function LogView({ logs }: { logs: LogLine[] }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [logs, follow])

  return (
    <div className="logs">
      <div className="logs-head">
        <span>Client log</span>
        <label className="follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Auto-scroll
        </label>
      </div>
      <div
        className="logs-body"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          setFollow(atBottom)
        }}
      >
        {logs.length === 0 && <div className="muted pad">No output yet.</div>}
        {logs.map((l, i) => (
          <div key={i} className={`log-line ${l.level}`}>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  )
}
