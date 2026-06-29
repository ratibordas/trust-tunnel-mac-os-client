import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ClientConfig, ValidationIssue } from '@shared/types'
import { arrayToLines, emptyConfig, linesToArray, portsToArray } from '../lib/defaults'

interface Props {
  configId: string | null
  onClose: () => void
  onSaved: (id: string) => void | Promise<void>
}

type Mode = 'form' | 'toml'

export default function EditorView({ configId, onClose, onSaved }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>('form')
  const [name, setName] = useState('')
  const [cfg, setCfg] = useState<ClientConfig>(() => emptyConfig())
  const [tomlText, setTomlText] = useState('')
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(configId !== null)

  useEffect(() => {
    if (!configId) return
    let alive = true
    void window.api.config.get(configId).then(async (res) => {
      if (!alive || !res) return
      setName(res.name)
      setCfg(res.config)
      const exported = await window.api.config.exportToml(configId)
      setTomlText(exported ?? '')
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [configId])

  const listenerKind: 'tun' | 'socks' = cfg.listener.socks && !cfg.listener.tun ? 'socks' : 'tun'

  const patch = (fn: (d: ClientConfig) => void): void =>
    setCfg((prev) => {
      const next = structuredClone(prev)
      fn(next)
      return next
    })

  const validate = async (candidate: ClientConfig): Promise<boolean> => {
    const res = await window.api.config.validate(candidate)
    setIssues(res.issues)
    return res.ok
  }

  const save = async (): Promise<void> => {
    setInfo(null)
    if (!name.trim()) {
      setIssues([{ path: 'name', message: 'A configuration name is required' }])
      return
    }
    if (mode === 'toml') {
      const res = await window.api.config.importToml(name.trim(), tomlText)
      setIssues(res.validation.issues)
      if (res.ok && res.id) await onSaved(res.id)
      return
    }
    if (!(await validate(cfg))) return
    const res = await window.api.config.save({ id: configId ?? undefined, name: name.trim(), config: cfg })
    setIssues(res.validation.issues)
    if (res.ok && res.id) await onSaved(res.id)
  }

  const onPickFile = (file: File): void => {
    const reader = new FileReader()
    reader.onload = () => {
      setTomlText(String(reader.result ?? ''))
      setMode('toml')
      if (!name.trim()) setName(file.name.replace(/\.toml$/i, ''))
    }
    reader.readAsText(file)
  }

  const grouped = useMemo(() => groupIssues(issues), [issues])

  if (loading) return <div className="empty">Loading…</div>

  return (
    <div className="editor">
      <div className="editor-head">
        <h2>{configId ? 'Edit configuration' : 'New configuration'}</h2>
        <div className="head-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>

      <div className="field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My VPN server" />
        <FieldErr issues={grouped['name']} />
      </div>

      <div className="tabs">
        <button className={mode === 'form' ? 'tab active' : 'tab'} onClick={() => setMode('form')}>
          Form
        </button>
        <button className={mode === 'toml' ? 'tab active' : 'tab'} onClick={() => setMode('toml')}>
          Paste / import TOML
        </button>
        <label className="btn ghost file-btn">
          Import .toml file
          <input
            type="file"
            accept=".toml,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onPickFile(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {mode === 'toml' ? (
        <div className="field">
          <label>trusttunnel_client.toml</label>
          <textarea
            className="mono"
            rows={20}
            value={tomlText}
            onChange={(e) => setTomlText(e.target.value)}
            placeholder={'[endpoint]\nhostname = "vpn.example.com"\naddresses = ["1.2.3.4:443"]\nusername = "..."\npassword = "..."'}
          />
        </div>
      ) : (
        <FormFields cfg={cfg} listenerKind={listenerKind} patch={patch} setCfg={setCfg} grouped={grouped} />
      )}

      {issues.length > 0 && (
        <div className="issues">
          <strong>{issues.length} issue(s):</strong>
          <ul>
            {issues.map((i, idx) => (
              <li key={idx}>
                <code>{i.path}</code> — {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {info && <div className="ok-text">{info}</div>}
    </div>
  )
}

function groupIssues(issues: ValidationIssue[]): Record<string, ValidationIssue[]> {
  const out: Record<string, ValidationIssue[]> = {}
  for (const i of issues) (out[i.path] ??= []).push(i)
  return out
}

function FieldErr({ issues }: { issues?: ValidationIssue[] }): JSX.Element | null {
  if (!issues?.length) return null
  return <div className="field-err">{issues.map((i) => i.message).join('; ')}</div>
}

interface FormProps {
  cfg: ClientConfig
  listenerKind: 'tun' | 'socks'
  patch: (fn: (d: ClientConfig) => void) => void
  setCfg: (fn: (prev: ClientConfig) => ClientConfig) => void
  grouped: Record<string, ValidationIssue[]>
}

function FormFields({ cfg, listenerKind, patch, setCfg, grouped }: FormProps): JSX.Element {
  return (
    <>
      <Section title="Endpoint (required)">
        <Row>
          <Text
            label="Hostname"
            value={cfg.endpoint.hostname}
            onChange={(v) => patch((d) => void (d.endpoint.hostname = v))}
            err={grouped['endpoint.hostname']}
            placeholder="vpn.example.com"
          />
          <Select
            label="Upstream protocol"
            value={cfg.endpoint.upstream_protocol}
            options={['http2', 'http3']}
            onChange={(v) => patch((d) => void (d.endpoint.upstream_protocol = v as 'http2' | 'http3'))}
          />
        </Row>
        <Lines
          label="Addresses (one host:port per line)"
          value={arrayToLines(cfg.endpoint.addresses)}
          onChange={(t) => patch((d) => void (d.endpoint.addresses = linesToArray(t)))}
          err={grouped['endpoint.addresses']}
          placeholder={'1.2.3.4:443\nvpn.example.com:443'}
        />
        <Row>
          <Text
            label="Username"
            value={cfg.endpoint.username}
            onChange={(v) => patch((d) => void (d.endpoint.username = v))}
            err={grouped['endpoint.username']}
          />
          <Text
            label="Password"
            type="password"
            value={cfg.endpoint.password}
            onChange={(v) => patch((d) => void (d.endpoint.password = v))}
            err={grouped['endpoint.password']}
          />
        </Row>
        <Row>
          <Check
            label="IPv6"
            value={cfg.endpoint.has_ipv6}
            onChange={(v) => patch((d) => void (d.endpoint.has_ipv6 = v))}
          />
          <Check
            label="Anti-DPI"
            value={cfg.endpoint.anti_dpi}
            onChange={(v) => patch((d) => void (d.endpoint.anti_dpi = v))}
          />
          <Check
            label="Skip cert verification"
            value={cfg.endpoint.skip_verification}
            onChange={(v) => patch((d) => void (d.endpoint.skip_verification = v))}
          />
        </Row>
        <Lines
          label="Endpoint DNS upstreams (optional)"
          value={arrayToLines(cfg.endpoint.dns_upstreams)}
          onChange={(t) => patch((d) => void (d.endpoint.dns_upstreams = linesToArray(t)))}
          err={grouped['endpoint.dns_upstreams']}
          placeholder={'https://dns.adguard.com/dns-query\n8.8.8.8:53'}
        />
      </Section>

      <Section title="General">
        <Row>
          <Select
            label="VPN mode"
            value={cfg.vpn_mode}
            options={['general', 'selective']}
            onChange={(v) => patch((d) => void (d.vpn_mode = v as 'general' | 'selective'))}
          />
          <Select
            label="Log level"
            value={cfg.loglevel}
            options={['info', 'debug', 'trace']}
            onChange={(v) => patch((d) => void (d.loglevel = v as 'info' | 'debug' | 'trace'))}
          />
        </Row>
        <Row>
          <Check
            label="Kill switch"
            value={cfg.killswitch_enabled}
            onChange={(v) => patch((d) => void (d.killswitch_enabled = v))}
          />
          <Check
            label="Post-quantum TLS"
            value={cfg.post_quantum_group_enabled}
            onChange={(v) => patch((d) => void (d.post_quantum_group_enabled = v))}
          />
          <Text
            label="Kill switch allow ports (comma/space)"
            value={cfg.killswitch_allow_ports.join(', ')}
            onChange={(v) => patch((d) => void (d.killswitch_allow_ports = portsToArray(v)))}
          />
        </Row>
        <Lines
          label="Exclusions (domains / IPs / CIDR)"
          value={arrayToLines(cfg.exclusions)}
          onChange={(t) => patch((d) => void (d.exclusions = linesToArray(t)))}
          err={grouped['exclusions']}
          placeholder={'*.example.com\n192.168.0.0/16'}
        />
      </Section>

      <Section title="Listener">
        <div className="radios">
          <label>
            <input
              type="radio"
              checked={listenerKind === 'tun'}
              onChange={() =>
                setCfg((p) => ({ ...p, listener: { tun: emptyConfig().listener.tun } }))
              }
            />
            TUN device (system-wide VPN)
          </label>
          <label>
            <input
              type="radio"
              checked={listenerKind === 'socks'}
              onChange={() =>
                setCfg((p) => ({
                  ...p,
                  listener: { socks: { address: '127.0.0.1:1080', username: null, password: null } }
                }))
              }
            />
            SOCKS5 proxy
          </label>
        </div>

        {listenerKind === 'tun' && cfg.listener.tun && (
          <>
            <Row>
              <Number
                label="MTU"
                value={cfg.listener.tun.mtu_size}
                onChange={(v) => patch((d) => void (d.listener.tun!.mtu_size = v))}
              />
              <Text
                label="Device name (optional)"
                value={cfg.listener.tun.device_name}
                onChange={(v) => patch((d) => void (d.listener.tun!.device_name = v))}
                placeholder="utun (auto)"
              />
              <Check
                label="Change system DNS"
                value={cfg.listener.tun.change_system_dns}
                onChange={(v) => patch((d) => void (d.listener.tun!.change_system_dns = v))}
              />
            </Row>
            <Lines
              label="Included routes (CIDR)"
              value={arrayToLines(cfg.listener.tun.included_routes)}
              onChange={(t) => patch((d) => void (d.listener.tun!.included_routes = linesToArray(t)))}
            />
          </>
        )}

        {listenerKind === 'socks' && cfg.listener.socks && (
          <Row>
            <Text
              label="Bind address"
              value={cfg.listener.socks.address}
              onChange={(v) => patch((d) => void (d.listener.socks!.address = v))}
              err={grouped['listener.socks.address']}
            />
            <Text
              label="SOCKS username (optional)"
              value={cfg.listener.socks.username ?? ''}
              onChange={(v) => patch((d) => void (d.listener.socks!.username = v || null))}
            />
            <Text
              label="SOCKS password (optional)"
              type="password"
              value={cfg.listener.socks.password ?? ''}
              onChange={(v) => patch((d) => void (d.listener.socks!.password = v || null))}
            />
          </Row>
        )}
      </Section>
    </>
  )
}

// ---- small field primitives ----
function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="form-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}
function Row({ children }: { children: ReactNode }): JSX.Element {
  return <div className="row">{children}</div>
}
function Text({
  label,
  value,
  onChange,
  err,
  type = 'text',
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  err?: ValidationIssue[]
  type?: string
  placeholder?: string
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <FieldErr issues={err} />
    </div>
  )
}
function Number({
  label,
  value,
  onChange
}: {
  label: string
  value: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(globalThis.Number(e.target.value))}
      />
    </div>
  )
}
function Select({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}
function Check({
  label,
  value,
  onChange
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
function Lines({
  label,
  value,
  onChange,
  err,
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  err?: ValidationIssue[]
  placeholder?: string
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <textarea rows={3} className="mono" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <FieldErr issues={err} />
    </div>
  )
}
