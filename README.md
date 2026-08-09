# StreamFlux: Chaos Engineering & Self-Healing Cluster

StreamFlux is a real-time, interactive demonstration of **Chaos Engineering** and **Self-Healing Infrastructure** using Kubernetes. Modeled after modern streaming giants like Netflix, this project showcases how cloud-native architectures can survive catastrophic server failures and degraded network conditions with **zero downtime** for the end user.

This project features a fully functional video streaming frontend connected to a robust, containerized backend orchestrated by Kubernetes.

---

## 📸 Screenshots

*Drop your screenshot images into the `docs/screenshots/` folder to display them here!*

<div align="center">
  <img src="./docs/screenshots/dashboard.png" width="800" alt="Dashboard Overview" />
  <p><i>The main streaming dashboard with real-time Kubernetes cluster topology and live viewers.</i></p>
</div>
<br/>
<div align="center">
  <img src="./docs/screenshots/chaos.png" width="800" alt="Chaos Engineering Controls" />
  <p><i>The Admin Chaos Controls panel and live system logs tracking self-healing events.</i></p>
</div>
<br/>
<div align="center">
  <img src="./docs/screenshots/mobile.png" width="400" alt="Mobile Responsive Layout" />
  <p><i>Full mobile compatibility with dynamic layout stacking and horizontal swipeable infrastructure.</i></p>
</div>

---

## 🚀 Features

*   **Self-Healing Kubernetes Cluster**: A backend powered by a Minikube Kubernetes cluster running multiple replica pods. If a pod crashes, Kubernetes automatically detects the failure and spins up a replacement.
*   **Zero-Downtime Failover**: When the active server goes down, the centralized state coordinator instantly reroutes traffic to a healthy standby server, ensuring seamless video playback without buffering or pausing.
*   **Gray Failure Simulation (Slowdown)**: Simulates degraded server performance (a "gray failure"). Kubernetes health probes detect the degradation and automatically heal the cluster by terminating the slow pod and launching a fresh one.
*   **Multi-User State Synchronization**: Open multiple browser tabs! A centralized WebSocket coordinator ensures all viewers see the exact same cluster state, server status, and live event logs simultaneously.
*   **Dynamic Load Balancing**: If too many viewers connect to a single server, the system automatically promotes a standby server to active status and redistributes the load.
*   **Live Infrastructure Dashboard**: A real-time, animated topology map showing active servers, standby servers, traffic routing, and connected viewers.

---

## 🛠️ Architecture & Tech Stack

The architecture is built purely on local, open-source tools—no cloud provider accounts required.

*   **Frontend**: Next.js (React), Framer Motion (Animations), pure CSS (Glassmorphism UI)
*   **State Coordinator**: FastAPI (Python), WebSockets
*   **Backend Application**: Python (Uvicorn/FastAPI)
*   **Containerization**: Docker Desktop
*   **Orchestration**: Minikube (Local Kubernetes)
*   **Cloud Deployment**: Vercel (Frontend CDN) + ngrok (Secure Local Tunnel)

![Infrastructure Diagram](./frontend/public/architecture.png) *(Note: Generate or add architecture screenshot here)*

---

## 💻 How to Run This Project on a New Machine

To run this project on a different device, you need to install Docker Desktop and Minikube, then spin up the cluster.

### 1. Prerequisites

1.  **Docker Desktop**: Download and install [Docker Desktop for Windows/Mac/Linux](https://www.docker.com/products/docker-desktop/).
    *   *Ensure Docker Desktop is running before proceeding.*
2.  **Node.js & npm**: Download and install [Node.js](https://nodejs.org/).
3.  **Python 3.10+**: Download and install [Python](https://www.python.org/downloads/).

### 2. Install Minikube & Kubectl (Windows via PowerShell)

Open PowerShell as Administrator and run the following commands to install Minikube using the Windows Package Manager (`winget`):

```powershell
winget install minikube
```
*(Alternatively, download the standalone `.exe` from the [Minikube Releases page](https://github.com/kubernetes/minikube/releases) and add it to your System PATH).*

Kubectl (the Kubernetes command-line tool) is included with Docker Desktop.

### 3. Start the Kubernetes Cluster

Start Minikube using the Docker driver:
```powershell
minikube start --driver=docker
```

### 4. Build and Deploy the Backend

1.  Point your shell's Docker environment to Minikube's internal Docker daemon (so Kubernetes can find your local image):
    ```powershell
    minikube docker-env | Invoke-Expression
    ```
2.  Build the backend Docker image:
    ```powershell
    cd backend
    docker build -t chaos-backend:latest .
    ```
3.  Apply the Kubernetes configurations:
    ```powershell
    cd ../k8s
    kubectl apply -f deployment.yaml
    kubectl apply -f service.yaml
    ```
4.  Expose the Kubernetes service to your local machine (leave this running in a background terminal):
    ```powershell
    kubectl port-forward svc/chaos-backend-svc 8000:8000
    ```

### 5. Live Public Deployment (Cloud + Local Hybrid)

To share this demo publicly or with an audience without paying for a real cloud Kubernetes cluster, we use a hybrid approach:
1. **Frontend (Vercel)**: The Next.js app and heavy MP4 videos are deployed statically to Vercel's global CDN.
2. **Backend (ngrok)**: An `ngrok` tunnel securely exposes your local Minikube cluster and Python state server to the public internet.

**To start the live public demo:**
1. Open **Docker Desktop**.
2. Double-click the `start_cloud_demo.bat` script. This automatically starts Minikube, port-forwarding, the Python coordinator, and the `ngrok` tunnel in the background.
3. Share your public Vercel link with your audience. They will connect directly to your laptop!

### 6. Local Development Only (Alternative)

If you just want to run it entirely locally without Vercel:
1. Open a new terminal in `backend`, activate the venv, and run `python state_server.py`.
2. Open a new terminal in `frontend` and run `npm run dev`. Visit `http://localhost:3000`.

---

## 🎮 How to Use the Chaos Controls

Once the app is running and you select a movie to stream, the **Chaos Controls** will unlock:

1.  **Kill Active Server**: Simulates a catastrophic hardware crash or kernel panic. The server node turns red and dies. You will see traffic instantly reroute to a standby server while Kubernetes boots a replacement in the background. The video never stops playing.
2.  **Slow Down Active Server**: Simulates a "Gray Failure" (e.g., a memory leak or network saturation). The active server turns orange and the traffic dot slows down. After about 13 seconds, Kubernetes health probes will timeout, detect the degraded state, and automatically trigger a self-healing sequence to replace the pod.
3.  **Restart / Reset Cluster**: Instantly restores all 3 servers to a clean, healthy state.

---

## 📝 License
This project is for educational and portfolio demonstration purposes.
