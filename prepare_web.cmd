@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "PYTHONUTF8=1"
cd /d "%~dp0"
set "NO_PAUSE="
for %%A in (%*) do if /i "%%~A"=="--no-pause" set "NO_PAUSE=1"
if defined ZETER_PYTHON if exist "%ZETER_PYTHON%" (
  set "WEB_PY=%ZETER_PYTHON%"
  goto ready
)
if exist ".venv\Scripts\python.exe" (
  set "WEB_PY=%CD%\.venv\Scripts\python.exe"
  goto ready
)
where python >nul 2>nul
if not errorlevel 1 (
  set "WEB_PY=python"
  goto ready
)
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set "WEB_PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  goto ready
)
echo Python 3.10+ not found. Set ZETER_PYTHON to its full path.
if not defined NO_PAUSE pause
exit /b 1
:ready
"%WEB_PY%" -B tools\prepare_web.py --write
set "WEB_EXIT=%ERRORLEVEL%"
if not defined NO_PAUSE pause
exit /b %WEB_EXIT%
