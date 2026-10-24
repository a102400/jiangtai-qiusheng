@echo off
chcp 65001 >nul
title 讲台求生 · 本地启动
cd /d "%~dp0app"

echo ============================================
echo   讲台求生 · 师范生 AI 试讲教练
echo   正在启动本地服务（不需要网络、不需要 sharecode）
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  set "NODEEXE=C:\Users\ASUS\AppData\Local\pi-node\current\node.exe"
) else (
  set "NODEEXE=node"
)

echo 2 秒后自动打开浏览器： http://localhost:3000
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
echo （关闭本窗口即停止服务）
echo.
"%NODEEXE%" server.js
pause
