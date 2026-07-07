import { app } from 'electron'
import { join } from 'node:path'
import { clientBinaryName } from './platform'

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

/**
 * A file shipped in the bundle's resources.
 * - Packaged: electron-builder's extraResources land in process.resourcesPath.
 * - Dev: this module is bundled to <root>/out/main/index.js, so the project's
 *   resources/ dir is two levels up. Resolving against __dirname (not
 *   app.getAppPath(), which varies by launch mode) works in every run mode.
 */
export function bundledResource(name: string): string {
  if (app.isPackaged) return join(process.resourcesPath, name)
  return join(__dirname, '..', '..', 'resources', name)
}

/** Small persisted app settings (e.g. last-connected config for the tray). */
export function settingsPath(): string {
  return join(userDataDir(), 'settings.json')
}

export function binDir(): string {
  return join(userDataDir(), 'bin')
}

/** Path to the managed (downloaded) client binary for this OS. */
export function binaryPath(): string {
  return join(binDir(), clientBinaryName())
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

/** POSIX control channel (macOS/Linux): a FIFO the manager blocks on. */
export function fifoPath(): string {
  return join(runtimeDir(), 'control.fifo')
}

/** Windows control channel: a sentinel file the manager polls for. */
export function stopFilePath(): string {
  return join(runtimeDir(), 'control.stop')
}

export function managerScriptPath(): string {
  return join(runtimeDir(), 'manager.sh')
}

export function winManagerScriptPath(): string {
  return join(runtimeDir(), 'manager.ps1')
}

/** The config the manager actually runs (rendered from the selected config). */
export function activeConfigPath(): string {
  return join(runtimeDir(), 'active.toml')
}
