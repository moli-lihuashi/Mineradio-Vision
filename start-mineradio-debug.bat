@echo off
setlocal
cd /d "%~dp0dist\Mineradio"
taskkill /IM Mineradio.exe /T /F >nul 2>&1
timeout /t 1 /nobreak >nul
start "" "%~dp0dist\Mineradio\Mineradio.exe" --remote-debugging-port=9800
endlocal
