$root = Split-Path $PSScriptRoot -Parent
New-Item -ItemType File -Force -Path (Join-Path $root 'data\stop') | Out-Null
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -match 'clickmarkers\.mjs["'']?\s+serve' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
