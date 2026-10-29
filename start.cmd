@echo off
chcp 65001 >nul
echo ========================================================
echo   Запуск виртуального лабораторного комплекса «Микроклимат»
echo ========================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Python обнаружен, запуск локального веб-сервера на порту 8085...
    start http://localhost:8085/
    python -m http.server 8085
) else (
    echo [INFO] Запуск напрямую в браузере...
    start index.html
)
