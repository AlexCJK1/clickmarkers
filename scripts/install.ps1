# One-time install on Windows: dependencies, the build, your own office folder next to this one (init), the check.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
cmd /c "npm install --include=dev --no-audit --no-fund 2>&1"
cmd /c "npm run build 2>&1"
if (-not (Test-Path office.config.local.json)) { node bin\clickmarkers.mjs init }
node bin\clickmarkers.mjs check
