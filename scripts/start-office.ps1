# Starts Nightdesk and keeps it up: if the process dies it is started again after 5 s. Stop it with
# scripts\stop-office.ps1 (which also drops a stop file so this loop ends).
# The API key is NOT put in the environment here: the runtime reads it from the secrets file and hands it
# only to the runs that need it.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue
$log = Join-Path $root 'data\office.log'
$stop = Join-Path $root 'data\stop'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
Remove-Item $stop -ErrorAction SilentlyContinue
while ($true) {
  "$(Get-Date -Format s) start" | Add-Content $log
  & node bin\nightdesk.mjs serve 2>&1 | ForEach-Object { $_ | Add-Content $log }
  if (Test-Path $stop) { "$(Get-Date -Format s) stopped" | Add-Content $log; break }
  "$(Get-Date -Format s) exited; restarting in 5 s" | Add-Content $log
  Start-Sleep 5
}
