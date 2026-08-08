@echo off
title Launch Chaos Engineering Cluster

echo ========================================================
echo   Starting Chaos Engineering & Self-Healing Cluster
echo ========================================================
echo.

echo [1/3] Starting Minikube Cluster...
D:\tools\minikube.exe start --driver=docker
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Minikube failed to start! Make sure Docker Desktop is open.
    pause
    exit /b
)

echo.
echo [2/3] Launching Port Forwarding Service...
start "K8s Port Forwarding" powershell -NoExit -Command "while ($true) { kubectl port-forward svc/chaos-backend-svc 8000:8000; Start-Sleep -Seconds 1 }"

echo.
echo [3/3] Launching Next.js Control Panel...
start "Next.js Frontend" powershell -NoExit -Command "cd /d D:\ClgStuff\chaos engineering\frontend; npm run dev"

echo.
echo Waiting 5 seconds for services to initialize...
timeout /t 5 >nul

echo.
echo Opening Dashboard in your default browser...
start http://localhost:3000

echo.
echo ========================================================
echo   All systems started successfully!
echo ========================================================
pause
