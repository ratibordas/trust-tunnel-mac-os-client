import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { settingsPath } from './paths'

interface Settings {
  lastConfigId?: string
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
