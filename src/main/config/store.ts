import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { validateConfig, type ClientConfig } from '@shared/schema'
import type { ConfigSummary, SaveConfigArgs, SaveConfigResult } from '@shared/types'
import { configsDir, configIndexPath } from '../paths'
import { parseToml, serializeToml } from './toml'

interface IndexEntry {
  id: string
  name: string
  updatedAt: number
}

interface IndexFile {
  entries: IndexEntry[]
}

async function ensureDir(): Promise<void> {
  await mkdir(configsDir(), { recursive: true })
}

async function readIndex(): Promise<IndexFile> {
  const path = configIndexPath()
  if (!existsSync(path)) return { entries: [] }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as IndexFile
  } catch {
    return { entries: [] }
  }
}

async function writeIndex(index: IndexFile): Promise<void> {
  await ensureDir()
  await writeFile(configIndexPath(), JSON.stringify(index, null, 2), 'utf8')
}

function tomlPath(id: string): string {
  return join(configsDir(), `${id}.toml`)
}

function summarize(entry: IndexEntry, config: ClientConfig): ConfigSummary {
  return {
    id: entry.id,
    name: entry.name,
    hostname: config.endpoint.hostname,
    vpnMode: config.vpn_mode,
    listener: config.listener.tun ? 'tun' : 'socks',
    updatedAt: entry.updatedAt
  }
}

export async function readConfigFile(id: string): Promise<ClientConfig | null> {
  const path = tomlPath(id)
  if (!existsSync(path)) return null
  const res = parseToml(await readFile(path, 'utf8'))
  return res.ok ? res.value! : null
}

export async function listConfigs(): Promise<ConfigSummary[]> {
  const index = await readIndex()
  const out: ConfigSummary[] = []
  for (const entry of index.entries) {
    const config = await readConfigFile(entry.id)
    if (config) out.push(summarize(entry, config))
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getConfig(
  id: string
): Promise<{ id: string; name: string; config: ClientConfig } | null> {
  const index = await readIndex()
  const entry = index.entries.find((e) => e.id === id)
  if (!entry) return null
  const config = await readConfigFile(id)
  if (!config) return null
  return { id, name: entry.name, config }
}

export async function saveConfig(args: SaveConfigArgs): Promise<SaveConfigResult> {
  const validation = validateConfig(args.config)
  if (!validation.ok || !validation.value) {
    return { ok: false, validation }
  }
  await ensureDir()
  const id = args.id ?? randomUUID()
  await writeFile(tomlPath(id), serializeToml(validation.value), 'utf8')

  const index = await readIndex()
  const existing = index.entries.find((e) => e.id === id)
  const now = Date.now()
  if (existing) {
    existing.name = args.name
    existing.updatedAt = now
  } else {
    index.entries.push({ id, name: args.name, updatedAt: now })
  }
  await writeIndex(index)
  return { ok: true, id, validation }
}

export async function importToml(
  name: string,
  text: string
): Promise<SaveConfigResult> {
  const validation = parseToml(text)
  if (!validation.ok || !validation.value) {
    return { ok: false, validation }
  }
  return saveConfig({ name, config: validation.value })
}

export async function exportToml(id: string): Promise<string | null> {
  const config = await readConfigFile(id)
  if (!config) return null
  return serializeToml(config)
}

export async function deleteConfig(id: string): Promise<void> {
  const index = await readIndex()
  index.entries = index.entries.filter((e) => e.id !== id)
  await writeIndex(index)
  await rm(tomlPath(id), { force: true })
}
