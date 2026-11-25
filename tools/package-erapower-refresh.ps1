param([Parameter(Mandatory = $true)][string]$InputDirectory)
$ErrorActionPreference = 'Stop'
$sourceFolder = (Resolve-Path -LiteralPath $InputDirectory).Path
$manifestPath = Join-Path $sourceFolder 'full-sync-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$verificationPath = Join-Path $sourceFolder 'verification.json'
$verification = Get-Content -LiteralPath $verificationPath -Raw | ConvertFrom-Json
if ($verification.runId -ne $manifest.runId) { throw 'Verification belongs to a different refresh.' }
$files = @($manifest.datasets | ForEach-Object {
    if ([IO.Path]::GetFileName($_.file) -ne $_.file) { throw 'Unexpected export filename.' }
    $filePath = Join-Path $sourceFolder $_.file
    $hash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $_.sha256) { throw 'CSV checksum changed. Run verification again.' }
    $filePath
})
$files += $manifestPath, $verificationPath
foreach ($name in @('mongodb-current-result.json', 'scope_coverage.csv', 'repair_narrative_coverage.csv', 'unresolved_customer_profiles.csv', 'vehicle_context_unavailable.csv', 'workshop_status.manifest.json', 'loan_car_status.manifest.json', 'ancillary-status.json')) {
    $candidate = Join-Path $sourceFolder $name
    if (Test-Path -LiteralPath $candidate) { $files += $candidate }
}
$zipPath = $sourceFolder + '.zip'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew)
try {
    $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($filePath in $files) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $filePath, [IO.Path]::GetFileName($filePath), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
        $entry = $zip.CreateEntry('READ-ME.txt')
        $writer = [IO.StreamWriter]::new($entry.Open())
        try {
            $writer.WriteLine('Pentana eraPower CSV refresh')
            $writer.WriteLine('Snapshot started: ' + $manifest.startedAt)
            $writer.WriteLine('Verification result: ' + $verification.status)
            $writer.WriteLine('CSV files: ' + $manifest.datasets.Count)
            $writer.WriteLine('Coverage is the known linked customer and vehicle set, not the whole dealership master.')
            $writer.WriteLine('Each record retains its extraction timestamp when supplied. Source blanks remain blank.')
            $writer.WriteLine('See verification.json for missing records and MongoDB comparisons.')
            $writer.WriteLine('The voice agent still uses its legacy models. Consuming these refreshed eraPower collections requires an application adapter.')
            foreach ($limit in $manifest.limitations) { $writer.WriteLine($limit) }
            foreach ($issue in $verification.issues) { $writer.WriteLine($issue) }
            foreach ($failure in $manifest.failures) { $writer.WriteLine('Incomplete stage: ' + $failure.stage) }
        } finally { $writer.Dispose() }
    } finally { $zip.Dispose() }
} finally { $stream.Dispose() }
$check = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    if ($check.Entries.Count -ne $files.Count + 1) { throw 'ZIP entry count differs from expected files.' }
    foreach ($item in $manifest.datasets) {
        $entry = $check.GetEntry($item.file)
        if (-not $entry) { throw 'CSV missing from ZIP.' }
        $entryStream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = ([BitConverter]::ToString($sha.ComputeHash($entryStream))).Replace('-', '').ToLowerInvariant() }
        finally { $entryStream.Dispose(); $sha.Dispose() }
        if ($hash -ne $item.sha256) { throw 'ZIP CSV checksum mismatch.' }
    }
} finally { $check.Dispose() }
Write-Output ($zipPath)
