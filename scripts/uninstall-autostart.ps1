# Removes the two scheduled tasks scripts\install-autostart.ps1 registered, and stops the office.
$root = Split-Path $PSScriptRoot -Parent
Unregister-ScheduledTask -TaskName 'Clickmarkers', 'Clickmarkers watchdog' -Confirm:$false -ErrorAction SilentlyContinue
& (Join-Path $PSScriptRoot 'stop-office.ps1')
"removed: Clickmarkers, Clickmarkers watchdog (the office is stopped; npm start runs it by hand)"
