@echo off
title TaskFlow Server
color 0A
echo ============================================
echo       TaskFlow - Starting Server...
echo ============================================
echo.

cd /d "%~dp0"

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if errorlevel 1 (
        echo.
        echo Error installing dependencies!
        pause
        exit /b 1
    )
    echo.
)

echo Starting TaskFlow server...
echo.
echo Server will be available at: http://localhost:3000
echo.
echo ============================================

cmd /k "npm start"
