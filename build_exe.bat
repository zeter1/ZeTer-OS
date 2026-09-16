@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
cd /d "%~dp0"

rem ============================================================================
rem ZeTer OS - ready native Windows EXE builder
rem
rem Double-click this file. It will:
rem   1. Find tested Python 3.13 or install it with winget for the current user.
rem   2. Create isolated .build-venv and install pywebview + PyInstaller.
rem   3. Ensure Microsoft Edge WebView2 Runtime is installed for normal builds.
rem   4. Compile/verify the current project before packaging.
rem   5. Build an ONEDIR distribution with the complete app/ web layer.
rem   6. Keep writable data next to the EXE by using PyInstaller's flat layout.
rem   7. Run --self-test on the packaged EXE before reporting success.
rem
rem Result: dist\ZeTer-OS\ZeTer-OS.exe
rem Copy the WHOLE ZeTer-OS folder to another Windows PC.
rem Python is not required on the target PC. Normal builds also ensure WebView2.
rem
rem CI/Codex: build_exe.bat --ci
rem Existing build_release.cmd remains the source/portable ZIP builder.
rem Full EXE guide: BUILD_EXE.md
rem ============================================================================

set "NO_PAUSE="
set "CI_MODE="
if /i "%~1"=="--ci" (
    set "NO_PAUSE=1"
    set "CI_MODE=1"
)
if /i "%~1"=="--no-pause" set "NO_PAUSE=1"

call :find_python313
if not defined BASE_PY call :install_python
if not defined BASE_PY goto :fail

set "BUILD_VENV=%CD%\.build-venv"
set "BUILD_PY=%BUILD_VENV%\Scripts\python.exe"

if exist "%BUILD_PY%" (
    "%BUILD_PY%" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)" >nul 2>nul
    if errorlevel 1 (
        echo [SETUP] Existing build environment uses another Python version. Recreating it...
        rmdir /s /q "%BUILD_VENV%" || goto :fail
    )
)

if not exist "%BUILD_PY%" (
    echo [1/8] Creating isolated Python 3.13 build environment...
    "%BASE_PY%" -m venv "%BUILD_VENV%" || goto :fail
) else (
    echo [1/8] Reusing isolated Python 3.13 build environment...
)

echo [2/8] Installing ZeTer OS and packaging dependencies...
"%BUILD_PY%" -m pip install --disable-pip-version-check --no-input --timeout 60 --retries 2 -r requirements.txt || goto :fail
"%BUILD_PY%" -m pip install --disable-pip-version-check --no-input --timeout 60 --retries 2 "pyinstaller==6.22.3" "pyinstaller-hooks-contrib>=2026.6" || goto :fail
"%BUILD_PY%" -m pip check || goto :fail

echo [3/8] Checking Microsoft Edge WebView2 Runtime...
call :find_webview2
if defined WEBVIEW2_EXE (
    echo [OK] WebView2 found: !WEBVIEW2_EXE!
) else if defined CI_MODE (
    echo [CI] WebView2 machine installation is skipped; packaging runtime is tested without opening the GUI.
) else (
    call :install_webview2
    if errorlevel 1 goto :fail
    call :find_webview2
    if not defined WEBVIEW2_EXE (
        echo [ERROR] WebView2 installer finished but msedgewebview2.exe was not found.
        goto :fail
    )
    echo [OK] WebView2 installed: !WEBVIEW2_EXE!
)

echo [4/8] Compiling Python sources...
"%BUILD_PY%" -m compileall -q run_zeter_os.py problem_logs.py tools build_support || goto :fail

echo [5/8] Running project verification...
"%BUILD_PY%" tools\check_project.py || goto :fail

echo [6/8] Cleaning previous EXE build...
if exist build rmdir /s /q build
if exist "dist\ZeTer-OS" rmdir /s /q "dist\ZeTer-OS"
if exist "ZeTer-OS.spec" del /q "ZeTer-OS.spec"
if not exist dist mkdir dist || goto :fail

echo [7/8] Building native ZeTer OS distribution...
"%BUILD_PY%" -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onedir ^
  --contents-directory "." ^
  --windowed ^
  --name "ZeTer-OS" ^
  --add-data "app;app" ^
  --runtime-hook "build_support\package_runtime.py" ^
  --collect-all webview ^
  --hidden-import webview.platforms.edgechromium ^
  --hidden-import webview.platforms.winforms ^
  run_zeter_os.py || goto :fail

