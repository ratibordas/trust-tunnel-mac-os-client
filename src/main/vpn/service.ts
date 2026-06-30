import type { ConnectionState } from '@shared/types'
import { getConfig, listConfigs } from '../config/store'
import { getLastConfigId, setLastConfigId } from '../settings'
import { vpnRunner } from './runner'

/** Connect by config id, remembering it as the last-used config (for the tray). */
export async function connectById(configId: string): Promise<ConnectionState> {
  const found = await getConfig(configId)
  if (!found) throw new Error('Config not found')
  await setLastConfigId(configId)
  await vpnRunner.connect({ configId, configName: found.name, config: found.config })
  return vpnRunner.getState()
}

/**
 * Connect the last-used config, falling back to the first available one.
 * Returns null if there is nothing to connect (caller should open the window).
 */
export async function connectPreferred(): Promise<ConnectionState | null> {
  const last = await getLastConfigId()
  const id = (last && (await getConfig(last)) ? last : null) ?? (await listConfigs())[0]?.id ?? null
  if (!id) return null
  return connectById(id)
}
