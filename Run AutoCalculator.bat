@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "ROOT=%~dp0"
set "TOOLS=%ROOT%_tools"
set "LOG=%ROOT%launcher.log"
set "GITHUB_REPO=shin9602/Microstructure-Analyzer"
set "VERSION_FILE=%ROOT%version.txt"

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
:: 업데이트 체크
:: ====================================================
set "CURRENT_VER=없음"
if exist "%VERSION_FILE%" set /p CURRENT_VER=<"%VERSION_FILE%"

echo  버전 확인 중...
powershell -NoProfile -Command ^
    "[Net.ServicePointManager]::SecurityProtocol='Tls12';" ^
    "try { $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/%GITHUB_REPO%/releases/latest' -UseBasicParsing -TimeoutSec 5; Write-Output $r.tag_name } catch { Write-Output '' }" ^
    > "%TEMP%\latest_ver.txt" 2>nul
set /p LATEST_VER=<"%TEMP%\latest_ver.txt"
del "%TEMP%\latest_ver.txt" >nul 2>&1

if "%LATEST_VER%"=="" (
    echo  [업데이트] 확인 실패 ^(인터넷 연결 확인^)
    echo  현재 버전: %CURRENT_VER%
) else if "%CURRENT_VER%"=="%LATEST_VER%" (
    echo  [업데이트] 최신 버전입니다 ^(%CURRENT_VER%^)
) else (
    echo.
    echo  *** 새 버전이 있습니다! ***
    echo  현재: %CURRENT_VER%  →  최신: %LATEST_VER%
    echo.
    echo  지금 업데이트하시겠습니까?
    echo  [Y] 업데이트 후 실행   [N] 그냥 실행
    echo.
    set /p DO_UPDATE= 선택 (Y/N):
    if /i "!DO_UPDATE!"=="Y" (
        echo.
        echo  업데이트 중...
        set "ZIP_FILE=%ROOT%_update.zip"
        set "TEMP_DIR=%ROOT%_update_temp"
        set "DOWNLOAD_URL=https://github.com/%GITHUB_REPO%/releases/download/%LATEST_VER%/AutoCalculator-%LATEST_VER%.zip"
        powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri '!DOWNLOAD_URL!' -OutFile '!ZIP_FILE!' -UseBasicParsing"
        if exist "!ZIP_FILE!" (
            if exist "!TEMP_DIR!" rd /s /q "!TEMP_DIR!"
            mkdir "!TEMP_DIR!"
            powershell -NoProfile -Command "Expand-Archive -Path '!ZIP_FILE!' -DestinationPath '!TEMP_DIR!' -Force"
            robocopy "!TEMP_DIR!" "%ROOT%" /E /XD node_modules _tools _update_temp /XF launcher.log error.log build_log.txt /NFL /NDL /NJH /NJS >nul 2>&1
            echo %LATEST_VER%> "%VERSION_FILE%"
            rd /s /q "!TEMP_DIR!" >nul 2>&1
            del "!ZIP_FILE!" >nul 2>&1
            echo  업데이트 완료! 앱을 다시 시작합니다...
            timeout /t 2 >nul
            start "" "%ROOT%START_HERE.bat"
            exit
        ) else (
            echo  [오류] 다운로드 실패. 그냥 실행합니다.
        )
    )
)
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
