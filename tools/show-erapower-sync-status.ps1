param([switch]$Once)
$project = Split-Path -Parent $PSScriptRoot
$statusFile = Join-Path $project 'logs\erapower-sync\latest.json'
$lockFile = Join-Path $project 'logs\erapower-sync\running.lock'
$Host.UI.RawUI.WindowTitle = 'Purnell eraPower - Scheduler Status'
$zone = [TimeZoneInfo]::FindSystemTimeZoneById('AUS Eastern Standard Time')
function Format-SydneyTime($value) {
    if (-not $value) { return 'Unavailable' }
    if ($value -is [DateTimeOffset]) { $time = $value }
    elseif ($value -is [DateTime]) { $time = [DateTimeOffset]$value }
    else { $time = [DateTimeOffset]::Parse([string]$value, [Globalization.CultureInfo]::InvariantCulture) }
    return [TimeZoneInfo]::ConvertTime($time, $zone).ToString('dd MMM yyyy HH:mm:ss zzz')
}
do {
    if (-not $Once) { Clear-Host }
    Write-Host 'Purnell eraPower - Scheduler Status' -ForegroundColor Cyan
    Write-Host 'Refresh interval: every 3 hours'
    Write-Host 'Times shown in Australia/Sydney'
    Write-Host ''
    try {
        $info = Get-ScheduledTaskInfo -TaskName 'Purnell-eraPower-Sync-3h' -ErrorAction Stop
        $task = Get-ScheduledTask -TaskName 'Purnell-eraPower-Sync-3h' -ErrorAction Stop
        Write-Host ('Task state: ' + $task.State)
        Write-Host ('Last scheduled execution: ' + (Format-SydneyTime $info.LastRunTime))
        Write-Host ('Next execution: ' + (Format-SydneyTime $info.NextRunTime))
    } catch {
        Write-Host 'Task Scheduler timing unavailable. Showing saved run status.'
    }
    if (Test-Path -LiteralPath $lockFile) {
        Write-Host 'Sync is currently running' -ForegroundColor Yellow
        try {
            $progress = Get-Content -Raw -LiteralPath (Join-Path $project 'logs\erapower-sync\progress.json') -ErrorAction Stop | ConvertFrom-Json
            Write-Host ('Current stage: ' + $progress.stage)
        } catch {}
    }
    try {
        $status = Get-Content -Raw -LiteralPath $statusFile -ErrorAction Stop | ConvertFrom-Json
        $started = $status.startedAt
        if (-not $started) {
            $started = $status.runId -replace 'T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$', 'T$1:$2:$3.$4Z'
        }
        Write-Host ('Latest run started: ' + (Format-SydneyTime $started))
        if ($status.completedAt) { Write-Host ('Completed: ' + (Format-SydneyTime $status.completedAt)) }
        if ($status.success -or $status.partial) {
            $inserted = ($status.result.datasets | Measure-Object -Property new_rows -Sum).Sum
            $updated = ($status.result.datasets | Measure-Object -Property updated_rows -Sum).Sum
            $resultLabel = if ($status.partial) { 'PARTIAL' } else { 'SUCCESS' }
            Write-Host ('Result: ' + $resultLabel + ' - ' + $inserted + ' added, ' + $updated + ' updated') -ForegroundColor Green
            if ($status.partial) { Write-Host ('Incomplete stages: ' + $status.stage) -ForegroundColor Yellow }
        } else {
            Write-Host ('Result: FAILED during ' + $status.stage) -ForegroundColor Red
            Write-Host $status.message
        }
    } catch {
        Write-Host 'No readable run result yet.'
    }
    Write-Host ''
    Write-Host ('Updated: ' + (Format-SydneyTime ([DateTimeOffset]::Now)))
    if (-not $Once) { Write-Host 'Refreshing every 15 seconds. Close this window to stop viewing.'; Start-Sleep -Seconds 15 }
} while (-not $Once)
