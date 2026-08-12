@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "NO_PAUSE="
set "CHECK_ARGS="

:collect_args
if "%~1"=="" goto args_done
if /i "%~1"=="--no-pause" (
    set "NO_PAUSE=1"
    shift /1
    goto collect_args
)
set "CHECK_ARGS=!CHECK_ARGS! %1"
shift /1
goto collect_args

:args_done

if defined ZETER_NODE if exist "%ZETER_NODE%" (
    for %%I in ("%ZETER_NODE%") do set "PATH=%%~dpI;%PATH%"
)

where node >nul 2>nul
if errorlevel 1 (
    set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    if exist "!CODEX_NODE!" for %%I in ("!CODEX_NODE!") do set "PATH=%%~dpI;!PATH!"
)

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

where py >nul 2>nul
if not errorlevel 1 (
    set "PY_EXE=py"
    set "PY_ARGS=-3"
    goto have_python
)

where python >nul 2>nul
if not errorlevel 1 (
    set "PY_EXE=python"
    set "PY_ARGS="
    goto have_python
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
echo Checking ZeTer OS project...
"%PY_EXE%" %PY_ARGS% tools\check_project.py %CHECK_ARGS%
set "CHECK_EXIT=%ERRORLEVEL%"
echo.
if "%CHECK_EXIT%"=="0" (
    echo Project check finished successfully.
) else (
    echo Project check found problems.
)
echo.
if not defined NO_PAUSE pause
exit /b %CHECK_EXIT%
