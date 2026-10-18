# Registers two scheduled tasks for the current user:
#   "Clickmarkers"           at logon: starts the office hidden (scripts\start-hidden.vbs -> start-office.ps1)
#   "Clickmarkers watchdog"  every 5 minutes: restarts it if it is down (scripts\watchdog.ps1)
# Both run as you, with normal rights, only while you are logged on. Each starts a small .vbs file in scripts\
# because that is the one built-in way to run PowerShell on Windows with no window flashing up; the .vbs runs
# the matching .ps1 with -ExecutionPolicy Bypass, which applies to that one process only, because the scripts
# are not signed. Read all four files before you run this. To remove both tasks: scripts\uninstall-autostart.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$user = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$a1 = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $root 'scripts\start-hidden.vbs') + '"') -WorkingDirectory $root
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $user
Register-ScheduledTask -TaskName 'Clickmarkers' -Action $a1 -Trigger $t1 -Principal $principal -Settings $settings -Description 'Starts Clickmarkers at logon, hidden.' -Force | Out-Null
$settings2 = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew
$a2 = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $root 'scripts\watchdog-hidden.vbs') + '"') -WorkingDirectory $root
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'Clickmarkers watchdog' -Action $a2 -Trigger $t2 -Principal $principal -Settings $settings2 -Description 'Restarts Clickmarkers if it stops answering, unless it was stopped on purpose.' -Force | Out-Null
"registered: Clickmarkers, Clickmarkers watchdog"
