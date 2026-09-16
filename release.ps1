param(
    [string]$Body = "",
    [switch]$SkipDownloadTest
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ver = (Get-Content "$root\version.txt" -Raw).Trim()
$tmpDir = Join-Path $env:TEMP "ac_build_tmp"
$zipPath = Join-Path $env:TEMP "AutoCalculator-$ver.zip"
$tokenPath = Join-Path $root "token.txt"
$repo = "shin9602/Microstructure-Analyzer"

if (-not (Test-Path $tokenPath)) {
    Write-Error "token.txt not found at $tokenPath"
}

if ($Body -eq "") {
    $Body = "AutoCalculator $ver"
}

$token = [System.IO.File]::ReadAllText($tokenPath).Trim()
$headers = @{ Authorization = "token $token"; "Content-Type" = "application/json" }

Write-Output "=== AutoCalculator Release: $ver ==="

# 1) Create GitHub release
$releaseBody = @{
    tag_name = $ver
    name = $ver
    body = $Body
    draft = $false
    prerelease = $false
} | ConvertTo-Json

$r = Invoke-RestMethod "https://api.github.com/repos/$repo/releases" -Method Post -Headers $headers -Body $releaseBody
$releaseId = $r.id
Write-Output "Release created: $($r.tag_name) (id: $releaseId)"

# 2) robocopy to temp (OneDrive symlink workaround)
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $tmpDir | Out-Null
robocopy $root $tmpDir /E /XD node_modules _tools _update_temp .git .claude dist dist-ssr __pycache__ .venv venv env .temp_ebsd /XF "*.log" "token.txt" "*.zip" "*.7z" "*.rar" "pdf_text.md" "ang_header.txt" "temp_header.txt" /NFL /NDL /NJH /NJS | Out-Null

# 3) Build ZIP (foreach loop required)
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
# Stamp timestamps so older START_HERE.bat robocopy (skip dest-newer) still overwrites.
Get-ChildItem -Path $tmpDir -Recurse -File | ForEach-Object { $_.LastWriteTime = (Get-Date).AddMinutes(10) }

$files = Get-ChildItem -Path $tmpDir -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($tmpDir.Length + 1)
    if ($rel -like "python\*.png") { return $false }
    if ($rel -like "python\*.txt") { return $false }
    if ($_.Name -like "vite.config.ts.timestamp-*") { return $false }
    if ($_.Name -eq ".update_ok") { return $false }
    if ($_.Name -like "_tmp_*.ps1") { return $false }
    return $true
}
foreach ($file in $files) {
    $rel = $file.FullName.Substring($tmpDir.Length + 1)
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $rel) | Out-Null
}
$zip.Dispose()

# 4) Upload ZIP
$headers2 = @{ Authorization = "token $token"; "Content-Type" = "application/zip" }
$uploadUrl = "https://uploads.github.com/repos/$repo/releases/$releaseId/assets?name=AutoCalculator-$ver.zip"
$bytes = [System.IO.File]::ReadAllBytes($zipPath)
$r2 = Invoke-RestMethod $uploadUrl -Method Post -Headers $headers2 -Body $bytes
Write-Output "Upload complete: $($r2.name) ($($r2.size) bytes)"

# 5) Verify ZIP contents
$excludeDirs2 = @("node_modules","_tools","_update_temp",".git",".claude","dist","dist-ssr","__pycache__",".venv","venv","env",".temp_ebsd")
$excludeFiles2 = @("*.log","token.txt","*.zip","*.7z","*.rar","pdf_text.md","ang_header.txt","temp_header.txt")
$actualFiles = Get-ChildItem -Path $root -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    $parts = $rel -split '\\'
    foreach ($d in $excludeDirs2) { if ($parts -contains $d) { return $false } }
    foreach ($p in $excludeFiles2) { if ($_.Name -like $p) { return $false } }
    if ($rel -like "python\*.png") { return $false }
    if ($rel -like "python\*.txt") { return $false }
    if ($_.Name -like "vite.config.ts.timestamp-*") { return $false }
    if ($_.Name -eq ".update_ok") { return $false }
    if ($_.Name -like "_tmp_*.ps1") { return $false }
    return $true
} | ForEach-Object { $_.FullName.Substring($root.Length + 1) -replace '\\','/' } | Sort-Object

$zipCheck = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$zipFiles = $zipCheck.Entries | ForEach-Object { $_.FullName -replace '\\','/' } | Sort-Object
$zipCheck.Dispose()

$missing = $actualFiles | Where-Object { $zipFiles -notcontains $_ }
if ($missing) {
    Write-Output "[ERROR] Missing files in ZIP — aborting:"
    $missing | ForEach-Object { Write-Output "  MISSING: $_" }
    Remove-Item $zipPath -Force
    Remove-Item $tmpDir -Recurse -Force
    exit 1
}
Write-Output "[OK] ZIP verified — $($actualFiles.Count) files"

# 6) Cleanup temp
Remove-Item $zipPath -Force
Remove-Item $tmpDir -Recurse -Force

# 7) Verify latest release
Start-Sleep -Seconds 2
$latest = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
Write-Output "Latest release: $($latest.tag_name)"
if ($latest.tag_name -ne $ver) {
    Write-Output "[WARN] /releases/latest returned $($latest.tag_name), expected $ver"
}

# 8) Download test
if (-not $SkipDownloadTest) {
    $zipUrl = "https://github.com/$repo/releases/download/$ver/AutoCalculator-$ver.zip"
    $outFile = Join-Path $env:TEMP "test_download_$ver.zip"
    [Net.ServicePointManager]::SecurityProtocol = 'Tls12'
    Invoke-WebRequest $zipUrl -OutFile $outFile -UseBasicParsing
    $size = (Get-Item $outFile).Length
    Write-Output "Download test: $size bytes"
    $z = [System.IO.Compression.ZipFile]::OpenRead($outFile)
    Write-Output "ZIP entries: $($z.Entries.Count)"
    $vf = $z.Entries | Where-Object { $_.FullName -eq "version.txt" }
    $versionInZip = [System.IO.StreamReader]::new($vf.Open()).ReadToEnd()
    Write-Output "version.txt in ZIP: $versionInZip"
    $z.Dispose()
    Remove-Item $outFile -Force
    if ($versionInZip.Trim() -ne $ver) {
        Write-Error "version.txt mismatch in downloaded ZIP"
    }
}

Write-Output "=== Release $ver complete ==="
