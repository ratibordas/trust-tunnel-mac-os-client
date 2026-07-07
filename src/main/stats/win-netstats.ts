import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { NetStats } from '@shared/types'

const exec = promisify(execFile)

interface Counters {
  rx: number
  tx: number
}

const PS_QUERY =
  'Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress'

async function readCounters(): Promise<Map<string, Counters>> {
  const map = new Map<string, Counters>()
  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY],
    { windowsHide: true }
  )
  const text = stdout.trim()
  if (!text) return map
  const parsed = JSON.parse(text) as
    | { Name: string; ReceivedBytes: number; SentBytes: number }
    | { Name: string; ReceivedBytes: number; SentBytes: number }[]
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  for (const r of rows) {
    if (r && typeof r.Name === 'string') {
      map.set(r.Name, { rx: Number(r.ReceivedBytes) || 0, tx: Number(r.SentBytes) || 0 })
    }
  }
  return map
}

/**
 * Windows equivalent of the macOS poller. The tunnel adapter (Wintun) shows up
 * as a NEW adapter after connecting; we lock onto it (or the configured
 * device_name) and report smoothed throughput.
 */
export class WinStatsPoller {
  private timer: NodeJS.Timeout | null = null
  private baseline = new Set<string>()
  private iface: string | null = null
  private deviceHint: string | null = null
  private last: { t: number; rx: number; tx: number } | null = null
  private startCounters: Counters | null = null
  private emaDown = 0
  private emaUp = 0

  constructor(private readonly onStats: (s: NetStats) => void) {}

  async start(deviceHint?: string): Promise<void> {
    this.deviceHint = deviceHint && deviceHint.trim() ? deviceHint.trim() : null
    this.iface = null
    this.last = null
    this.startCounters = null
    this.emaDown = 0
    this.emaUp = 0
    try {
      this.baseline = new Set((await readCounters()).keys())
    } catch {
      this.baseline = new Set()
    }
    this.timer = setInterval(() => void this.tick(), 1000)
  }

  private pickIface(counters: Map<string, Counters>): string | null {
    if (this.deviceHint && counters.has(this.deviceHint)) return this.deviceHint
    // A newly-appeared adapter, preferring Wintun/TrustTunnel-looking names.
    const fresh = [...counters.keys()].filter((n) => !this.baseline.has(n))
    const preferred = fresh.find((n) => /wintun|trusttunnel|tunnel|wg|tun/i.test(n))
    return preferred ?? fresh[0] ?? null
  }

  private async tick(): Promise<void> {
    let counters: Map<string, Counters>
    try {
      counters = await readCounters()
    } catch {
      return
    }
    if (!this.iface) this.iface = this.pickIface(counters)
    if (!this.iface) {
      this.onStats({ downloadBps: 0, uploadBps: 0, downloadTotal: 0, uploadTotal: 0, iface: null })
      return
    }
    const cur = counters.get(this.iface)
    if (!cur) return
    if (!this.startCounters) this.startCounters = { ...cur }
    const now = Date.now()
    if (this.last) {
      const dt = (now - this.last.t) / 1000
      if (dt > 0) {
        const down = Math.max(0, (cur.rx - this.last.rx) / dt)
        const up = Math.max(0, (cur.tx - this.last.tx) / dt)
        const a = 0.4
        this.emaDown = a * down + (1 - a) * this.emaDown
        this.emaUp = a * up + (1 - a) * this.emaUp
      }
    }
    this.last = { t: now, rx: cur.rx, tx: cur.tx }
    this.onStats({
      downloadBps: Math.round(this.emaDown),
      uploadBps: Math.round(this.emaUp),
      downloadTotal: Math.max(0, cur.rx - this.startCounters.rx),
      uploadTotal: Math.max(0, cur.tx - this.startCounters.tx),
      iface: this.iface
    })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
