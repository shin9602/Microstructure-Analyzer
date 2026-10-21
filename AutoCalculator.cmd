@echo off
setlocal DisableDelayedExpansion
set "AC_BOOTSTRAP=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:AC_BOOTSTRAP);$p=($t -split '(?m)^# POWERSHELL_PAYLOAD\r?$',2)[1]; & ([scriptblock]::Create($p))"
set "AC_EXIT=%errorlevel%"
if not "%AC_EXIT%"=="0" pause
exit /b %AC_EXIT%
# POWERSHELL_PAYLOAD
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$work = Join-Path ([IO.Path]::GetTempPath()) ('ac_boot_' + [guid]::NewGuid().ToString('N'))
try {
    $here = Split-Path -Parent $env:AC_BOOTSTRAP
    $root = Join-Path $env:LOCALAPPDATA 'AutoCalculator'
    if (Test-Path -LiteralPath (Join-Path $here 'START_HERE.bat')) { $root = $here }
    if ($env:AC_BOOTSTRAP_ROOT) { $root = $env:AC_BOOTSTRAP_ROOT }
    $root = [IO.Path]::GetFullPath($root).TrimEnd('\')
    $ready = $false
    $localUpdater = Join-Path $root 'apply_update.ps1'
    if ((Test-Path -LiteralPath $localUpdater) -and (Test-Path -LiteralPath (Join-Path $root 'update-manifest.json'))) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $localUpdater -CheckForUpdates -Root $root
        $ready = $LASTEXITCODE -in @(0, 10)
    }
    if (-not $ready) {
    $headers = @{ 'User-Agent' = 'AutoCalculator-Installer' }
    Write-Host 'AutoCalculator - checking GitHub for the latest version...'
    $release = Invoke-RestMethod 'https://api.github.com/repos/shin9602/Microstructure-Analyzer/releases/latest' -Headers $headers -TimeoutSec 20
    $asset = $release.assets | Where-Object { $_.name -eq ('AutoCalculator-' + $release.tag_name + '.zip') } | Select-Object -First 1
    if (-not $asset) { throw 'The latest release package is not available yet. Please retry shortly.' }
    [IO.Directory]::CreateDirectory($work) | Out-Null
    $zip = Join-Path $work 'app.zip'
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -Headers $headers -UseBasicParsing -TimeoutSec 120
    if ($asset.digest -match '^sha256:(.+)$') {
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $Matches[1]) { throw 'Download verification failed.' }
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $source = Join-Path $work 'source'
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $source)
    $updater = Join-Path $source 'apply_update.ps1'
    if (-not (Test-Path -LiteralPath $updater)) { throw 'The release is missing the installer. Download AutoCalculator-vX.X.X.zip from GitHub Releases.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updater -LatestVer $release.tag_name -Root $root -PackagePath $zip
    if ($LASTEXITCODE -notin @(0, 10)) { throw 'Installation failed; the previous installation was preserved.' }
    }
    Write-Host ('Ready: ' + $root)
    if ($env:AC_BOOTSTRAP_VERIFY_ONLY -eq '1') { exit 0 }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'launch_app.ps1') -SkipUpdate
    exit $LASTEXITCODE
} catch {
    Write-Host ('[ERROR] ' + $_.Exception.Message)
    Write-Host 'Check the Internet connection and run this file again.'
    exit 1
} finally {
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ([IO.Path]::GetFullPath($work).StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $work) -match '^ac_boot_[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
