param([switch]$SkipUpdate, [switch]$VerifySetupOnly)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location -LiteralPath $root
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$tools = Join-Path $root '_tools'
[IO.Directory]::CreateDirectory($tools) | Out-Null
$transcriptStarted = $false
try {
    Start-Transcript -LiteralPath (Join-Path $root 'launcher.log') -Append -ErrorAction SilentlyContinue | Out-Null
    $transcriptStarted = $true
    if (-not $SkipUpdate) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'apply_update.ps1') -CheckForUpdates -Root $root
        $updateCode = $LASTEXITCODE
        if ($updateCode -eq 10) {
            if ($transcriptStarted) { Stop-Transcript | Out-Null; $transcriptStarted = $false }
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'launch_app.ps1') -SkipUpdate
            exit $LASTEXITCODE
        }
        if ($updateCode -ne 0) { throw 'Update could not be verified. Run AutoCalculator.cmd again after checking the connection. See launcher.log.' }
    }
    Write-Host ('AutoCalculator ' + (Get-Content -LiteralPath (Join-Path $root 'version.txt') -Raw).Trim())
    Write-Host '[1/3] Checking Node.js...'
    $nodeDirectory = Join-Path $tools 'nodejs'
    if (Test-Path -LiteralPath (Join-Path $nodeDirectory 'node.exe')) { $env:PATH = "$nodeDirectory;$env:PATH" }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodeOK = $false
    if ($node) { $nodeVersion = & $node.Source -p 'process.versions.node'; $nodeOK = $LASTEXITCODE -eq 0 -and ([version]$nodeVersion).Major -ge 18 }
    if (-not $nodeOK) {
        $nodeZip = Join-Path $tools 'node-download.zip'
        Invoke-WebRequest 'https://nodejs.org/dist/v20.17.0/node-v20.17.0-win-x64.zip' -OutFile $nodeZip -UseBasicParsing
        Expand-Archive -LiteralPath $nodeZip -DestinationPath $tools -Force
        $unpacked = Join-Path $tools 'node-v20.17.0-win-x64'
        if (Test-Path -LiteralPath $nodeDirectory) { throw 'Existing portable Node.js is incomplete. Rename _tools/nodejs and retry.' }
        Move-Item -LiteralPath $unpacked -Destination $nodeDirectory
        Remove-Item -LiteralPath $nodeZip -Force
        $env:PATH = "$nodeDirectory;$env:PATH"
    }
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    Write-Host '[2/3] Checking Python packages...'
    $requirements = Join-Path $root 'requirements.txt'
    $check = "import importlib.metadata as m, pathlib, sys; r=[line.strip().split('==') for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if line.strip()]; assert all(m.version(k)==v for k,v in r)"
    $python = Join-Path $tools 'python/python.exe'
    $pythonOK = $false
    if (Test-Path -LiteralPath $python) {
        try { & $python -c $check $requirements 2>$null; $pythonOK = $LASTEXITCODE -eq 0 } catch { $pythonOK = $false }
    } else {
        $globalPython = Get-Command python.exe -ErrorAction SilentlyContinue
        if ($globalPython -and $globalPython.Source -notmatch 'WindowsApps') {
            try { & $globalPython.Source -c $check $requirements 2>$null; if ($LASTEXITCODE -eq 0) { $python = $globalPython.Source; $pythonOK = $true } } catch { $pythonOK = $false }
        }
    }
    if (-not $pythonOK) {
        $pythonDirectory = Join-Path $tools 'python'
        $python = Join-Path $pythonDirectory 'python.exe'
        if (-not (Test-Path -LiteralPath $python)) {
            $pythonZip = Join-Path $tools 'python-download.zip'
            Invoke-WebRequest 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip' -OutFile $pythonZip -UseBasicParsing
            Expand-Archive -LiteralPath $pythonZip -DestinationPath $pythonDirectory -Force
            Remove-Item -LiteralPath $pythonZip -Force
            foreach ($file in Get-ChildItem -LiteralPath $pythonDirectory -Filter '*._pth') {
                $content = [IO.File]::ReadAllText($file.FullName).Replace('#import site', 'import site')
                [IO.File]::WriteAllText($file.FullName, $content, [Text.UTF8Encoding]::new($false))
            }
        }
        if (-not (Test-Path -LiteralPath (Join-Path $pythonDirectory 'Scripts/pip.exe'))) {
            $getPip = Join-Path $tools 'get-pip.py'
            Invoke-WebRequest 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip -UseBasicParsing
            & $python $getPip --no-warn-script-location
            if ($LASTEXITCODE -ne 0) { throw 'Python pip setup failed.' }
        }
        & $python -m pip install --disable-pip-version-check --no-warn-script-location -r $requirements
        if ($LASTEXITCODE -ne 0) { throw 'Python package setup failed.' }
    }
    Write-Host '[3/3] Checking npm packages...'
    $lockHash = (Get-FileHash -LiteralPath (Join-Path $root 'package-lock.json') -Algorithm SHA256).Hash
    $dependencyStamp = Join-Path $tools 'npm-lock.sha256'
    $previousHash = ''
    if (Test-Path -LiteralPath $dependencyStamp) { $previousHash = (Get-Content -LiteralPath $dependencyStamp -Raw).Trim() }
    $npmOK = (Test-Path -LiteralPath (Join-Path $root 'node_modules/.bin/vite.cmd')) -and $previousHash -eq $lockHash
    if (-not $previousHash -and (Test-Path -LiteralPath (Join-Path $root 'node_modules/.bin/vite.cmd'))) {
        & $npm ls --depth=0 --silent *> $null
        $npmOK = $LASTEXITCODE -eq 0
    }
    if (-not $npmOK) {
        & $npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm package setup failed.' }
    }
    [IO.File]::WriteAllText($dependencyStamp, $lockHash)
    $env:PYTHON_EXE = $python
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $env:NUMBA_CACHE_DIR = Join-Path $tools 'numba-cache'
    if ($VerifySetupOnly) { Write-Host 'Runtime setup verified.'; exit 0 }
    # Stop only this installation's previous Vite server, never an unrelated app.
    foreach ($connection in @(Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
        if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        } else { throw 'Port 5173 is used by another program. Close the other program and retry.' }
    }
    Write-Host 'Starting http://localhost:5173'
    & $npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
    exit $LASTEXITCODE
} catch {
    Write-Host ('[ERROR] ' + $_.Exception.Message)
    exit 1
} finally {
    if ($transcriptStarted) { Stop-Transcript -ErrorAction SilentlyContinue | Out-Null }
}
