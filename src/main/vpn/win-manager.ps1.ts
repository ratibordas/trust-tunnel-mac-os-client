// Windows "manager" script, run once elevated (one UAC prompt per session). It
// starts trusttunnel_client with merged stdout+stderr into a log, records the
// process-tree root PID, then polls a stop sentinel file. When the UI creates
// that file (no elevation needed to write it), the manager kills the tree and
// exits — which fires the sudo-prompt completion callback.
//
// Params: -Bin -Cfg -Log -Stop -PidFile
export const WIN_MANAGER_SCRIPT = `param(
  [Parameter(Mandatory=$true)][string]$Bin,
  [Parameter(Mandatory=$true)][string]$Cfg,
  [Parameter(Mandatory=$true)][string]$Log,
  [Parameter(Mandatory=$true)][string]$Stop,
  [Parameter(Mandatory=$true)][string]$PidFile
)

$ErrorActionPreference = 'SilentlyContinue'
Remove-Item -LiteralPath $Stop -Force

# Run via cmd so stdout+stderr merge into a single log file. The client stays a
# child of cmd; we kill the whole tree on stop. wintun.dll is loaded from the
# client's own directory, so keep the .exe and wintun.dll together.
$inner = '"' + $Bin + '" -c "' + $Cfg + '" > "' + $Log + '" 2>&1'
$proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $inner -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $PidFile -Value $proc.Id -Encoding ascii

while ($true) {
  if (Test-Path -LiteralPath $Stop) { break }
  if ($proc.HasExited) { break }
  Start-Sleep -Milliseconds 400
}

& taskkill /PID $proc.Id /T /F | Out-Null
Remove-Item -LiteralPath $Stop -Force
Remove-Item -LiteralPath $PidFile -Force
exit 0
`
