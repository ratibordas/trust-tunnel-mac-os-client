import { useCallback, useEffect, useState } from 'react'
import type { BinaryInfo, DownloadProgress, UpdateInfo } from '@shared/types'
import { formatBytes } from '../lib/format'

interface Props {
  binary: BinaryInfo | null
  onBinaryChange: () => void | Promise<void>
}

export default function TitleBar({ binary, onBinaryChange }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)

  useEffect(() => {
    const off = window.api.events.onDownloadProgress(setProgress)
    return off
  }, [])

  const check = useCallback(async () => {
    setChecking(true)
    try {
      setUpdate(await window.api.binary.checkUpdate())
    } catch {
      setUpdate(null)
    } finally {
      setChecking(false)
    }
  }, [])

  const install = useCallback(async () => {
    setProgress({ phase: 'downloading', receivedBytes: 0, totalBytes: null })
    const res = await window.api.binary.install()
    await onBinaryChange()
    await check()
    if (res.ok) setTimeout(() => setProgress(null), 1500)
  }, [onBinaryChange, check])

  const browse = useCallback(async () => {
    const res = await window.api.binary.browse()
    await onBinaryChange()
    if (!res.ok && res.error) {
      setProgress({ phase: 'error', receivedBytes: 0, totalBytes: null, message: res.error })
    } else if (res.ok) {
      setProgress(null)
    }
  }, [onBinaryChange])

  const useAuto = useCallback(async () => {
    await window.api.binary.clearPath()
    await onBinaryChange()
    setProgress(null)
  }, [onBinaryChange])

  const installed = binary?.installed
  const version = binary?.installedVersion
  const source = binary?.source
  const updateAvailable = update?.updateAvailable
  const sourceLabel =
    source === 'downloaded' ? `v${version ?? '?'}` : source ? `(${source})` : ''

  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <span className="title-text">TrustTunnel Desktop</span>
      </div>
      <div className="titlebar-actions">
        <button className={`pill ${installed ? 'ok' : 'bad'}`} onClick={() => { setOpen((o) => !o); void check() }}>
          {installed ? `client ${sourceLabel}` : 'client not installed'}
          {updateAvailable ? ' • update' : ''}
        </button>
        {open && (
          <div className="menu">
            <div className="menu-row">
              <strong>trusttunnel_client</strong>
              <span className="muted">
                {installed ? `${source}${source === 'downloaded' ? ` · v${version ?? '?'}` : ''}` : 'not found'}
              </span>
            </div>
            {binary?.path && (
              <div className="menu-row">
                <span className="muted path" title={binary.path}>{binary.path}</span>
              </div>
            )}
            <div className="menu-row">
              <span className="muted">
                {checking
                  ? 'checking GitHub…'
                  : update
                    ? `latest: v${update.latestVersion ?? '?'}`
                    : 'latest: unknown'}
              </span>
            </div>
            {progress && progress.phase !== 'done' && progress.phase !== 'error' && (
              <div className="menu-row">
                <span className="muted">
                  {progress.phase}…{' '}
                  {progress.totalBytes
                    ? `${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}`
                    : formatBytes(progress.receivedBytes)}
                </span>
              </div>
            )}
            {progress?.phase === 'error' && <div className="menu-row err">{progress.message}</div>}
            {progress?.phase === 'done' && <div className="menu-row ok-text">Installed ✓</div>}
            <div className="menu-actions">
              <button className="btn" onClick={check} disabled={checking}>
                Check for updates
              </button>
              <button
                className="btn primary"
                onClick={install}
                disabled={progress?.phase === 'downloading' || progress?.phase === 'extracting'}
              >
                {source === 'downloaded' ? (updateAvailable ? 'Update' : 'Reinstall') : 'Download'}
              </button>
            </div>
            <div className="menu-divider" />
            <div className="menu-row">
              <span className="muted">No GitHub access, or already installed?</span>
            </div>
            <div className="menu-actions">
              <button className="btn" onClick={browse}>
                Use existing binary…
              </button>
              {source === 'custom' && (
                <button className="btn" onClick={useAuto}>
                  Use auto-detected
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
