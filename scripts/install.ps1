# One-time install on the PC: dependencies, the local config, the data folder, the check.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
cmd /c "npm install --include=dev --no-audit --no-fund 2>&1"
cmd /c "npm run build 2>&1"
if (-not (Test-Path office.config.local.json)) { Copy-Item office.config.local.example.json office.config.local.json }
New-Item -ItemType Directory -Force -Path data | Out-Null
node bin\nightdesk.mjs check
