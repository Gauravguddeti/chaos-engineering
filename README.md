# Chaos Engineering & Self-Healing Cluster

A live, interactive demonstration of **Chaos Engineering** and **Self-Healing Infrastructure**, inspired by Netflix's Chaos Monkey and modern Site Reliability Engineering (SRE) practices.

This project simulates a streaming platform (like Netflix) and allows you to intentionally inject failures (crashes and gray failures) into the live system to watch Kubernetes automatically detect the failure, reroute traffic, and self-heal in real-time with zero user downtime.

## 🌟 Key Features

*   **StreamFlux UI:** A Next.js-based streaming interface simulating real user traffic.
*   **Zero-Downtime Hard Failures:** "Kill" a server mid-stream and watch Kubernetes immediately reroute traffic to a standby node without stopping the video.
*   **Gray Failure Auto-Healing (Slowdown):** Inject a "slow mode" that simulates network degradation or CPU starvation. Kubernetes detects the timeout via Liveness Probes and automatically restarts the unhealthy container.
*   **Real-time Visualization:** An animated infrastructure layer shows live network traffic, node statuses (Active, Standby, Slow, Dead), and a real-time system event log using Server-Sent Events (SSE).

## 🏗️ Architecture Stack

*   **Backend:** FastAPI (Python) - 3 Replicas
*   **Frontend:** Next.js (React) with Framer Motion for animations
*   **Containerization:** Docker
*   **Orchestration:** Kubernetes (K8s) via Minikube
*   **Communication:** Server-Sent Events (SSE) for real-time cluster state updates

## 🚀 Getting Started

### Prerequisites

You need the following installed on your machine:
*   [Docker Desktop](https://www.docker.com/products/docker-desktop) (must be running)
*   [Minikube](https://minikube.sigs.k8s.io/docs/start/)
*   [Node.js](https://nodejs.org/) (for the Next.js frontend)
*   `kubectl` (usually installed with Docker Desktop or Minikube)

### Installation & Deployment

1.  **Rebuild and Deploy the Cluster**
    Run the setup script which starts Minikube, builds the Docker image directly inside the Minikube environment, and applies the Kubernetes deployment configs.
    ```bash
    rebuild_cluster.bat
    ```

2.  **Start the Demo**
    Run the startup script. This will launch the port-forwarding service to connect to the Kubernetes cluster and start the Next.js frontend.
    ```bash
    start_demo.bat
    ```

3.  The dashboard will automatically open in your default browser at `http://localhost:3000`.

## 🎮 How to Run the Demo

1.  Click on any movie in the "Available to Stream" row to start playback.
2.  **Test Hard Failure:** Click **"Kill Active Server"**. The active node will die, traffic will instantly reroute to a standby node, and a new pod will be spawned by the Kubernetes ReplicaSet.
3.  **Test Gray Failure:** Click **"Slow Down Active Server"**. The video quality will degrade (blur), simulating buffering. After ~7-12 seconds, Kubernetes will detect the probe timeout, kill the slow pod, and auto-heal the cluster.

## 📝 License

This project is open-source and available under the MIT License.
