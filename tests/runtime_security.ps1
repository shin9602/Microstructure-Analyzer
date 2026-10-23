$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'launch_app.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Launcher syntax error' }
foreach ($name in @('Get-FileDigest','Get-RuntimeDownload')) {
    $node = $ast.Find({param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq $name}, $true)
    . ([scriptblock]::Create($node.Extent.Text))
}
$testRoot = Join-Path $root ('analysis_results/checksum_tests/' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$fixture = Join-Path $testRoot 'source.bin'
$target = Join-Path $testRoot 'download.bin'
[IO.File]::WriteAllText($fixture, 'checksum fixture')
$script:downloadCalls = 0
function Invoke-WebRequest {
    param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec)
    $script:downloadCalls++
    Copy-Item -LiteralPath $fixture -Destination $OutFile -Force
}
Get-RuntimeDownload 'https://fixture.invalid/runtime.zip' $target (Get-FileDigest $fixture)
if ($script:downloadCalls -ne 1) { throw 'Valid hash was not accepted' }
$failed = $false
try { Get-RuntimeDownload 'https://fixture.invalid/runtime.zip' $target ('0' * 64) } catch { $failed = $true }
if (-not $failed -or $script:downloadCalls -ne 4) { throw 'Corrupt download was not rejected after retry' }
$failed = $false
try { Get-RuntimeDownload 'https://fixture.invalid/runtime.zip' $target '' } catch { $failed = $true }
if (-not $failed -or $script:downloadCalls -ne 4) { throw 'Missing hash was not rejected before download' }
Write-Host 'PASS: matching runtime checksum accepted; corrupt/missing checksum rejected; no downloaded code executed'
