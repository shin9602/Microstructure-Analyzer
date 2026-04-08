@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "ROOT=%~dp0"
set "TOOLS=%ROOT%_tools"
set "LOG=%ROOT%launcher.log"

if not exist "%TOOLS%" mkdir "%TOOLS%"

echo. > "%LOG%"
echo AutoCalculator Launcher Log >> "%LOG%"
echo ============================ >> "%LOG%"

echo.
echo  =============================
echo    AutoCalculator Launcher
echo  =============================
echo.

:: ====================================================
:: PRE: Kill port 5173 and clear Vite cache
:: ====================================================
echo [PRE] Clearing environment...
echo [PRE] Clearing environment... >> "%LOG%"

powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

if exist "%ROOT%node_modules\.vite" (
    rd /s /q "%ROOT%node_modules\.vite" >nul 2>&1
    echo     Vite cache cleared. >> "%LOG%"
)
echo [PRE] Done.
echo.

:: ====================================================
:: STEP 1: Node.js
:: ====================================================
echo [1/5] Checking Node.js...
echo [1/5] Node.js check >> "%LOG%"

set "NODE_LOCAL=%TOOLS%\nodejs\node.exe"

node -v >nul 2>&1
if !errorlevel! equ 0 (
    echo     [OK] System Node.js found.
    echo     System Node.js found. >> "%LOG%"
    goto STEP2
)

if exist "%NODE_LOCAL%" (
    echo     [OK] Local Node.js found.
    echo     Local Node.js found. >> "%LOG%"
    set "PATH=%TOOLS%\nodejs;%TOOLS%\nodejs\node_modules\.bin;%PATH%"
    goto STEP2
)

echo     [INFO] Downloading Node.js (~30MB)...
echo     Downloading Node.js... >> "%LOG%"
set "NVER=v20.17.0"
set "NURL=https://nodejs.org/dist/%NVER%/node-%NVER%-win-x64.zip"
set "NZIP=%TOOLS%\node.zip"
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri '%NURL%' -OutFile '%NZIP%' -UseBasicParsing"
if not exist "%NZIP%" (
    echo.
    echo [ERROR] Node.js download failed. Check internet.
    echo [ERROR] Node.js download failed. >> "%LOG%"
    goto END_PAUSE
)
powershell -NoProfile -Command "Expand-Archive -Path '%NZIP%' -DestinationPath '%TOOLS%' -Force"
del "%NZIP%" >nul 2>&1
move "%TOOLS%\node-%NVER%-win-x64" "%TOOLS%\nodejs" >nul 2>&1
set "PATH=%TOOLS%\nodejs;%TOOLS%\nodejs\node_modules\.bin;%PATH%"
echo     [OK] Node.js installed.
echo     Node.js installed OK. >> "%LOG%"

:STEP2
echo.
:: ====================================================
:: STEP 2: Python
:: ====================================================
echo [2/5] Checking Python...
echo [2/5] Python check >> "%LOG%"

set "PY_EXE=%TOOLS%\python\python.exe"

python --version >nul 2>&1
if !errorlevel! equ 0 (
    set "PY_EXE=python"
    echo     [OK] System Python found.
    echo     System Python found. >> "%LOG%"
    goto STEP3
)

if exist "%PY_EXE%" (
    echo     [OK] Local Python found.
    echo     Local Python found. >> "%LOG%"
    goto STEP3
)

echo     [INFO] Downloading Python (~25MB)...
echo     Downloading Python... >> "%LOG%"
set "PYVER=3.11.9"
set "PYURL=https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-embed-amd64.zip"
set "PYZIP=%TOOLS%\python.zip"
set "PYDIR=%TOOLS%\python"
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri '%PYURL%' -OutFile '%PYZIP%' -UseBasicParsing"
if not exist "%PYZIP%" (
    echo.
    echo [ERROR] Python download failed. Check internet.
    echo [ERROR] Python download failed. >> "%LOG%"
    goto END_PAUSE
)
if not exist "%PYDIR%" mkdir "%PYDIR%"
powershell -NoProfile -Command "Expand-Archive -Path '%PYZIP%' -DestinationPath '%PYDIR%' -Force"
del "%PYZIP%" >nul 2>&1

for /f "delims=" %%F in ('dir /b "%PYDIR%\python*._pth" 2^>nul') do (
    powershell -NoProfile -Command "(Get-Content '%PYDIR%\%%F') -replace '#import site','import site' | Set-Content '%PYDIR%\%%F'"
)

if not exist "%PYDIR%\Scripts\pip.exe" (
    echo     Installing pip...
    echo     Installing pip... >> "%LOG%"
    powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile '%TOOLS%\get-pip.py' -UseBasicParsing"
    "%PY_EXE%" "%TOOLS%\get-pip.py" --no-warn-script-location >nul 2>&1
)
echo     [OK] Python installed.
echo     Python installed OK. >> "%LOG%"

:STEP3
echo.
:: ====================================================
:: STEP 3: Python packages
:: ====================================================
echo [3/5] Checking Python packages...
echo [3/5] Python packages >> "%LOG%"

"%PY_EXE%" -c "import orix, scipy, skimage, PIL, pandas, matplotlib" >nul 2>&1
if !errorlevel! equ 0 (
    echo     [OK] All packages ready.
    echo     Already installed. >> "%LOG%"
    goto STEP4
)

echo     [INFO] Installing packages (first time, ~5 min)...
"%PY_EXE%" -m pip install --quiet --no-warn-script-location numpy scipy matplotlib Pillow pandas scikit-image orix
if !errorlevel! neq 0 (
    echo [ERROR] Python package install failed!
    echo [ERROR] Python package install failed. >> "%LOG%"
    goto END_PAUSE
)
echo     [OK] Packages installed.
echo     Python packages OK. >> "%LOG%"

:STEP4
echo.
:: ====================================================
:: STEP 4: npm packages
:: ====================================================
echo [4/5] Checking npm packages...
echo [4/5] npm packages >> "%LOG%"

if exist "%ROOT%node_modules" goto NPM_READY
echo     [INFO] Installing npm packages (first time)...
echo     Running npm install... >> "%LOG%"
call npm install
if !errorlevel! neq 0 (
    echo [ERROR] npm install failed!
    echo [ERROR] npm install failed. >> "%LOG%"
    goto END_PAUSE
)
:NPM_READY
echo     [OK] npm packages ready.
echo     npm OK. >> "%LOG%"

:: ====================================================
:: STEP 5: PostCSS
:: ====================================================
echo.
echo [5/5] PostCSS config...
echo [5/5] PostCSS >> "%LOG%"
(
echo // PostCSS handled inline in vite.config.ts
echo export default {}
) > "%ROOT%postcss.config.js"
echo     [OK] PostCSS ready.
echo     PostCSS OK. >> "%LOG%"

:: ====================================================
:: LAUNCH
:: ====================================================
set "PYTHON_EXE=%PY_EXE%"

echo.
echo  ==========================================
echo    Starting AutoCalculator...
echo    Browser will open automatically.
echo    URL: http://localhost:5173
echo    Close this window to stop the app.
echo  ==========================================
echo.
echo Launching... >> "%LOG%"

call npm run dev
set "DEV_ERR=!errorlevel!"

echo.
echo [Done] npm run dev exited with code: !DEV_ERR!
echo.
if exist "%ROOT%error.log" (
    echo --- error.log ---
    type "%ROOT%error.log"
    echo.
)

:END_PAUSE
echo.
echo Press any key to close...
pause >nul
