@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Starting ZeTer OS...

where py >nul 2>nul
if not errorlevel 1 (
    set "PY_CMD=py -3"
    goto have_python
)

where python >nul 2>nul
if not errorlevel 1 (
    set "PY_CMD=python"
    goto have_python
)

echo.
echo Python 3 was not found.
echo Install Python 3.10 or newer from python.org.
echo During installation enable: Add Python to PATH.
echo.
pause
exit /b 1

:have_python
%PY_CMD% -c "import webview" >nul 2>nul
if errorlevel 1 (
    echo Installing required package: pywebview
    %PY_CMD% -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo Failed to install dependencies.
        echo Try manually:
        echo   %PY_CMD% -m pip install -r requirements.txt
        echo.
        pause
        exit /b 1
    )
)

echo Launching app...
%PY_CMD% run_zeter_os.py
if errorlevel 1 (
    echo.
    echo ZeTer OS stopped with an error.
    echo Check file: data\logs\zeter-os.log
    echo.
    pause
    exit /b 1
)

endlocal
