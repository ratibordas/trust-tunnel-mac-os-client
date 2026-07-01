import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { settingsPath } from './paths'

interface Settings {
  lastConfigId?: string
  /** User-specified path to an existing trusttunnel_client binary. */
  binaryPathOverride?: string
}

async function read(): Promise<Settings> {
  if (!existsSync(settingsPath())) return {}
  try {
    return JSON.parse(await readFile(settingsPath(), 'utf8')) as Settings
  } catch {
    return {}
  }
}

export async function getLastConfigId(): Promise<string | null> {
  return (await read()).lastConfigId ?? null
}

export async function setLastConfigId(id: string): Promise<void> {
  const s = await read()
  s.lastConfigId = id
  await writeFile(settingsPath(), JSON.stringify(s, null, 2), 'utf8')
}

export async function getBinaryPathOverride(): Promise<string | null> {
  return (await read()).binaryPathOverride ?? null
}

export async function setBinaryPathOverride(path: string): Promise<void> {
  const s = await read()
  s.binaryPathOverride = path
  await writeFile(settingsPath(), JSON.stringify(s, null, 2), 'utf8')
}

export async function clearBinaryPathOverride(): Promise<void> {
  const s = await read()
  delete s.binaryPathOverride
  await writeFile(settingsPath(), JSON.stringify(s, null, 2), 'utf8')
}
