param([string]$PackagePath = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $PackagePath) { $PackagePath = Join-Path $root 'distribution/AutoCalculator-v2.0.11.zip' }
$version = (Get-Content -LiteralPath (Join-Path $root 'version.txt') -Raw).Trim()
$base = Join-Path $root ('analysis_results/update_tests/' + [guid]::NewGuid().ToString('N'))
$install = Join-Path $base "다른 폴더 이름 O'Hara!"
[IO.Directory]::CreateDirectory($install) | Out-Null
$updater = Join-Path $root 'apply_update.ps1'
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Invoke-Update([int]$Expected, [string]$Zip = $PackagePath) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updater -Root $install -LatestVer $version -PackagePath $Zip
    Assert ($LASTEXITCODE -eq $Expected) "Updater returned $LASTEXITCODE, expected $Expected"
}
function Verify([int]$Expected) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updater -Root $install -VerifyOnly
    Assert ($LASTEXITCODE -eq $Expected) "Verification returned $LASTEXITCODE, expected $Expected"
}
[IO.File]::WriteAllText((Join-Path $install 'user-measurements.txt'), 'preserve this data')
Invoke-Update 10
Verify 0
Assert ((Get-Content -LiteralPath (Join-Path $install 'user-measurements.txt') -Raw) -eq 'preserve this data') 'User data changed'
Write-Host 'PASS: installation in Korean/space/apostrophe/exclamation path; user data preserved'
$missing = Join-Path $install 'src/apps/ebsd/ResultsDashboard.tsx'
Remove-Item -LiteralPath $missing
Verify 1
Invoke-Update 10
Verify 0
Write-Host 'PASS: same-version missing file repair despite matching .update_ok'
# Corrupt a ZIP payload while leaving its manifest unchanged.
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$badZip = Join-Path $base 'corrupted.zip'
Copy-Item -LiteralPath $PackagePath -Destination $badZip
$zip = [IO.Compression.ZipFile]::Open($badZip, [IO.Compression.ZipArchiveMode]::Update)
try {
    $entry = $zip.Entries | Where-Object { $_.FullName.Replace('\','/') -eq 'src/main.tsx' } | Select-Object -First 1
    $name = $entry.FullName
    $entry.Delete()
    $changed = $zip.CreateEntry($name)
    $writer = [IO.StreamWriter]::new($changed.Open())
    $writer.Write('CORRUPTED DOWNLOAD')
    $writer.Dispose()
} finally { $zip.Dispose() }
Invoke-Update 1 $badZip
Verify 0
Write-Host 'PASS: corrupted release rejected before replacing installed files'
# Failure after earlier files were copied must restore their previous contents.
$index = Join-Path $install 'index.html'
[IO.File]::WriteAllText($index, 'previous local content for rollback test')
$before = (Get-FileHash -LiteralPath $index -Algorithm SHA256).Hash
$lockedFile = Join-Path $install 'python/run_ebsd.py'
$lock = [IO.File]::Open($lockedFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try { Invoke-Update 1 } finally { $lock.Dispose() }
Assert ((Get-FileHash -LiteralPath $index -Algorithm SHA256).Hash -eq $before) 'Failed update did not roll back an earlier replaced file'
Assert ((Get-Content -LiteralPath (Join-Path $install 'version.txt') -Raw).Trim() -eq $version) 'Version marker changed after failed update'
Write-Host 'PASS: copy failure rolls back earlier files'
Invoke-Update 10
Verify 0
# Unsafe paths in a package manifest must never escape the installation.
$unsafe = Join-Path $base 'unsafe.zip'
Copy-Item -LiteralPath $PackagePath -Destination $unsafe
$zip = [IO.Compression.ZipFile]::Open($unsafe, [IO.Compression.ZipArchiveMode]::Update)
try {
    $entry = $zip.GetEntry('update-manifest.json')
    $reader = [IO.StreamReader]::new($entry.Open()); $manifest = $reader.ReadToEnd() | ConvertFrom-Json; $reader.Dispose()
    $manifest.files[0].path = '../outside-install.txt'
    $entry.Delete(); $entry = $zip.CreateEntry('update-manifest.json')
    $writer = [IO.StreamWriter]::new($entry.Open()); $writer.Write(($manifest | ConvertTo-Json -Depth 6)); $writer.Dispose()
} finally { $zip.Dispose() }
Invoke-Update 1 $unsafe
Assert (-not (Test-Path -LiteralPath (Join-Path $base 'outside-install.txt'))) 'Unsafe package wrote outside installation'
Verify 0
Write-Host 'PASS: package path traversal rejected'
Write-Host 'All updater integration checks passed.'
exit 0
