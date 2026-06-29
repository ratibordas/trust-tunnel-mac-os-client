import { execFile } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { BinaryInfo, DownloadProgress, UpdateInfo } from '@shared/types'
import { binDir, binaryPath, binaryVersionPath } from '../paths'

const exec = promisify(execFile)

const REPO = 'TrustTunnel/TrustTunnel'
const RELEASES_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
// macOS ships a single universal (arm64 + x86_64) build.
const ASSET_RE = /^trusttunnel-v[\d.]+-macos-universal\.tar\.gz$/
const BINARY_NAME = 'trusttunnel_client'

interface VersionFile {
  version: string
  installedAt: number
}

async function readVersion(): Promise<string | null> {
  if (!existsSync(binaryVersionPath())) return null
  try {
    return (JSON.parse(await readFile(binaryVersionPath(), 'utf8')) as VersionFile).version
  } catch {
    return null
  }
}

export async function getBinaryInfo(): Promise<BinaryInfo> {
  const installed = existsSync(binaryPath())
  return {
    installed,
    installedVersion: installed ? await readVersion() : null,
    path: installed ? binaryPath() : null
  }
}

/** Compare "1.0.33" style versions. Returns >0 if a>b. */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

interface GithubAsset {
  name: string
  browser_download_url: string
  size: number
}
interface GithubRelease {
  tag_name: string
  published_at: string
  assets: GithubAsset[]
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const res = await fetch(RELEASES_LATEST, {
    headers: { 'User-Agent': 'TrustTunnel-Desktop', Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)
  return (await res.json()) as GithubRelease
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const release = await fetchLatestRelease()
  const asset = release.assets.find((a) => ASSET_RE.test(a.name))
  const latestVersion = release.tag_name.replace(/^v/, '')
  const installedVersion = await readVersion()
  return {
    latestVersion,
    installedVersion,
    updateAvailable:
      !!latestVersion && (!installedVersion || compareVersions(latestVersion, installedVersion) > 0),
    downloadUrl: asset?.browser_download_url ?? null,
    publishedAt: release.published_at ?? null
  }
}

async function findBinary(dir: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = await findBinary(full)
      if (found) return found
    } else if (entry.name === BINARY_NAME) {
      return full
    }
  }
  return null
}

/**
 * Downloads the latest macOS universal release, extracts trusttunnel_client,
 * installs it into userData/bin, strips the Gatekeeper quarantine flag, and
 * records the version. Reports progress through onProgress.
 */
export async function installLatest(
  onProgress: (p: DownloadProgress) => void
): Promise<{ ok: boolean; version: string | null; error?: string }> {
  let workdir: string | null = null
  try {
    const info = await checkUpdate()
    if (!info.downloadUrl || !info.latestVersion) {
      throw new Error('No macOS universal asset found in the latest release')
    }

    workdir = await mkdtemp(join(tmpdir(), 'tt-dl-'))
    const tarball = join(workdir, 'release.tar.gz')

    onProgress({ phase: 'downloading', receivedBytes: 0, totalBytes: null })
    const res = await fetch(info.downloadUrl, { headers: { 'User-Agent': 'TrustTunnel-Desktop' } })
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || null

    let received = 0
    const reader = Readable.fromWeb(res.body as never)
    reader.on('data', (chunk: Buffer) => {
      received += chunk.length
      onProgress({ phase: 'downloading', receivedBytes: received, totalBytes: total })
    })
    await pipeline(reader, createWriteStream(tarball))

    onProgress({ phase: 'extracting', receivedBytes: received, totalBytes: total })
    const extractDir = join(workdir, 'extracted')
    await mkdir(extractDir, { recursive: true })
    await exec('tar', ['-xzf', tarball, '-C', extractDir])

    const found = await findBinary(extractDir)
    if (!found) throw new Error(`'${BINARY_NAME}' not found inside the release archive`)

    onProgress({ phase: 'installing', receivedBytes: received, totalBytes: total })
    await mkdir(binDir(), { recursive: true })
    await copyFile(found, binaryPath())
    await exec('chmod', ['+x', binaryPath()])
    // Clear quarantine so macOS doesn't block the unsigned binary.
    await exec('xattr', ['-d', 'com.apple.quarantine', binaryPath()]).catch(() => {})

    await writeFile(
      binaryVersionPath(),
      JSON.stringify({ version: info.latestVersion, installedAt: Date.now() } as VersionFile, null, 2)
    )
    await assertExecutable()

    onProgress({ phase: 'done', receivedBytes: received, totalBytes: total })
    return { ok: true, version: info.latestVersion }
  } catch (err) {
    const message = (err as Error).message
    onProgress({ phase: 'error', receivedBytes: 0, totalBytes: null, message })
    return { ok: false, version: null, error: message }
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {})
  }
}

async function assertExecutable(): Promise<void> {
  const s = await stat(binaryPath())
  if (!s.isFile() || s.size === 0) throw new Error('Installed binary is empty')
}
