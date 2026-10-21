param(
    [string]$LatestVer = '',
    [string]$Root = '',
    [string]$PackagePath = '',
    [switch]$CheckForUpdates,
    [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
function Get-FileDigest([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = $PSScriptRoot }
$Root = [IO.Path]::GetFullPath($Root.Trim().Replace('"', '').TrimEnd('\', '/'))
$repo = 'shin9602/Microstructure-Analyzer'
$headers = @{ 'User-Agent' = 'AutoCalculator-Updater' }
$work = $null
$changes = [Collections.Generic.List[object]]::new()
$committed = $false

function Resolve-Child([string]$Base, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)' -or $Relative.Contains(':')) { throw "Unsafe package path: $Relative" }
    $basePath = [IO.Path]::GetFullPath($Base).TrimEnd('\', '/')
    $target = [IO.Path]::GetFullPath((Join-Path $basePath $Relative))
    if (-not $target.StartsWith($basePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Path outside installation: $Relative" }
    return $target
}
function Test-Manifest([string]$Base, $Manifest) {
    if (-not $Manifest -or @($Manifest.files).Count -lt 20) { return $false }
    foreach ($entry in $Manifest.files) {
        $file = Resolve-Child $Base $entry.path
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
        if ((Get-Item -LiteralPath $file).Length -ne $entry.size) { return $false }
        if ((Get-FileDigest $file) -ne $entry.sha256) { return $false }
    }
    return $true
}
function Get-InstalledManifest {
    $file = Join-Path $Root 'update-manifest.json'
    if (Test-Path -LiteralPath $file) {
        try { return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
    }
    return $null
}
function Write-InstalledFile([string]$Relative, [string]$Source) {
    $target = Resolve-Child $Root $Relative
    $backup = Resolve-Child (Join-Path $work 'backup') $Relative
    $existed = Test-Path -LiteralPath $target -PathType Leaf
    if ($existed) {
        [IO.Directory]::CreateDirectory((Split-Path -Parent $backup)) | Out-Null
        Copy-Item -LiteralPath $target -Destination $backup -Force
    }
    $changes.Add([pscustomobject]@{ target = $target; backup = $backup; existed = $existed })
    [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $target -Force
}
try {
    $installed = Get-InstalledManifest
    if ($VerifyOnly) {
        if (-not (Test-Manifest $Root $installed)) { throw 'Installed program files failed integrity verification.' }
        Write-Host "  Installed files verified: $($installed.version)"
        exit 0
    }
    if ($CheckForUpdates) {
        try {
            $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers $headers -TimeoutSec 20
            $LatestVer = $release.tag_name
        } catch {
            if (Test-Manifest $Root $installed) {
                Write-Host '  Update check unavailable. Starting the verified installed version.'
                exit 0
            }
            throw 'Cannot check GitHub and installed files are not verified. Check the connection and run AutoCalculator.cmd again.'
        }
        if ($installed -and $installed.version -eq $LatestVer -and (Test-Manifest $Root $installed)) {
            Write-Host "  Already current; all program files verified: $LatestVer"
            exit 0
        }
        if ($installed -and ([version]$installed.version.TrimStart('v','V')) -gt ([version]$LatestVer.TrimStart('v','V'))) {
            if (Test-Manifest $Root $installed) { Write-Host '  Keeping the newer verified installed version.'; exit 0 }
            throw 'Installed development version is incomplete; automatic downgrade was skipped.'
        }
    }
    $LatestVer = $LatestVer.Trim().Trim('"')
    if ($LatestVer -notmatch '^v?\d+\.\d+\.\d+([-.][A-Za-z0-9.-]+)?$') { throw 'Missing or invalid release version.' }
    $work = Join-Path ([IO.Path]::GetTempPath()) ('ac_update_' + [guid]::NewGuid().ToString('N'))
    $extract = Join-Path $work 'extract'
    [IO.Directory]::CreateDirectory($extract) | Out-Null
    $zipPath = Join-Path $work 'update.zip'
    if ($PackagePath) {
        Copy-Item -LiteralPath $PackagePath -Destination $zipPath
    } else {
        $asset = $null
        if ($release) { $asset = $release.assets | Where-Object { $_.name -eq "AutoCalculator-$LatestVer.zip" } | Select-Object -First 1 }
        $download = "https://github.com/$repo/releases/download/$LatestVer/AutoCalculator-$LatestVer.zip"
        if ($asset) { $download = $asset.browser_download_url }
        Write-Host "  Downloading $LatestVer..."
        Invoke-WebRequest -Uri $download -OutFile $zipPath -UseBasicParsing -Headers $headers -TimeoutSec 120
        if ($asset -and $asset.digest -match '^sha256:(.+)$') {
            if ((Get-FileDigest $zipPath) -ne $Matches[1]) { throw 'Downloaded archive checksum mismatch.' }
        }
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extract)
    $source = $extract
    if (-not (Test-Path -LiteralPath (Join-Path $source 'version.txt'))) {
        $directories = @(Get-ChildItem -LiteralPath $extract -Directory)
        if ($directories.Count -eq 1) { $source = $directories[0].FullName }
    }
    $manifestFile = Join-Path $source 'update-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestFile)) { throw 'Release has no update manifest. Download the latest AutoCalculator.cmd installer.' }
    $manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.version -ne $LatestVer) { throw 'Release manifest version mismatch.' }
    $zipVersion = (Get-Content -LiteralPath (Join-Path $source 'version.txt') -Raw -Encoding UTF8).Trim()
    if ($zipVersion -ne $LatestVer) { throw 'Release version.txt mismatch.' }
    if (-not (Test-Manifest $source $manifest)) { throw 'Release is incomplete or corrupted. Nothing was installed.' }
    [IO.Directory]::CreateDirectory($Root) | Out-Null
    foreach ($entry in $manifest.files) {
        if ($entry.path -eq 'version.txt') { continue }
        Write-InstalledFile $entry.path (Resolve-Child $source $entry.path)
    }
    # Commit version/manifest only after every payload file has been replaced.
    Write-InstalledFile 'version.txt' (Join-Path $source 'version.txt')
    if (-not (Test-Manifest $Root $manifest)) { throw 'Installed file verification failed.' }
    Write-InstalledFile 'update-manifest.json' $manifestFile
    $stamp = Join-Path $work 'stamp.txt'
    [IO.File]::WriteAllText($stamp, $LatestVer, [Text.UTF8Encoding]::new($false))
    Write-InstalledFile '.update_ok' $stamp
    $committed = $true
    Write-Host "  Installed and verified $(@($manifest.files).Count) files: $LatestVer"
    exit 10
} catch {
    Write-Host ('  [ERROR] ' + $_.Exception.Message)
    $rollbackFailed = $false
    for ($index = $changes.Count - 1; $index -ge 0; $index--) {
        $change = $changes[$index]
        try {
            if ($change.existed) {
                $unchanged = (Test-Path -LiteralPath $change.target) -and ((Get-FileDigest $change.target) -eq (Get-FileDigest $change.backup))
                if (-not $unchanged) { Copy-Item -LiteralPath $change.backup -Destination $change.target -Force }
            }
            elseif (Test-Path -LiteralPath $change.target) { Remove-Item -LiteralPath $change.target -Force }
        } catch { $rollbackFailed = $true; Write-Host ('  Rollback error: ' + $_.Exception.Message) }
    }
    if ($rollbackFailed) { Write-Host "  Recovery copies retained at: $work"; $work = $null }
    exit 1
} finally {
    if ($work -and (Test-Path -LiteralPath $work)) {
        # $work is a GUID-named directory created directly inside the system temp folder.
        $safeTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if ([IO.Path]::GetFullPath($work).StartsWith($safeTemp, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $work) -match '^ac_update_[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
