@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "PYTHONUTF8=1"
cd /d "%~dp0"

set "NO_PAUSE="
for %%A in (%*) do if /i "%%~A"=="--no-pause" set "NO_PAUSE=1"

if defined ZETER_PYTHON if exist "%ZETER_PYTHON%" (
    set "PY_EXE=%ZETER_PYTHON%"
    set "PY_ARGS="
    goto have_python
)

if exist ".venv\Scripts\python.exe" (
    set "PY_EXE=%CD%\.venv\Scripts\python.exe"
    set "PY_ARGS="
    goto have_python
)

where python >nul 2>nul
if not errorlevel 1 (
    python -B -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 (
    set "PY_EXE=python"
    set "PY_ARGS="
    goto have_python
    )
)

where py >nul 2>nul
if not errorlevel 1 (
    py -3 -B -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 (
    set "PY_EXE=py"
    set "PY_ARGS=-3"
    goto have_python
    )
)

set "CODEX_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%CODEX_PYTHON%" (
    set "PY_EXE=%CODEX_PYTHON%"
    set "PY_ARGS="
    goto have_python
)

echo.
echo Python 3 was not found.
echo Set ZETER_PYTHON, create .venv, or install Python 3.10 or newer.
echo.
if not defined NO_PAUSE pause
exit /b 1

:have_python
echo Building ZeTer OS static uCoz package...
"%PY_EXE%" %PY_ARGS% -B tools\build_ucoz.py %*
set "BUILD_EXIT=%ERRORLEVEL%"
echo.
if "%BUILD_EXIT%"=="0" (
    echo Release build finished successfully.
    echo Use the ZIP/output directory printed above.
) else (
    echo Release build failed. The previous verified ZIP was not replaced.
)
echo.
if not defined NO_PAUSE pause
exit /b %BUILD_EXIT%
