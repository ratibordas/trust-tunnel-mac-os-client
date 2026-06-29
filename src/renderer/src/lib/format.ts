export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatSpeed(bps: number): string {
  // bytes/sec -> bits/sec for the familiar Mbps display
  const bits = bps * 8
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps']
  if (bits < 1) return '0 bps'
  const i = Math.min(units.length - 1, Math.floor(Math.log(bits) / Math.log(1000)))
  return `${(bits / 1000 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '00:00'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}
