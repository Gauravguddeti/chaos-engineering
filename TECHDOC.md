# TECHDOC — Chaos Engineering & Self-Healing Cluster

## 1. Architecture Overview
```
[ Browser Dashboard (Next.js) ]
        |  WebSocket / polling
        v
[ Control API? or direct to k8s-exposed Service ]
        |
        v
[ Kubernetes Service (LoadBalancer/NodePort) ]
        |
        v
[ Deployment: 3x backend Pod replicas ]
        (running inside Minikube, inside Docker Desktop, inside WSL2)
```

## 2. Tech Stack
- **Backend app:** FastAPI (Python)
- **Containerization:** Docker Desktop (Windows, WSL2 backend)
- **Orchestration:** Minikube (local, real Kubernetes)
- **Frontend:** Next.js dashboard, plain fetch/WebSocket to talk to the cluster — no heavy extra framework needed
- **Everything local, everything open-source, no cloud provider accounts**

## 3. Environment / Drive Constraints
- Project root: `D:\<project-folder>\`
- Python virtual environment: `D:\<project-folder>\.venv`, with `PIP_CACHE_DIR` pointed at a D:\ folder
- Docker Desktop WSL2 virtual disk: relocated to D:\ (exact method depends on Docker Desktop version — diagnosed in Phase 0)
- Minikube profile/cache: `MINIKUBE_HOME` set to a D:\ folder
- kubectl config: `KUBECONFIG` set to a file on D:\
- Nothing should be written to `C:\Users\<user>\.minikube`, `C:\Users\<user>\.kube`, or any default pip cache location

## 4. Backend Routes (Phase 1)
| Route | Method | Behavior |
|---|---|---|
| `/health` or `/stream` | GET | Returns a heartbeat/data payload plus the pod's own hostname/ID |
| `/crash` | POST | Deliberately exits the process (hard failure) |
| `/slow` | POST | Deliberately adds artificial latency to responses (degraded failure) |

## 5. Kubernetes Resources (Phase 2)
- **Deployment:** 3 replicas of the backend image, resource requests/limits set low enough to run comfortably on a laptop
- **Service:** LoadBalancer or NodePort, exposing the Deployment to localhost via `minikube service` / `minikube tunnel`
- Verify self-healing at the `kubectl` level (kill a pod, watch a replacement appear) before any frontend exists

## 6. Frontend (Phase 3)
- Polls or subscribes (WebSocket) to know which pod is currently answering requests
- Two action buttons calling `/crash` and `/slow` on whichever pod is currently active
- Continuous visual/data stream that keeps updating through a chaos event, to visually prove zero downtime

## 7. Folder Structure (proposed)
```
D:\chaos-cluster\
  backend\
    main.py
    Dockerfile
    requirements.txt
  k8s\
    deployment.yaml
    service.yaml
  frontend\
    (Next.js app)
  PRD.md
  TECHDOC.md
  PROGRESS.md
```

## 8. Open Questions / Decisions Log
- Minikube driver: Docker driver (recommended for Windows + Docker Desktop setup already in place)
- Chosen exposure method for local Service: to be decided in Phase 2 based on what works cleanly with `minikube tunnel`
