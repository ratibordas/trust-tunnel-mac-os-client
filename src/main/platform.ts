export const isWindows = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

/** The trusttunnel_client executable file name for this OS. */
export function clientBinaryName(): string {
  return isWindows ? 'trusttunnel_client.exe' : 'trusttunnel_client'
}
