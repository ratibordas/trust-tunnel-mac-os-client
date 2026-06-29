import { app } from 'electron'
import { join } from 'node:path'

// All runtime state lives under Electron's userData dir so we never need write
// access to the .app bundle (which is read-only / signed).
//   ~/Library/Application Support/TrustTunnel Desktop/
export function userDataDir(): string {
  return app.getPath('userData')
}

export function configsDir(): string {
  return join(userDataDir(), 'configs')
}

/** JSON index mapping config id -> metadata. */
export function configIndexPath(): string {
  return join(userDataDir(), 'configs', 'index.json')
}

export function binDir(): string {
  return join(userDataDir(), 'bin')
}

export function binaryPath(): string {
  return join(binDir(), 'trusttunnel_client')
}

export function binaryVersionPath(): string {
  return join(binDir(), 'version.json')
}

/** Per-session runtime files for the privileged manager. */
export function runtimeDir(): string {
  return join(userDataDir(), 'runtime')
}

export function logFilePath(): string {
  return join(runtimeDir(), 'client.log')
}

export function pidFilePath(): string {
  return join(runtimeDir(), 'client.pid')
}

export function fifoPath(): string {
  return join(runtimeDir(), 'control.fifo')
}

export function managerScriptPath(): string {
  return join(runtimeDir(), 'manager.sh')
}

/** The config the manager actually runs (rendered from the selected config). */
export function activeConfigPath(): string {
  return join(runtimeDir(), 'active.toml')
}
