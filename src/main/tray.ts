import { app, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron'
import type { ConnectionPhase, ConnectionState } from '@shared/types'
import { bundledResource } from './paths'
import { vpnRunner } from './vpn/runner'
import { connectPreferred } from './vpn/service'

let tray: Tray | null = null

const PHASE_TEXT: Record<ConnectionPhase, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnecting: 'Disconnecting…',
  error: 'Error'
}

async function quitApp(): Promise<void> {
  // Bring the tunnel down before quitting so no root process is left running.
  try {
    await vpnRunner.disconnect()
  } catch {
    // ignore — we're quitting regardless
  }
  app.quit()
}

export function initTray(showWindow: () => void): void {
  const image = nativeImage.createFromPath(bundledResource('trayTemplate.png'))
  image.setTemplateImage(true) // adapts to light/dark menu bar automatically
  tray = new Tray(image)
  tray.on('click', () => tray?.popUpContextMenu())

  const render = (state: ConnectionState): void => {
    if (!tray) return
    const active =
      state.phase === 'connected' ||
      state.phase === 'connecting' ||
      state.phase === 'reconnecting'
    const statusLine = PHASE_TEXT[state.phase] + (state.configName ? ` — ${state.configName}` : '')
    tray.setToolTip(`TrustTunnel Desktop · ${statusLine}`)

    const items: MenuItemConstructorOptions[] = [
      { label: statusLine, enabled: false },
      ...(state.latencyMs != null
        ? [{ label: `Ping ${state.latencyMs} ms`, enabled: false } as MenuItemConstructorOptions]
        : []),
      { type: 'separator' },
      { label: 'Open', click: showWindow }
    ]

    if (active) {
      items.push({
        label: 'Disconnect',
        enabled: state.phase !== 'disconnecting',
        click: () => void vpnRunner.disconnect().catch(() => {})
      })
    } else {
      items.push({
        label: 'Connect',
        click: async () => {
          const res = await connectPreferred().catch(() => null)
          if (!res) showWindow() // nothing remembered / no configs — let the user choose
        }
      })
    }

    items.push({ type: 'separator' }, { label: 'Quit', click: () => void quitApp() })
    tray.setContextMenu(Menu.buildFromTemplate(items))
  }

  render(vpnRunner.getState())
  vpnRunner.on('state', render)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
