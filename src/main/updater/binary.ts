import { execFile } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { BinaryInfo, BinarySource, DownloadProgress, UpdateInfo } from '@shared/types'
import { binDir, binaryPath, binaryVersionPath } from '../paths'
import { clientBinaryName, isMac, isWindows } from '../platform'
import {
  clearBinaryPathOverride,
  getBinaryPathOverride,
  setBinaryPathOverride
} from '../settings'

const exec = promisify(execFile)

// The client is published per-platform in this repo (Windows/macOS/Linux),
// unlike the endpoint repo which lacks Windows builds.
const REPO = 'TrustTunnel/TrustTunnelClient'
const RELEASES_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const BINARY_NAME = clientBinaryName()

/** Maps process.arch to the arch token used in release asset names. */
function archToken(): string {
  if (isWindows) return process.arch === 'arm64' ? 'aarch64' : process.arch === 'ia32' ? 'i686' : 'x86_64'
  if (isMac) return 'universal'
  return process.arch === 'arm64' ? 'aarch64' : 'x86_64'
}

/** Regex matching the release asset for this platform+arch. */
function assetRegex(): RegExp {
  const v = '[\\d.]+'
  if (isWindows) return new RegExp(`^trusttunnel_client-v${v}-windows-${archToken()}\\.zip$`)
  if (isMac) return new RegExp(`^trusttunnel_client-v${v}-macos-universal\\.tar\\.gz$`)
  return new RegExp(`^trusttunnel_client-v${v}-linux-${archToken()}\\.tar\\.gz$`)
}

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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])
}

/**
 * The user's real PATH from their login shell (macOS/Linux). A GUI app launched
 * from Finder/Dock only gets a minimal PATH, so custom entries added in
 * .zshrc/.zprofile (e.g. ~/TrustTunnel, homebrew) are otherwise invisible.
 */
async function loginShellPath(): Promise<string[]> {
  const shell = process.env.SHELL || '/bin/zsh'
  for (const flags of [['-lic'], ['-lc']]) {
    try {
      const { stdout } = await withTimeout(exec(shell, [...flags, 'printf "__TTP__:%s" "$PATH"']), 3000)
      const m = stdout.match(/__TTP__:(.*)/)
      if (m && m[1].trim()) return m[1].trim().split(':').filter(Boolean)
    } catch {
      // try next flag set / give up
    }
  }
  return []
}

async function detectSystemBinary(): Promise<string | null> {
  if (isWindows) {
    // Windows GUI apps DO inherit the user/system PATH, so `where` + %PATH% work.
    try {
      const { stdout } = await exec('where', [BINARY_NAME], { windowsHide: true })
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
      if (first && existsSync(first)) return first
    } catch {
      // not on PATH
    }
    for (const dir of (process.env.PATH ?? '').split(';')) {
      if (!dir) continue
      const p = join(dir, BINARY_NAME)
      if (existsSync(p)) return p
    }
    return null
  }

  const dirs = [
    ...(await loginShellPath()),
    ...(process.env.PATH ? process.env.PATH.split(':') : []),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin'
  ]
  const seen = new Set<string>()
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    const p = join(dir, BINARY_NAME)
    if (existsSync(p)) return p
  }
  return null
}

/** Resolve the binary to actually run: custom override > downloaded > system. */
export async function resolveBinaryPath(): Promise<{ path: string | null; source: BinarySource }> {
  const override = await getBinaryPathOverride()
  if (override && existsSync(override)) return { path: override, source: 'custom' }
  if (existsSync(binaryPath())) return { path: binaryPath(), source: 'downloaded' }
  const sys = await detectSystemBinary()
  if (sys) return { path: sys, source: 'system' }
  return { path: null, source: null }
}

export async function getBinaryInfo(): Promise<BinaryInfo> {
  const { path, source } = await resolveBinaryPath()
  return {
    installed: !!path,
    installedVersion: source === 'downloaded' ? await readVersion() : null,
    path,
    source
  }
}

/** Point at an existing binary on disk. Returns the refreshed info or an error. */
export async function setBinaryPath(
  path: string
): Promise<{ ok: boolean; error?: string; info: BinaryInfo }> {
  if (!existsSync(path)) return { ok: false, error: 'File does not exist', info: await getBinaryInfo() }
  const s = await stat(path)
  if (!s.isFile()) return { ok: false, error: 'Not a file', info: await getBinaryInfo() }
  await setBinaryPathOverride(path)
  return { ok: true, info: await getBinaryInfo() }
}

/** Forget a custom path and fall back to downloaded/system resolution. */
export async function clearBinaryPath(): Promise<BinaryInfo> {
  await clearBinaryPathOverride()
  return getBinaryInfo()
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
  const re = assetRegex()
  const asset = release.assets.find((a) => re.test(a.name))
  const latestVersion = release.tag_name.replace(/^v/, '')
  const installedVersion = await readVersion()
  return {
    latestVersion,
    installedVersion,
    updateAvailable:
      !!latestVersion &&
      !!asset &&
      (!installedVersion || compareVersions(latestVersion, installedVersion) > 0),
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
 * Downloads the latest client release for this platform, extracts it, and
 * installs the whole payload into userData/bin — the whole payload matters on
 * Windows, where wintun.dll must sit next to trusttunnel_client.exe. Records the
 * version and reports progress.
 */
export async function installLatest(
  onProgress: (p: DownloadProgress) => void
): Promise<{ ok: boolean; version: string | null; error?: string }> {
  let workdir: string | null = null
  try {
    const info = await checkUpdate()
    if (!info.downloadUrl || !info.latestVersion) {
      throw new Error(`No ${isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux'} asset in the latest release`)
    }

    workdir = await mkdtemp(join(tmpdir(), 'tt-dl-'))
    const isZip = info.downloadUrl.toLowerCase().endsWith('.zip')
    const archive = join(workdir, isZip ? 'release.zip' : 'release.tar.gz')

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
    await pipeline(reader, createWriteStream(archive))

    onProgress({ phase: 'extracting', receivedBytes: received, totalBytes: total })
    const extractDir = join(workdir, 'extracted')
    await mkdir(extractDir, { recursive: true })
    // bsdtar (macOS + Windows 10+ ship it as `tar`) extracts both zip and tar.gz.
    await exec('tar', [isZip ? '-xf' : '-xzf', archive, '-C', extractDir])

    const found = await findBinary(extractDir)
    if (!found) throw new Error(`'${BINARY_NAME}' not found inside the release archive`)

    onProgress({ phase: 'installing', receivedBytes: received, totalBytes: total })
    // Replace binDir with the archive payload (brings wintun.dll etc. alongside).
    await rm(binDir(), { recursive: true, force: true })
    await mkdir(binDir(), { recursive: true })
    await cp(dirname(found), binDir(), { recursive: true })

    if (!isWindows) {
      await exec('chmod', ['+x', binaryPath()])
      if (isMac) {
        // Clear quarantine so macOS doesn't block the unsigned binary.
        await exec('xattr', ['-dr', 'com.apple.quarantine', binDir()]).catch(() => {})
      }
    }

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
