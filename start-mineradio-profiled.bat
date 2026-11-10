@echo off
rem 诊断用启动：带 CDP 调试端口，并自动挂 30 秒 CPU 剖析器。
rem 产物在 .workbuddy\harness\_user_profile.txt
taskkill /IM Mineradio.exe /T /F >nul 2>&1
timeout /t 2 /nobreak >nul
start "" "%~dp0dist\Mineradio\Mineradio.exe" --remote-debugging-port=9800
start /min "" node "%~dp0.workbuddy\harness\auto-profile-user.js" 9800
