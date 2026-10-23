param([switch]$SkipUpdate, [switch]$VerifySetupOnly, [switch]$ForcePortableRuntime)
$ErrorActionPreference = 'Stop'
function Get-FileDigest([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Get-RuntimeDownload([string]$Uri, [string]$Destination) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try { Invoke-WebRequest $Uri -OutFile $Destination -UseBasicParsing -TimeoutSec 180; return }
        catch { if ($attempt -eq 3) { throw }; Write-Host "Download interrupted; retrying ($attempt/3)..." }
    }
}
function Test-NodeRuntime([string]$Executable) {
    try {
        if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
        $value = & $Executable -p 'process.versions.node' 2>$null
        if ($LASTEXITCODE -ne 0 -or ([version]$value).Major -lt 18) { return $false }
        $npmPath = Join-Path (Split-Path -Parent $Executable) 'npm.cmd'
        if (-not (Test-Path -LiteralPath $npmPath)) { return $false }
        & $npmPath --version *> $null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}
function Test-PythonExecutable([string]$Executable) {
    try {
        & $Executable -c "import sys,struct; assert (3,10) <= sys.version_info[:2] < (3,13); assert struct.calcsize('P') == 8" *> $null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}
function Test-PythonRuntime([string]$Executable, [string]$Requirements) {
    if (-not (Test-PythonExecutable $Executable)) { return $false }
    try {
        $probe = "import importlib.metadata as m,pathlib,sys; r=[line.strip().split('==') for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if line.strip()]; assert all(m.version(k)==v for k,v in r); import numpy,scipy,matplotlib,PIL,pandas,skimage; from orix.quaternion import Orientation; from scipy.ndimage import median_filter"
        & $Executable -X utf8 -c $probe $Requirements *> $null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}
function Test-NpmRuntime([string]$Npm, [string]$Node, [string]$Project) {
    try {
        & $Npm ls --depth=0 --silent *> $null
        if ($LASTEXITCODE -ne 0) { return $false }
        $inspect = "const fs=require('fs'),p=require('path'),root=process.argv[1],lock=JSON.parse(fs.readFileSync(p.join(root,'package-lock.json'),'utf8'));for(const [key,item] of Object.entries(lock.packages||{})){if(!key||item.link)continue;const file=p.join(root,key,'package.json');if(!fs.existsSync(file)){if(item.optional)continue;throw Error('Missing package: '+key)}const installed=JSON.parse(fs.readFileSync(file,'utf8'));if(item.version&&installed.version!==item.version)throw Error('Package version mismatch: '+key)}"
        & $Node -e $inspect $Project *> $null
        if ($LASTEXITCODE -ne 0) { return $false }
        & $Node (Join-Path $Project 'node_modules/esbuild/bin/esbuild') --version *> $null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}
function Move-IncompleteRuntime([string]$Directory) {
    $resolved = [IO.Path]::GetFullPath($Directory)
    $allowed = [IO.Path]::GetFullPath($tools).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime repair path is outside this installation.' }
    if (Test-Path -LiteralPath $resolved) {
        $backup = $resolved + '.repair_' + [guid]::NewGuid().ToString('N')
        if (-not $backup.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid runtime backup path.' }
        Move-Item -LiteralPath $resolved -Destination $backup
        Write-Host ('Preserved incomplete runtime: ' + $backup)
    }
}
$root = $PSScriptRoot
Set-Location -LiteralPath $root
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Machine-specific runtimes must not be synchronized to other PCs by OneDrive.
$runtimeHash = [Security.Cryptography.SHA256]::Create()
try { $runtimeKey = ([BitConverter]::ToString($runtimeHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))).Replace('-', '').Substring(0, 16) } finally { $runtimeHash.Dispose() }
$runtimeBase = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AutoCalculator/runtimes'
$tools = Join-Path $runtimeBase $runtimeKey
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
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'AutoCalculator requires 64-bit Windows.' }
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $env:MPLBACKEND = 'Agg'
    $env:NUMBA_CACHE_DIR = Join-Path $tools 'numba-cache'
    Write-Host ('AutoCalculator ' + (Get-Content -LiteralPath (Join-Path $root 'version.txt') -Raw).Trim())
    Write-Host '[1/3] Checking Node.js...'
    $nodeDirectory = Join-Path $tools 'nodejs'
    $nodeExecutable = Join-Path $nodeDirectory 'node.exe'
    $nodeOK = Test-NodeRuntime $nodeExecutable
    if (-not $nodeOK -and -not $ForcePortableRuntime -and -not (Test-Path -LiteralPath $nodeDirectory)) {
        $globalNode = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($globalNode) { $nodeOK = Test-NodeRuntime $globalNode.Source; if ($nodeOK) { $nodeExecutable = $globalNode.Source } }
    }
    if (-not $nodeOK) {
        $nodeZip = Join-Path $tools 'node-download.zip'
        Get-RuntimeDownload 'https://nodejs.org/dist/v20.17.0/node-v20.17.0-win-x64.zip' $nodeZip
        $unpacked = Join-Path $tools 'node-v20.17.0-win-x64'
        Move-IncompleteRuntime $unpacked
        Expand-Archive -LiteralPath $nodeZip -DestinationPath $tools -Force
        if (-not (Test-NodeRuntime (Join-Path $unpacked 'node.exe'))) { throw 'Downloaded Node.js could not run. Check Windows security software and retry.' }
        Move-IncompleteRuntime $nodeDirectory
        Move-Item -LiteralPath $unpacked -Destination $nodeDirectory
        Remove-Item -LiteralPath $nodeZip -Force
        $nodeExecutable = Join-Path $nodeDirectory 'node.exe'
    }
    $env:PATH = "$(Split-Path -Parent $nodeExecutable);$env:PATH"
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    Write-Host '[2/3] Checking Python packages...'
    $requirements = Join-Path $root 'requirements.txt'
    $pythonDirectory = Join-Path $tools 'python'
    $python = Join-Path $pythonDirectory 'python.exe'
    $pythonOK = $false
    if (Test-Path -LiteralPath $python) {
        $pythonOK = Test-PythonRuntime $python $requirements
    } elseif (-not $ForcePortableRuntime) {
        $globalPython = Get-Command python.exe -ErrorAction SilentlyContinue
        if ($globalPython -and $globalPython.Source -notmatch 'WindowsApps' -and (Test-PythonRuntime $globalPython.Source $requirements)) {
            $python = $globalPython.Source; $pythonOK = $true
        }
    }
    if (-not $pythonOK) {
        $python = Join-Path $pythonDirectory 'python.exe'
        if (-not (Test-Path -LiteralPath $python) -or -not (Test-PythonExecutable $python)) {
            $pythonZip = Join-Path $tools 'python-download.zip'
            Get-RuntimeDownload 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip' $pythonZip
            Move-IncompleteRuntime $pythonDirectory
            Expand-Archive -LiteralPath $pythonZip -DestinationPath $pythonDirectory -Force
            Remove-Item -LiteralPath $pythonZip -Force
        }
        foreach ($file in Get-ChildItem -LiteralPath $pythonDirectory -Filter '*._pth') {
            $content = [IO.File]::ReadAllText($file.FullName).Replace('#import site', 'import site')
            [IO.File]::WriteAllText($file.FullName, $content, [Text.UTF8Encoding]::new($false))
        }
        $pipOK = $false
        try { & $python -m pip --version *> $null; $pipOK = $LASTEXITCODE -eq 0 } catch { $pipOK = $false }
        if (-not $pipOK) {
            $getPip = Join-Path $tools 'get-pip.py'
            Get-RuntimeDownload 'https://bootstrap.pypa.io/get-pip.py' $getPip
            & $python $getPip --no-warn-script-location
            if ($LASTEXITCODE -ne 0) { throw 'Python pip setup failed.' }
        }
        & $python -m pip install --disable-pip-version-check --no-warn-script-location --upgrade --force-reinstall -r $requirements
        if ($LASTEXITCODE -ne 0 -or -not (Test-PythonRuntime $python $requirements)) { throw 'Python package verification failed. Check the connection and launcher.log, then retry.' }
    }
    Write-Host '[3/3] Checking npm packages...'
    # A release-number change alone must not reinstall all npm packages.
    $dependencyScript = "const fs=require('fs'),crypto=require('crypto');const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));delete lock.version;if(lock.packages&&lock.packages[''])delete lock.packages[''].version;console.log(crypto.createHash('sha256').update(JSON.stringify(lock)).digest('hex'));"
    $lockHash = & node.exe -e $dependencyScript
    if ($LASTEXITCODE -ne 0 -or $lockHash -notmatch '^[a-f0-9]{64}$') { throw 'Cannot verify npm dependency metadata.' }
    $dependencyStamp = Join-Path $tools 'npm-dependencies.sha256'
    $previousHash = ''
    if (Test-Path -LiteralPath $dependencyStamp) { $previousHash = (Get-Content -LiteralPath $dependencyStamp -Raw).Trim() }
    $npmOK = (Test-Path -LiteralPath (Join-Path $root 'node_modules/.bin/vite.cmd')) -and $previousHash -eq $lockHash
    if ($npmOK -or (-not $previousHash -and (Test-Path -LiteralPath (Join-Path $root 'node_modules/.bin/vite.cmd')))) {
        $npmOK = Test-NpmRuntime $npm $nodeExecutable $root
    }
    if (-not $npmOK) {
        & $npm ci --include=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm package setup failed. Check the connection and launcher.log, then retry.' }
        if (-not (Test-NpmRuntime $npm $nodeExecutable $root)) { throw 'Installed npm dependencies or esbuild failed verification. Check Windows security software and launcher.log.' }
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