set "DIST_DIR=%CD%\dist\ZeTer-OS"
set "DIST_EXE=%DIST_DIR%\ZeTer-OS.exe"
if not exist "%DIST_EXE%" (
    echo [ERROR] Expected packaged EXE was not created.
    goto :fail
)
if not exist "%DIST_DIR%\app\index.html" (
    echo [ERROR] app\index.html is missing from packaged distribution.
    goto :fail
)

echo [8/8] Running packaged runtime self-test...
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process -FilePath '%DIST_EXE%' -ArgumentList '--self-test' -PassThru -Wait; exit $p.ExitCode" || goto :fail

echo.
echo [OK] READY NATIVE BUILD CREATED AND VERIFIED.
echo Folder: %DIST_DIR%
echo EXE   : %DIST_EXE%
echo.
echo Copy the whole folder. It contains Python, pywebview and the complete app layer.
goto :success

:find_python313
set "BASE_PY="
if defined pythonLocation if exist "%pythonLocation%\python.exe" (
    "%pythonLocation%\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)" >nul 2>nul
    if not errorlevel 1 set "BASE_PY=%pythonLocation%\python.exe"
)
if defined BASE_PY exit /b 0
where py >nul 2>nul && for /f "delims=" %%P in ('py -3.13 -c "import sys; print(sys.executable)" 2^>nul') do set "BASE_PY=%%P"
if defined BASE_PY exit /b 0
for %%P in ("%LOCALAPPDATA%\Programs\Python\Python313\python.exe" "%ProgramFiles%\Python313\python.exe") do if exist "%%~P" set "BASE_PY=%%~P"
if defined BASE_PY exit /b 0
where python >nul 2>nul && python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 13) else 1)" >nul 2>nul && for /f "delims=" %%P in ('python -c "import sys; print(sys.executable)"') do set "BASE_PY=%%P"
exit /b 0

:install_python
echo [SETUP] Tested Python 3.13 was not found. Trying automatic per-user installation...
where winget >nul 2>nul || (
    echo [ERROR] Python 3.13 is missing and Windows Package Manager ^(winget^) is unavailable.
    echo Install Python 3.13 from python.org, then run this file again.
    exit /b 1
)
winget install --id Python.Python.3.13 -e --scope user --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo [ERROR] Automatic Python 3.13 installation failed.
    exit /b 1
)
call :find_python313
exit /b 0

:find_webview2
set "WEBVIEW2_EXE="
for %%R in (
    "%ProgramFiles(x86)%\Microsoft\EdgeWebView\Application"
    "%ProgramFiles%\Microsoft\EdgeWebView\Application"
    "%LOCALAPPDATA%\Microsoft\EdgeWebView\Application"
) do (
    if exist "%%~R" (
        for /f "delims=" %%W in ('dir /b /s "%%~R\msedgewebview2.exe" 2^>nul') do if not defined WEBVIEW2_EXE set "WEBVIEW2_EXE=%%W"
    )
)
exit /b 0

:install_webview2
echo [SETUP] WebView2 Runtime was not found. Installing official Microsoft Evergreen Runtime...
set "WV_DIR=%TEMP%\ZeTerOSBuild"
set "WV_SETUP=%WV_DIR%\MicrosoftEdgeWebview2Setup.exe"
if not exist "%WV_DIR%" mkdir "%WV_DIR%" || exit /b 1
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile '%WV_SETUP%'" || (
    echo [ERROR] Failed to download Microsoft WebView2 Evergreen Bootstrapper.
    exit /b 1
)
"%WV_SETUP%" /silent /install
set "WV_EXIT=%ERRORLEVEL%"
del /q "%WV_SETUP%" >nul 2>nul
if not "%WV_EXIT%"=="0" (
    echo [ERROR] WebView2 Runtime installation failed. Exit code: %WV_EXIT%
    exit /b 1
)
exit /b 0

:fail
echo.
echo [ERROR] Native EXE build failed. Read the first error above.
echo No incomplete distribution is reported as ready.
if not defined NO_PAUSE pause
exit /b 1

:success
if not defined NO_PAUSE pause
exit /b 0
