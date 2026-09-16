param(
    [Parameter(Mandatory = $true)][string]$LatestVer,
    [Parameter(Mandatory = $true)][string]$Root
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$LatestVer = $LatestVer.Trim()
$Root = [System.IO.Path]::GetFullPath($Root.Trim().TrimEnd('\', '/'))
$repo = 'shin9602/Microstructure-Analyzer'
$zipUrl = "https://github.com/$repo/releases/download/$LatestVer/AutoCalculator-$LatestVer.zip"
$work = Join-Path $env:TEMP ("ac_update_" + [guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $work 'update.zip'
$extract = Join-Path $work 'extract'

New-Item -ItemType Directory -Path $extract -Force | Out-Null

try {
    Write-Host "  Downloading $LatestVer (local temp, not OneDrive)..."
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    $size = (Get-Item -LiteralPath $zipPath).Length
    if ($size -lt 10000) {
        throw "Downloaded ZIP is too small ($size bytes). Update did not actually download."
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extract)

    $source = $extract
    $dirs = @(Get-ChildItem -LiteralPath $extract -Directory)
    $files = @(Get-ChildItem -LiteralPath $extract -File)
    if ($dirs.Count -eq 1 -and $files.Count -eq 0) {
        $source = $dirs[0].FullName
    }

    $verFile = Join-Path $source 'version.txt'
    if (-not (Test-Path -LiteralPath $verFile)) {
        throw 'version.txt is missing inside the ZIP.'
    }
    $verInZip = (Get-Content -LiteralPath $verFile -Raw).Trim()
    if ($verInZip -ne $LatestVer) {
        throw "ZIP version.txt is '$verInZip' but expected '$LatestVer'."
    }

    $excludeDirs = @(
        'node_modules', '_tools', '_update_temp', '.git', '.claude',
        'dist', 'dist-ssr', '__pycache__', '.venv', 'venv', 'env', '.temp_ebsd'
    )
    $excludeNames = @('token.txt', 'launcher.log', 'error.log', '.update_ok')

    $copied = 0
    Get-ChildItem -LiteralPath $source -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($source.Length).TrimStart('\', '/')
        $parts = $rel -split '[\\/]'
        foreach ($d in $excludeDirs) {
            if ($parts -contains $d) { return }
        }
        if ($excludeNames -contains $_.Name) { return }
        if ($rel -like 'python\*.png' -or $rel -like 'python/*.png') { return }
        if ($rel -like 'python\*.txt' -or $rel -like 'python/*.txt') { return }
        if ($_.Name -like 'vite.config.ts.timestamp-*') { return }

        $dest = Join-Path $Root $rel
        $destDir = Split-Path -Parent $dest
        if (-not (Test-Path -LiteralPath $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
        $copied++
    }

    if ($copied -lt 20) {
        throw "Only $copied files were copied. Update aborted."
    }

    $installed = (Get-Content -LiteralPath (Join-Path $Root 'version.txt') -Raw).Trim()
    if ($installed -ne $LatestVer) {
        throw "Copy finished but version.txt is '$installed', expected '$LatestVer'."
    }

    $stamp = Join-Path $Root '.update_ok'
    Set-Content -LiteralPath $stamp -Value $LatestVer -NoNewline
    Write-Host "  Applied $copied files -> $installed"
    exit 0
}
catch {
    Write-Host ("  [ERROR] " + $_.Exception.Message)
    exit 1
}
finally {
    if (Test-Path -LiteralPath $work) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
