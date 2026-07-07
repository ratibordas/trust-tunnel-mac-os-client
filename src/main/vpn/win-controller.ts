import { rm, writeFile } from 'node:fs/promises'
import sudo from '@vscode/sudo-prompt'
import { pidFilePath, stopFilePath, winManagerScriptPath } from '../paths'
import { WIN_MANAGER_SCRIPT } from './win-manager.ps1'
import type { TunnelController, TunnelStartOptions } from './controller'

// Double-quote a path for a Windows command line.
function q(arg: string): string {
  return `"${arg.replace(/"/g, '')}"`
}

/**
 * Windows: a PowerShell manager launched once elevated (UAC) via sudo-prompt. It
 * runs the client and polls a stop sentinel file; the UI creates that file to
 * disconnect, so no second UAC prompt is needed.
 */
export class WindowsTunnelController implements TunnelController {
  async start({ binPath, configPath, logPath, onExit }: TunnelStartOptions): Promise<void> {
    await rm(stopFilePath(), { force: true })
    await rm(pidFilePath(), { force: true })
    await writeFile(winManagerScriptPath(), WIN_MANAGER_SCRIPT, 'utf8')

    const command =
      `powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden ` +
      `-File ${q(winManagerScriptPath())} ` +
      `-Bin ${q(binPath)} -Cfg ${q(configPath)} -Log ${q(logPath)} ` +
      `-Stop ${q(stopFilePath())} -PidFile ${q(pidFilePath())}`

    sudo.exec(command, { name: 'TrustTunnel Desktop' }, (error) => {
      if (error) {
        const cancelled = /cancel|denied|The operation was canceled/i.test(error.message)
        onExit(cancelled ? { cancelled: true } : { error: error.message })
      } else {
        onExit({})
      }
    })
  }

  async stop(): Promise<void> {
    // The elevated manager polls for this file; creating it needs no elevation.
    await writeFile(stopFilePath(), 'stop', 'utf8').catch(() => {})
  }
}
