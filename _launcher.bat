@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "ROOT=%~dp0"
set "TOOLS=%ROOT%_tools"
set "LOG=%ROOT%launcher.log"
set "REPO=shin9602/Microstructure-Analyzer"
set "VERSION_FILE=%ROOT%version.txt"

if not exist "%TOOLS%" mkdir "%TOOLS%"
echo. > "%LOG%"

echo.
echo  =============================
echo    AutoCalculator Launcher
echo  =============================
echo.

set "CURRENT_VER=none"
if exist "%VERSION_FILE%" set /p CURRENT_VER=<"%VERSION_FILE%"
echo  Current: %CURRENT_VER%

set "LATEST_VER="
powershell -NoProfile -NonInteractive -Command "try{$r=Invoke-RestMethod https://api.github.com/repos/shin9602/Microstructure-Analyzer/releases/latest -TimeoutSec 5;$r.tag_name}catch{}" > "%TEMP%\acver.txt" 2>nul
set /p LATEST_VER=<"%TEMP%\acver.txt"
del "%TEMP%\acver.txt" >nul 2>&1

if "!LATEST_VER!"=="" goto SKIP_UPDATE
if "!CURRENT_VER!"=="!LATEST_VER!" (echo  Latest version. ^(%CURRENT_VER%^) & goto SKIP_UPDATE)
echo  New version: !LATEST_VER!
set /p DO_UPDATE=  Update now? [Y/N]:
if /i not "!DO_UPDATE!"=="Y" goto SKIP_UPDATE

set "ZIPURL=https://github.com/%REPO%/releases/download/!LATEST_VER!/AutoCalculator-!LATEST_VER!.zip"
set "ZIPFILE=%ROOT%_update.zip"
set "TMPDIR=%ROOT%_update_temp"
echo  Downloading...
powershell -NoProfile -NonInteractive -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12';Invoke-WebRequest '!ZIPURL!' -OutFile '!ZIPFILE!' -UseBasicParsing"
if not exist "!ZIPFILE!" (echo  Download failed. & goto SKIP_UPDATE)
mkdir "!TMPDIR!" 2>nul
powershell -NoProfile -NonInteractive -Command "Expand-Archive '!ZIPFILE!' '!TMPDIR!' -Force"
robocopy "!TMPDIR!" "%ROOT%" /E /XD node_modules _tools _update_temp /XF launcher.log error.log /NFL /NDL /NJH /NJS >nul 2>&1
echo !LATEST_VER!> "%VERSION_FILE%"
del "!ZIPFILE!" >nul 2>&1
echo  Done. Restarting...
timeout /t 2 >nul
start "" "%~f0"
exit

:SKIP_UPDATE
echo.

echo [PRE] Clearing port 5173...
powershell -NoProfile -NonInteractive -Command "Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object{Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue}"

echo [1/5] Node.js...
set "NODE_LOCAL=%TOOLS%\nodejs\node.exe"
node -v >nul 2>&1
if !errorlevel! equ 0 goto STEP2
if exist "%NODE_LOCAL%" (set "PATH=%TOOLS%\nodejs;%PATH%" & goto STEP2)
echo  Downloading Node.js...
powershell -NoProfile -NonInteractive -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12';Invoke-WebRequest https://nodejs.org/dist/v20.17.0/node-v20.17.0-win-x64.zip -OutFile '%TOOLS%\node.zip' -UseBasicParsing"
if not exist "%TOOLS%\node.zip" (echo [ERROR] Node.js download failed. & goto END_PAUSE)
powershell -NoProfile -NonInteractive -Command "Expand-Archive '%TOOLS%\node.zip' '%TOOLS%' -Force"
del "%TOOLS%\node.zip" >nul 2>&1
move "%TOOLS%\node-v20.17.0-win-x64" "%TOOLS%\nodejs" >nul 2>&1
set "PATH=%TOOLS%\nodejs;%PATH%"
echo  [OK] Node.js ready.

:STEP2
echo [2/5] Python...
set "PY_EXE=%TOOLS%\python\python.exe"
python --version >nul 2>&1
if !errorlevel! equ 0 (set "PY_EXE=python" & goto STEP3)
if exist "%PY_EXE%" goto STEP3
echo  Downloading Python...
powershell -NoProfile -NonInteractive -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12';Invoke-WebRequest https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip -OutFile '%TOOLS%\python.zip' -UseBasicParsing"
if not exist "%TOOLS%\python.zip" (echo [ERROR] Python download failed. & goto END_PAUSE)
mkdir "%TOOLS%\python" 2>nul
powershell -NoProfile -NonInteractive -Command "Expand-Archive '%TOOLS%\python.zip' '%TOOLS%\python' -Force"
del "%TOOLS%\python.zip" >nul 2>&1
for /f "delims=" %%F in ('dir /b "%TOOLS%\python\python*._pth" 2^>nul') do powershell -NoProfile -Command "(Get-Content '%TOOLS%\python\%%F') -replace '#import site','import site' | Set-Content '%TOOLS%\python\%%F'"
if not exist "%TOOLS%\python\Scripts\pip.exe" (
    powershell -NoProfile -NonInteractive -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12';Invoke-WebRequest https://bootstrap.pypa.io/get-pip.py -OutFile '%TOOLS%\get-pip.py' -UseBasicParsing"
    "%PY_EXE%" "%TOOLS%\get-pip.py" --no-warn-script-location >nul 2>&1
)
echo  [OK] Python ready.

:STEP3
echo [3/5] Python packages...
"%PY_EXE%" -c "import orix,scipy,skimage,PIL,pandas,matplotlib" >nul 2>&1
if !errorlevel! equ 0 goto STEP4
echo  Installing packages (first time ~5 min)...
"%PY_EXE%" -m pip install --quiet --no-warn-script-location numpy scipy matplotlib Pillow pandas scikit-image orix
if !errorlevel! neq 0 (echo [ERROR] Package install failed. & goto END_PAUSE)
echo  [OK] Packages ready.

:STEP4
echo [4/5] npm packages...
if exist "%ROOT%node_modules" goto STEP5
echo  Installing npm packages...
call npm install
if !errorlevel! neq 0 (echo [ERROR] npm install failed. & goto END_PAUSE)

:STEP5
echo [5/5] PostCSS...
(echo // PostCSS handled inline in vite.config.ts & echo export default {}) > "%ROOT%postcss.config.js"

set "PYTHON_EXE=%PY_EXE%"
echo.
echo  Starting... ^(http://localhost:5173^)
echo.
call npm run dev

:END_PAUSE
echo.
echo Press any key to close...
pause >nul