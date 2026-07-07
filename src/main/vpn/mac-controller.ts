import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import sudo from '@vscode/sudo-prompt'
import { fifoPath, managerScriptPath, pidFilePath } from '../paths'
import { MANAGER_SCRIPT } from './manager.sh'
import type { TunnelController, TunnelStartOptions } from './controller'

const exec = promisify(execFile)

function sh(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * macOS / Linux: a POSIX shell manager launched once via sudo-prompt. It runs
 * the client, then blocks reading a FIFO; writing to the FIFO stops it.
 */
export class MacTunnelController implements TunnelController {
  async start({ binPath, configPath, logPath, onExit }: TunnelStartOptions): Promise<void> {
    await rm(fifoPath(), { force: true })
    await rm(pidFilePath(), { force: true })
    await writeFile(managerScriptPath(), MANAGER_SCRIPT, { mode: 0o755 })
    await exec('mkfifo', [fifoPath()])

    const command = `/bin/sh ${sh(managerScriptPath())} ${sh(binPath)} ${sh(configPath)} ${sh(
      logPath
    )} ${sh(fifoPath())} ${sh(pidFilePath())}`

    sudo.exec(command, { name: 'TrustTunnel Desktop' }, (error) => {
      if (error) {
        const cancelled = /cancel|denied|User did not/i.test(error.message)
        onExit(cancelled ? { cancelled: true } : { error: error.message })
      } else {
        onExit({})
      }
    })
  }

  async stop(): Promise<void> {
    const fifo = fifoPath()
    if (!existsSync(fifo)) return
    // Write through a short-lived shell so a missing reader can't hang us.
    await Promise.race([
      exec('/bin/sh', ['-c', `echo stop > ${sh(fifo)}`]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
    ]).catch(() => {})
  }
}
