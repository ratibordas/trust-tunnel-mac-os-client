import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { NetStats } from '@shared/types'

const exec = promisify(execFile)

interface Counters {
  rx: number
  tx: number
}

/**
 * Reads per-interface byte counters from `netstat -ibn`. We index by interface
 * name and read Ibytes/Obytes counting columns from the RIGHT, which is stable
 * across the Link# rows (no Address column) and the inet/inet6 rows.
 *
 *   ... Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
 *   from end:  Ibytes = [-5], Obytes = [-2]
 */
async function readCounters(): Promise<Map<string, Counters>> {
  const map = new Map<string, Counters>()
  const { stdout } = await exec('netstat', ['-ibn'])
  for (const line of stdout.split('\n')) {
    if (!line || line.startsWith('Name')) continue
    const f = line.trim().split(/\s+/)
    if (f.length < 10) continue
    const name = f[0]
    const ibytes = Number(f[f.length - 5])
    const obytes = Number(f[f.length - 2])
    if (!Number.isFinite(ibytes) || !Number.isFinite(obytes)) continue
    // Keep only the first (Link#) row per interface to avoid double counting.
    if (!map.has(name)) map.set(name, { rx: ibytes, tx: obytes })
  }
  return map
}

/**
 * Polls byte counters once per second and reports smoothed up/down speed for
 * the tunnel interface. The tunnel iface is detected as a `utun*` (or the
 * configured device_name) that was NOT present before the connection started.
 */
export class NetStatsPoller {
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
    // Newly appeared utun interface.
    for (const name of counters.keys()) {
      if (name.startsWith('utun') && !this.baseline.has(name)) return name
    }
    return null
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
        const a = 0.4 // EMA smoothing
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
