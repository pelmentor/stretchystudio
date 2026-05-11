@echo off
title Stretchy Studio Dev Server
echo.
echo  =============================================
echo   Stretchy Studio - Development Server
echo  =============================================
echo.

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] npm not found. Install Node.js first.
    echo  https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo  Installing dependencies...
    echo.
    npm install
    echo.
)

echo  Starting dev server...
echo  Press Ctrl+C to stop.
echo.
start http://localhost:5173
npm run dev
