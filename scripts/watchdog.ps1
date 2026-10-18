# Every 5 minutes: if the office does not answer on its port (from office.config.local.json), and nobody stopped it on purpose (data\stop),
# and no keep-alive loop is already running, start it again. Writes one line to data\watchdog.log only when
# it acts, so the log stays short.
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
$log = Join-Path $root 'data\watchdog.log'
if (Test-Path (Join-Path $root 'data\stop')) { exit 0 }
# the port from the office's own config, as the office reads it (4600 when unset)
$port = 4600
try { $c = Get-Content (Join-Path $root 'office.config.local.json') -Raw | ConvertFrom-Json; if ($c.port) { $port = [int]$c.port } } catch {}
# any answer means it is up: with CLICKMARKERS_TOKEN set, the health check answers 401 to a caller without it
try { Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 8 | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } }
$loop = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*clickmarkers*start-office.ps1*' }
if ($loop) {
  # a loop exists but the port is silent: it may be mid-restart; give it one more round before acting
  $flag = Join-Path $root 'data\watchdog.pending'
  if (-not (Test-Path $flag)) { New-Item -ItemType File -Force -Path $flag | Out-Null; exit 0 }
  Remove-Item $flag -Force
  "$(Get-Date -Format s) office silent for 2 rounds with a loop running; restarting the loop" | Add-Content $log
  $loop | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bin\clickmarkers.mjs serve*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep 2
} else {
  "$(Get-Date -Format s) office down and no loop; starting it" | Add-Content $log
}
Remove-Item (Join-Path $root 'data\watchdog.pending') -ErrorAction SilentlyContinue
Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $root 'scripts\start-hidden.vbs') + '"')
