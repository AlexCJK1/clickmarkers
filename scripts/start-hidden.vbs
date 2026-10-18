' Runs scripts\start-office.ps1 (the keep-alive loop) with no window. Registered as the "Nightdesk" logon task
' and used by the watchdog.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\scripts\start-office.ps1""", 0, False
