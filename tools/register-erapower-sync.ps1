$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot 'run-erapower-sync.mjs'
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $runner + '"') -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddHours(3) -RepetitionInterval (New-TimeSpan -Hours 3)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 175) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Purnell-eraPower-Sync-3h' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Refresh accessible linked eraPower records and update MongoDB current collections with version history.' -Force | Out-Null
Get-ScheduledTaskInfo -TaskName 'Purnell-eraPower-Sync-3h' | Select-Object NextRunTime, LastTaskResult
