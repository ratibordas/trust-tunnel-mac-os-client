import type { NetStats } from '@shared/types'
import { isWindows } from '../platform'
import { NetStatsPoller } from './netstats'
import { WinStatsPoller } from './win-netstats'

export interface StatsPoller {
  start(deviceHint?: string): void | Promise<void>
  stop(): void
}

export function createStatsPoller(onStats: (s: NetStats) => void): StatsPoller {
  return isWindows ? new WinStatsPoller(onStats) : new NetStatsPoller(onStats)
}
