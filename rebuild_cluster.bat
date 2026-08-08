@echo off
title Rebuild ^& Redeploy Chaos Cluster

echo ========================================================
echo   Rebuilding Chaos Engineering Cluster from Scratch
echo ========================================================
echo.

echo [1/4] Ensuring Minikube is Running...
D:\tools\minikube.exe start --driver=docker
echo.

echo [2/4] Building Docker Image INSIDE Minikube Docker daemon...
echo (Avoids image-load caching issues - builds where K8s looks)
FOR /F "tokens=*" %%i IN ('D:\tools\minikube.exe docker-env --shell cmd') DO %%i
docker build --no-cache -t chaos-backend:latest "%~dp0backend"
echo.

echo [3/4] Applying Kubernetes Deployment and Service...
kubectl apply -f "%~dp0k8s\deployment.yaml"
kubectl apply -f "%~dp0k8s\service.yaml"
echo.

echo [4/4] Performing Rolling Restart of Backend Pods...
kubectl rollout restart deployment/chaos-backend
kubectl rollout status deployment/chaos-backend --timeout=120s

echo.
echo ========================================================
echo   Rebuild Complete! All pods running new image.
echo ========================================================
echo You can now run start_demo.bat to launch the app.
pause
