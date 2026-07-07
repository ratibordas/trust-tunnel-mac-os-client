import { isWindows } from '../platform'
import { MacTunnelController } from './mac-controller'
import { WindowsTunnelController } from './win-controller'

export interface TunnelStartOptions {
  binPath: string
  configPath: string
  logPath: string
  /** Called once the privileged session ends (clean stop, client death, or error). */
  onExit: (result: { error?: string; cancelled?: boolean }) => void
}

/**
 * Platform abstraction over launching the privileged trusttunnel_client and
 * stopping it. Both implementations run a small "manager" once through the OS
 * elevation dialog (one prompt per session) and are controlled over a local
 * channel so disconnect needs no second prompt.
 */
export interface TunnelController {
  start(opts: TunnelStartOptions): Promise<void>
  stop(): Promise<void>
}

export function createController(): TunnelController {
  return isWindows ? new WindowsTunnelController() : new MacTunnelController()
}
