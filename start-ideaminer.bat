@echo off
setlocal
title IdeaMiner Launcher
cd /d "%~dp0"

echo.
echo  IdeaMiner - local research idea manager
echo  --------------------------------------
echo.

where npm >nul 2>&1
if errorlevel 1 goto missing_node

if exist ".venv\Scripts\python.exe" goto python_ready

echo  First run: creating a private Python environment...
where py >nul 2>&1
if errorlevel 1 goto try_python
py -3 -m venv .venv
goto check_venv

:try_python
where python >nul 2>&1
if errorlevel 1 goto missing_python
python -m venv .venv

:check_venv
if not exist ".venv\Scripts\python.exe" goto setup_failed

:python_ready
".venv\Scripts\python.exe" -c "import fastapi, uvicorn, mcp" >nul 2>&1
if not errorlevel 1 goto frontend_ready

echo  Installing Python packages...
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
if errorlevel 1 goto setup_failed

:frontend_ready
if exist "node_modules\.bin\vite.cmd" goto launch

echo.
echo  Installing frontend packages...
call npm ci
if errorlevel 1 goto setup_failed

:launch
echo  Starting IdeaMiner...
start "IdeaMiner" /D "%~dp0" ".venv\Scripts\python.exe" launcher.py
exit /b 0

:missing_python
echo.
echo  ERROR: Python 3 was not found.
echo  Install Python 3.11 or newer from https://www.python.org/downloads/windows/
echo  During installation, enable "Add Python to PATH", then run this file again.
goto failed

:missing_node
echo.
echo  ERROR: Node.js and npm were not found.
echo  Install the current Node.js LTS release from https://nodejs.org/
echo  Then run this file again.
goto failed

:setup_failed
echo.
echo  ERROR: IdeaMiner setup did not finish successfully.
echo  Review the messages above and see README.md troubleshooting.

:failed
echo.
pause
exit /b 1
