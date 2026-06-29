import { existsSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'

/**
 * Tails a growing log file, invoking onChunk with newly appended text.
 * Polling-based (400ms) so it works regardless of how the file is written by
 * the root process and across volumes.
 */
export class FileTailer {
  private offset = 0
  private timer: NodeJS.Timeout | null = null
  private busy = false

  constructor(
    private readonly path: string,
    private readonly onChunk: (text: string) => void,
    private readonly intervalMs = 400
  ) {}

  start(): void {
    this.offset = 0
    this.timer = setInterval(() => void this.poll(), this.intervalMs)
  }

  private async poll(): Promise<void> {
    if (this.busy || !existsSync(this.path)) return
    this.busy = true
    try {
      const s = await stat(this.path)
      if (s.size < this.offset) this.offset = 0 // file was truncated/rotated
      if (s.size > this.offset) {
        const fh = await open(this.path, 'r')
        try {
          const length = s.size - this.offset
          const buf = Buffer.alloc(length)
          await fh.read(buf, 0, length, this.offset)
          this.offset = s.size
          this.onChunk(buf.toString('utf8'))
        } finally {
          await fh.close()
        }
      }
    } catch {
      // transient; try again next tick
    } finally {
      this.busy = false
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
