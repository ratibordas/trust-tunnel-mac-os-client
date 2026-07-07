import { app, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron'
import type { ConnectionPhase, ConnectionState } from '@shared/types'
import { bundledResource } from './paths'
import { isWindows } from './platform'
import { vpnRunner } from './vpn/runner'
import { connectPreferred } from './vpn/service'

let tray: Tray | null = null

// On Windows there's no Dock, so reflect status via the tray icon colour
// (green/amber/purple). On macOS the tray stays a monochrome template icon and
// the Dock carries the colour instead.
function statusIconName(phase: ConnectionPhase): string {
  if (phase === 'connected') return 'dock-connected.png'
  if (phase === 'connecting' || phase === 'reconnecting') return 'dock-connecting.png'
  return 'dock-idle.png'
}

function trayImage(phase: ConnectionPhase) {
  if (isWindows) {
    return nativeImage
      .createFromPath(bundledResource(statusIconName(phase)))
      .resize({ width: 18, height: 18 })
  }
  const img = nativeImage.createFromPath(bundledResource('trayTemplate.png'))
  img.setTemplateImage(true) // adapts to light/dark menu bar automatically
  return img
}

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
  tray = new Tray(trayImage('disconnected'))
  tray.on('click', () => tray?.popUpContextMenu())

  const render = (state: ConnectionState): void => {
    if (!tray) return
    if (isWindows) tray.setImage(trayImage(state.phase))
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
