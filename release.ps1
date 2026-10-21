param([string]$Body = '', [switch]$BuildOnly, [switch]$SkipDownloadTest)
$ErrorActionPreference = 'Stop'
function Get-FileDigest([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'version.txt') -Raw).Trim()
$repo = 'shin9602/Microstructure-Analyzer'
$output = Join-Path $root 'distribution'
[IO.Directory]::CreateDirectory($output) | Out-Null
$zipPath = Join-Path $output "AutoCalculator-$version.zip"
$work = Join-Path ([IO.Path]::GetTempPath()) ('ac_release_' + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $work 'payload'
[IO.Directory]::CreateDirectory($stage) | Out-Null
try {
    $tracked = @(& git -C $root ls-files)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot list version-controlled release files.' }
    $runtime = @($tracked | Where-Object {
        (($_ -match '^(src/|public/|python/)') -or ($_ -match '^(AutoCalculator\.cmd|START_HERE\.bat|apply_update\.ps1|launch_app\.ps1|requirements\.txt|version\.txt|package(-lock)?\.json|index\.html|vite\.config\.ts|tsconfig.*\.json|tailwind\.config\.js|postcss\.config\.(js|cjs)|eslint\.config\.js|README\.md|LICENSE)$')) -and
        $_ -notmatch '(\.bak$|/test_[^/]+\.py$|implementation_plan\.md$|\.(osc|ang|zip|log)$)'
    })
    foreach ($required in @('AutoCalculator.cmd','START_HERE.bat','apply_update.ps1','launch_app.ps1','requirements.txt','python/run_ebsd.py','python/ebsd_phases.py','python/ebsd_exports.py','python/ebsd_regions.py','python/prepare_ebsd.py','src/apps/ebsd/EtaMaskEditor.tsx','src/apps/ebsd/etaSelection.ts','src/apps/ebsd/phaseMetadata.ts','src/apps/ebsd/ResultsDashboard.tsx')) {
        if ($runtime -notcontains $required) { throw "Required release file is not staged/tracked: $required" }
    }
    # Copy only tracked runtime files. No measurement files, credentials, caches,
    # node_modules, installed Python or generated reports can enter the package.
    foreach ($group in ($runtime | Group-Object { Split-Path -Parent $_ })) {
        $relativeDirectory = $group.Name
        $from = $root; $to = $stage
        if ($relativeDirectory) { $from = Join-Path $root $relativeDirectory; $to = Join-Path $stage $relativeDirectory }
        [IO.Directory]::CreateDirectory($to) | Out-Null
        $names = @($group.Group | ForEach-Object { Split-Path -Leaf $_ })
        & robocopy $from $to @names /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -gt 7) { throw "Release staging failed: $relativeDirectory" }
    }
    $entries = @()
    foreach ($relative in $runtime) {
        $source = Join-Path $root $relative
        $copied = Join-Path $stage $relative
        $hash = (Get-FileDigest $source)
        if ((Get-FileDigest $copied) -ne $hash) { throw "Staged file does not match source: $relative" }
        $entries += [pscustomobject]@{ path = $relative.Replace('\','/'); size = (Get-Item -LiteralPath $copied).Length; sha256 = $hash }
        (Get-Item -LiteralPath $copied).LastWriteTime = (Get-Date).AddMinutes(10)
    }
    $manifest = [ordered]@{ schema = 1; version = $version; commit = (& git -C $root rev-parse HEAD); files = $entries }
    [IO.File]::WriteAllText((Join-Path $stage 'update-manifest.json'), ($manifest | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
    $installer = Join-Path $output 'AutoCalculator.cmd'
    Copy-Item -LiteralPath (Join-Path $root 'AutoCalculator.cmd') -Destination $installer -Force
    $zipHash = (Get-FileDigest $zipPath).ToLowerInvariant()
    [IO.File]::WriteAllText(($zipPath + '.sha256'), ($zipHash + '  ' + [IO.Path]::GetFileName($zipPath)), [Text.UTF8Encoding]::new($false))
    Write-Host "Built $version : $($entries.Count) verified runtime files, $((Get-Item -LiteralPath $zipPath).Length) bytes"
    Write-Host "Single-file installer: $installer ($((Get-Item -LiteralPath $installer).Length) bytes)"
    if ($BuildOnly) { exit 0 }
    $tokenFile = Join-Path $root 'token.txt'
    if ($env:GITHUB_TOKEN) { $token = $env:GITHUB_TOKEN } elseif (Test-Path -LiteralPath $tokenFile) { $token = [IO.File]::ReadAllText($tokenFile).Trim() } else { throw 'GitHub authentication is unavailable.' }
    $headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'AutoCalculator-Release' }
    if (-not $Body) { $Body = "AutoCalculator $version" }
    $data = @{ tag_name=$version; target_commitish=(& git -C $root rev-parse HEAD); name=$version; body=$Body; draft=$true; prerelease=$false } | ConvertTo-Json
    $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases" -Method Post -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($data))
    foreach ($file in @($zipPath, $installer, ($zipPath + '.sha256'))) {
        $name = [Uri]::EscapeDataString([IO.Path]::GetFileName($file))
        $asset = Invoke-RestMethod "https://uploads.github.com/repos/$repo/releases/$($release.id)/assets?name=$name" -Method Post -Headers $headers -ContentType 'application/octet-stream' -InFile $file
        if ($asset.size -ne (Get-Item -LiteralPath $file).Length) { throw "Uploaded asset size mismatch: $file" }
        Write-Host "Uploaded $($asset.name)"
    }
    $publish = @{ draft=$false; make_latest='true' } | ConvertTo-Json
    $published = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/$($release.id)" -Method Patch -Headers $headers -ContentType 'application/json' -Body $publish
    if (-not $SkipDownloadTest) {
        $download = Join-Path $work 'download-test.zip'
        Invoke-WebRequest "https://github.com/$repo/releases/download/$version/AutoCalculator-$version.zip" -OutFile $download -UseBasicParsing -TimeoutSec 120
        if ((Get-FileDigest $download).ToLowerInvariant() -ne $zipHash) { throw 'Published ZIP download checksum mismatch.' }
        $latest = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest?verification=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -Headers @{ 'User-Agent'='AutoCalculator-Release-Test' }
        if ($latest.tag_name -ne $version) { throw "Latest release is $($latest.tag_name), expected $version" }
        Write-Host 'Published ZIP download and latest-release endpoint verified.'
    }
    Write-Host "Release complete: $($published.html_url)"
} finally {
    $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ([IO.Path]::GetFullPath($work).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $work) -match '^ac_release_[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
