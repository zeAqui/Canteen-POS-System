@echo off
cd /d "%~dp0"
title Canteen POS System — Build Tool

echo ========================================
echo   Canteen POS System — Electron Build
echo ========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Download from https://nodejs.org
    pause
    exit /b 1
)

echo [1/3] Installing dependencies...
call npm install
if %errorlevel% neq 0 ( echo ERROR: npm install failed. & pause & exit /b 1 )

echo.
echo [2/3] Installing electron-builder globally...
call npm install -g electron-builder
if %errorlevel% neq 0 ( echo ERROR: electron-builder install failed. & pause & exit /b 1 )

echo.
echo [3/3] Building installer...
call npm run build
if %errorlevel% neq 0 ( echo ERROR: Build failed. & pause & exit /b 1 )

echo.
echo ========================================
echo   SUCCESS!
echo   Installer is in the dist\ folder:
echo   Canteen POS System Setup.exe
echo ========================================
echo.
echo Share that file with anyone — they just
echo double-click it to install, no Node.js needed.
echo.
pause
