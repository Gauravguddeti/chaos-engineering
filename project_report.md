# Chaos Engineering & Self-Healing Cluster — Project Report

> **One-line pitch:** We built a live streaming website (like Netflix) that intentionally breaks its own servers — and then watches Kubernetes automatically fix them, in real time, on screen.

---

## Table of Contents

1. [The Big Idea — What Netflix Actually Does](#1-the-big-idea)
2. [What Our Project Does](#2-what-our-project-does)
3. [The Technology Stack — Plain English](#3-the-technology-stack)
4. [Architecture — How the Pieces Connect](#4-architecture)
5. [Feature-by-Feature Breakdown](#5-feature-by-feature-breakdown)
6. [Cloud Computing Concepts Used](#6-cloud-computing-concepts-used)
7. [What to Say During the Demo](#7-what-to-say-during-the-demo)

---

## 1. The Big Idea

### What Netflix Actually Does

Netflix serves **260 million subscribers** simultaneously. If even one of their servers crashes, millions of people get a buffering screen. To prevent this, Netflix does something that sounds crazy on paper:

> **They deliberately break their own systems — on purpose — to make sure the system can heal itself.**

This practice is called **Chaos Engineering**. Netflix built a tool called **Chaos Monkey** — a program that randomly kills production servers every single day. The idea? If you constantly test that your system can survive failures, you *guarantee* it is resilient. No surprises on the day a real server actually dies.

Netflix's rules:
- Kill a server → the website must keep working
- Slow down a server → the website must detect it and reroute
- Take down an entire data center → service must survive

Our project demonstrates **exactly this** — in a live, interactive, visual way.

---

## 2. What Our Project Does

We built a **full-stack chaos engineering demonstration platform** with three parts working together:

| Part | What it is | Analogy |
|------|-----------|---------|
| **StreamFlux** | A fake Netflix-style streaming site | The "victim" — the service we're stress-testing |
| **Chaos Controls** | A dashboard to inject failures | The "Chaos Monkey" — the weapon |
| **Infrastructure Layer** | Live server nodes with health visualization | The "hospital monitor" — showing what's alive |

You open the website, start watching a movie, then **kill a server mid-stream**. The video doesn't stop. Kubernetes detects the failure and routes traffic to a healthy server — automatically. The entire process is animated, narrated in the Live System Log, and visible through the server node diagram.

---

## 3. The Technology Stack — Plain English

### 🐍 FastAPI (Python) — The Backend

**What it is:** A modern Python web framework for building APIs.

**What it does in our project:**
- Runs the "brain" of each server
- Has endpoints like `/health`, `/slow`, `/crash`, `/stream`, `/reset`
- Each backend instance represents **one server** in our cluster

**Analogy:** Think of FastAPI as the waiter in a restaurant. You (the browser) place an order, the waiter (FastAPI) fetches it from the kitchen (logic) and brings it back.

**Key endpoints:**
| Endpoint | What it does |
|---------|-------------|
| `GET /health` | Kubernetes pings this every 2 seconds to check if the server is alive |
| `POST /slow` | Makes the server sick — `/health` now takes 3 seconds to respond (gray failure) |
| `POST /crash` | Simulates a hard crash — the server reports it is dead |
| `GET /stream` | Sends a live heartbeat to the frontend every second via SSE |
| `POST /reset` | Clears all injected failures, restores normal operation |

---

### 🐳 Docker — The Packaging Machine

**What it is:** A tool that packages your application and all its dependencies into a self-contained unit called a **container**.

**What it does in our project:**
- We wrote a `Dockerfile` that says: "Take Python, install FastAPI, copy our code, run it"
- Running `docker build` creates the image `chaos-backend:latest`
- This image can be deployed anywhere — laptop, cloud, data center — and it will behave identically

**Analogy:** Docker is like a **shipping container for software**. Before containers, moving software between environments was painful ("it works on my machine!"). Docker solves this — you ship the *entire environment*, not just the code.

**Why we need it:** Kubernetes can only deploy applications that are packaged as Docker containers. Docker is the prerequisite to Kubernetes.

---

### ☸️ Kubernetes (K8s) — The Orchestrator

**What it is:** An open-source system (originally built by Google) that manages containers at scale.

**What it does in our project:**
- Runs **3 copies** (replicas) of our FastAPI backend simultaneously
- Continuously health-checks each server every **2 seconds**
- If a server fails its health check → automatically restarts it
- If a server is killed → automatically spawns a new one to maintain 3 replicas

**Analogy:** Kubernetes is the **hospital administrator** of your server farm. It continuously checks: "Is Server 1 alive? Is Server 2 healthy? Is Server 3 responding?" If anything goes wrong, it acts immediately — no human intervention needed.

**Key Kubernetes concepts we use:**

| K8s Concept | What it means | How we use it |
|------------|---------------|---------------|
| **Pod** | The smallest deployable unit — one running container | Each of our 3 servers is a Pod |
| **Deployment** | A blueprint that says "always keep N replicas running" | We declare `replicas: 3` |
| **Service** | A stable network address that points to healthy pods | Routes traffic to the 3 backend pods |
| **Liveness Probe** | A health check K8s runs periodically | Pings `/health` every 2 seconds |
| **ReplicaSet** | Ensures the desired number of pods exist | If one pod dies, ReplicaSet spawns a new one |

---

### 🎛️ Minikube — Kubernetes on a Laptop

**What it is:** A tool that runs a full Kubernetes cluster inside a single virtual machine on your laptop.

**What it does in our project:**
- Creates a local Kubernetes environment without needing Google Cloud or AWS
- Runs inside Docker Desktop (Docker acts as the "hypervisor")
- Hosts all 3 of our backend pods

**Analogy:** Minikube is a **flight simulator for Kubernetes** — you get all the capabilities of real cloud Kubernetes, running locally for development and demos.

---

### ⚛️ Next.js + Vercel — The Frontend

**What it is:** A React-based JavaScript framework deployed globally on Vercel's Edge Network.

**What it does in our project:**
- Renders the **StreamFlux** streaming homepage
- Renders the **Chaos Controls** panel and **Infrastructure Layer**
- Delivered instantly to users via Vercel's CDN
- Connects to the backend via **Server-Sent Events (SSE)** for real-time updates

**Analogy:** Next.js is the **TV screen** of our project. Everything the user sees and interacts with lives here.

---

### 🚇 ngrok — The Secure Tunnel

**What it is:** A globally distributed reverse proxy that exposes local servers behind NATs and firewalls to the public internet over secure tunnels.

**What it does in our project:**
- Exposes our local Minikube cluster and Python coordinator to the world securely.
- Allows an entire classroom of students to connect to the backend running directly on a laptop.
- Handles SSL/TLS encryption automatically.

**Analogy:** ngrok is like a **secure wormhole** from the internet directly into your local machine.

---

### 📡 Server-Sent Events (SSE) — The Live Wire

**What it is:** A web technology where the server continuously pushes data to the browser over a single persistent connection (like a live news ticker).

**What it does in our project:**
- The backend's `/stream` endpoint sends a heartbeat to the browser every ~1 second
- Each heartbeat includes: which pod is responding, whether slow mode is active, uptime
- The frontend reads these heartbeats to detect when a pod changes or heals

**Why this is powerful for our demo:** SSE is a **persistent single connection pinned to one specific pod**. When that pod is killed by Kubernetes, the SSE connection drops. The moment it reconnects to a fresh pod, the frontend knows the cluster healed — and plays the auto-heal animation.

**Analogy:** SSE is like a **heartbeat monitor in a hospital**. As long as the beep keeps coming, the patient is alive. The moment it goes flat, you know something happened.

---

### 🖥️ kubectl + Port Forwarding — The Bridge

**What it is:** `kubectl` is the command-line tool for interacting with Kubernetes clusters.

**What it does in our project:**
- `kubectl port-forward svc/chaos-backend-svc 8000:8000` creates a tunnel from `localhost:8000` to the Kubernetes service
- This lets the browser (running on localhost) talk to the pods running inside Minikube
- The port-forward loop automatically restarts if a pod dies, reconnecting to a fresh healthy pod

**Analogy:** Port-forwarding is like a **phone operator** — you dial `localhost:8000`, the operator (kubectl) connects you through to whichever pod inside Minikube is available.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR BROWSER                             │
│                                                                 │
│   ┌──────────────┐          ┌────────────────────────────────┐  │
│   │  StreamFlux  │          │       Chaos Controls           │  │
│   │  (Next.js)   │          │  Kill | Slow | Reset | Log     │  │
│   │  ON VERCEL   │          │  (Protected by Admin Token)    │  │
│   └──────┬───────┘          └──────────────┬─────────────────┘  │
│          │                                  │                   │
└──────────┼──────────────────────────────────┼───────────────────┘
           │ HTTP / WebSockets                │ HTTP POST
           │                                  │
    ┌──────▼──────────────────────────────────▼──────┐
    │                     ngrok                      │
    │         (Secure Tunnel over Internet)          │
    └─────────────────────┬──────────────────────────┘
                          │
    ┌─────────────────────▼──────────────────────────────────────┐
    │        Python State Server (localhost:8001)                │
    │     (Handles WebSockets, load balances users)              │
    └─────────────────────┬──────────────────────────────────────┘
                          │
    ┌─────────────────────▼──────────────────────────────────────┐
    │        kubectl port-forward (localhost:8000)               │
    │                 "The Bridge"                               │
    └─────────────────────┬──────────────────────────────────────┘
                          │
    ┌─────────────────────▼──────────────────────────────────────┐
    │                  KUBERNETES (Minikube)                      │
    │                                                            │
    │   Service: chaos-backend-svc                               │
    │        │                                                   │
    │   ┌────▼─────┐   ┌──────────┐   ┌──────────┐             │
    │   │  Pod 1   │   │  Pod 2   │   │  Pod 3   │             │
    │   │ FastAPI  │   │ FastAPI  │   │ FastAPI  │             │
    │   │ :8000    │   │ :8000    │   │ :8000    │             │
    │   └──────────┘   └──────────┘   └──────────┘             │
    │                                                            │
    │   K8s Liveness Probe: pings /health every 2 seconds       │
    │   ReplicaSet: always maintains exactly 3 running pods      │
    └────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. Audience loads the Next.js frontend on **Vercel**
2. Frontend opens a WebSocket connection to the **ngrok** URL
3. ngrok tunnels the request to the **Python State Server** (`localhost:8001`)
4. The State Server opens an SSE connection to **Minikube** via `kubectl port-forward`
5. That K8s pod sends a live heartbeat every second with its status back up the chain
6. When the Admin clicks a chaos button, a POST request goes through ngrok to K8s
7. Kubernetes continuously monitors all 3 pods via the Liveness Probe
8. If a pod fails → K8s kills and restarts it → SSE reconnects → frontend detects heal

---

## 5. Feature-by-Feature Breakdown

---

### 🎬 StreamFlux — The Streaming Homepage

**What it is:** A fake Netflix-style streaming interface built with Next.js.

**What it does:**
- Shows a hero banner with a featured title ("The Social Network")
- Has "Available to Stream", "Continue Watching", and "Recommended" rows with movie posters
- Any movie in the "Available to Stream" row is playable — clicking it starts a video
- The video plays in a loop, simulating a real streaming session

**Why it matters:** This makes the demo tangible. Without it, you'd just see server nodes and logs — abstract and hard to grasp. With it, you can say "I'm streaming a movie right now" and then break the server serving it. The audience immediately understands the stakes.

**Real-world parallel:** This is literally what Netflix's CDN (Content Delivery Network) serves — the video file is split across multiple servers, routed through multiple load balancers. We simplified this to one backend, but the self-healing principle is identical.

---

### 💀 Kill Active Server Button

**What it does — in English:**
> "Simulate a server crashing completely. The server is gone. Dead. Not responding. K8s detects it and routes traffic to a standby server instantly."

**Step-by-step what happens:**

1. **User clicks Kill Active Server**
2. **Frontend (Next.js):**
   - Marks the active server node as "dead" (animated)
   - Shows a "Reconnecting to server..." buffering overlay on the video
   - Freezes/pauses the video player
   - Sends `POST /crash` to the backend
3. **Backend (FastAPI):**
   - The `/crash` endpoint tells that pod to report failure
4. **Frontend auto-recovery (immediate):**
   - Promotes a standby server to "active" status
   - Video resumes — zero downtime from the user's perspective
   - Logs: "Traffic rerouted to Server 2 — stream uninterrupted"
5. **Kubernetes (background, 5-10 seconds later):**
   - K8s's ReplicaSet notices only 2 pods exist (one was killed)
   - It schedules a new pod to restore the replica count to 3
   - The new pod boots, passes health checks, becomes a standby
   - Logs: "Server 4 online — replica count restored to 3"

**This demonstrates:**
- **Zero-downtime failover** — the video never actually stops
- **Automatic replica management** — K8s always maintains 3 pods
- **Hard Failure** handling (server completely down)

**Netflix equivalent:** This is what happens when a Netflix microservice pod crashes in production. The Kubernetes service automatically stops routing traffic to the dead pod and sends it to healthy ones. Users on Netflix never know it happened.

---

### 🐌 Slow Down Active Server (Gray Failure)

**What it does — in English:**
> "Simulate a server that's alive but performing terribly. It doesn't crash — it just responds very slowly. This is the sneaky, hard-to-detect kind of failure. K8s detects it through its health probe timeout and automatically replaces the pod."

**This is the most interesting and technically challenging feature.** A server that's slow is far more dangerous than one that's dead, because:
- Load balancers think it's alive (it responds eventually)
- Users experience buffering and degraded performance
- It's not obvious that something is wrong

**Step-by-step what happens:**

1. **User clicks 🐌 Slow Down Active Server**
2. **Frontend (Next.js):**
   - Marks the active server as "SLOW" (amber color, fast-pulsing ring)
   - Adds a blur/degradation filter to the video — simulating poor stream quality
   - Shows a countdown banner: "⏱ K8s auto-heal — 7s"
   - Sends `POST /slow` to the backend
3. **Backend (FastAPI) — the Gray Failure:**
   - Sets `slow_mode = True` globally on that pod
   - From now on, the `/health` endpoint **sleeps for 3 seconds** before responding
   - The SSE stream also slows to one message every ~4 seconds (normally 1/second)
4. **Kubernetes — the Detection:**
   - K8s runs its Liveness Probe: `GET /health` with a `timeoutSeconds: 2`
   - The `/health` response takes 3 seconds — **K8s times out at 2 seconds**
   - K8s registers this as a **FAILURE** → `Liveness probe failed: context deadline exceeded`
   - With `failureThreshold: 1`, K8s immediately sends `SIGTERM` to the container
   - After 2 seconds grace period (`terminationGracePeriodSeconds: 2`), `SIGKILL` is sent
   - The container dies. The pod restarts with a fresh process (`slow_mode = False`)
5. **Frontend — Auto-Heal Detection (the "Watchdog"):**
   - The SSE connection goes silent (pod is dead/restarting)
   - A watchdog timer checks: "Has it been 6 seconds without a heartbeat while in slow mode?"
   - After 6 seconds of silence → **auto-heal fires**
6. **Frontend — Auto-Heal Animation:**
   - Amber "SLOW" server node dies with a rotation animation
   - A standby server gets promoted to "ACTIVE"
   - Video un-blurs, quality restores
   - New standby pod spawns to restore replica count to 3
   - Live log narrates every step

**Why this is impressive:** Kubernetes automatically detected an invisible, partial failure — **without any human intervention**. This is the holy grail of production infrastructure.

**Netflix equivalent:** Netflix's Hystrix (now Resilience4j) and their chaos tooling detect "latency injection" — artificially slowing down services to test whether the system detects and recovers. Our demo does exactly this, but with actual K8s liveness probes doing the detection.

---

### ✅ Undo Slowdown (Toggle)

**What it does:** Manually removes the gray failure before K8s auto-heals it.

- Calls `POST /reset` on the backend → `slow_mode = False`
- Server node color returns to green
- Video un-blurs immediately
- Countdown timer stops

**Why it's there:** Lets you demonstrate the difference between **"what happens if you manually fix it"** vs **"what happens if you let K8s fix it automatically"**. The automatic fix is the impressive part.

---

### 🔄 Restart / Reset Cluster

**What it does:** Wipes all chaos state and restores the cluster to its initial 3-healthy-servers state.

- Calls `POST /reset` on the backend
- Resets all server nodes to standby/active state in the frontend
- Clears slow mode, buffering, paused video
- Server counter resets

**Use case:** Between demo runs — gets you back to a clean slate in 1 second.

---

### 📋 Live System Log

**What it is:** A real-time narrated log of every event happening in the system.

**Color coding:**
| Color | Meaning | Example |
|-------|---------|---------|
| 🟢 Green | Successful/OK | "Traffic rerouted — stream uninterrupted" |
| 🔴 Red | Error/failure | "Server 1 terminated" |
| 🟡 Amber | Warning/degradation | "Gray Failure injected" |
| 🔵 Blue | Boot/spawn | "Kubernetes spawning Server 4..." |
| ⚪ White | Info | "System ready. Select a title to stream." |

**Why it matters:** This is what you'd see in a real production logging system (like Datadog, Splunk, or ELK Stack). It makes the invisible visible — every Kubernetes action, every failure, every recovery is narrated in human-readable terms.

---

### 🖥️ Infrastructure Layer (Server Node Diagram)

**What it is:** An animated visualization of the 3 backend pods at the bottom of the screen.

**What you see:**
- **"You" node** (WiFi icon) on the left — represents the user/browser
- **Traffic dot** — animated green/amber dot traveling from "You" to the active server — represents live network traffic
- **3 Server nodes** — each represents one Kubernetes pod, color-coded by status

**Server states:**
| State | Color | Meaning |
|-------|-------|---------|
| ACTIVE | Green | Serving your stream right now |
| SLOW | Amber | Degraded — gray failure injected |
| STANDBY | Grey | Healthy, ready to take over |
| BOOTING | Blue (spinning) | New pod K8s just spawned |
| DEAD | Red (X icon) | Pod was killed |

**Traffic speed:** The animated dot moves **slow** in amber/slow mode and **fast** in normal mode — visually showing network degradation.

---

## 6. Cloud Computing Concepts Used

### Containerization
Packaging the FastAPI backend into a **Docker container** so it runs identically everywhere. This is the foundation of modern cloud-native applications.

### Container Orchestration
Using **Kubernetes** to manage multiple containers — deciding where they run, restarting failed ones, scaling up/down. This is what Google, Netflix, and Uber use at millions of containers per day.

### Microservices Architecture
Each backend pod is an independent **microservice** — stateless, containerized, horizontally scalable. Our 3 replicas mirror how Netflix has hundreds of independent services (User Service, Streaming Service, Recommendation Service, etc.).

### High Availability (HA)
By maintaining **3 replicas**, we ensure the service stays up even if one or two pods fail. This is the "N+1 redundancy" principle used in every production system.

### Liveness & Readiness Probes
**Liveness probe:** "Is this service alive?" — K8s kills and restarts if it fails.
**Readiness probe:** "Is this service ready to accept traffic?" — K8s removes from load balancer if it fails.
These are core Kubernetes health management tools.

### Zero-Downtime Deployment
When K8s replaces a pod, it spins up the new one **before** killing the old one (rolling update). Users experience no interruption. This is how Netflix deploys code hundreds of times per day without taking the service down.

### Self-Healing Infrastructure
The entire premise — **infrastructure that detects and repairs itself without human intervention**. This is the definition of a "resilient" or "fault-tolerant" system. K8s's ReplicaSet is constantly reconciling "desired state" (3 pods) with "actual state" (whatever is running) and making corrections.

### Chaos Engineering
The discipline of **intentionally injecting failures** to verify system resilience. Netflix invented this with Chaos Monkey. We implement two chaos modes:
- **Hard Failure** (Kill) — simulates hardware crash, network partition, OOM kill
- **Gray Failure** (Slow) — simulates CPU starvation, network degradation, memory leak

### Event-Driven Architecture
Using **Server-Sent Events (SSE)** instead of polling means the browser is event-driven — it reacts to events pushed from the server, rather than constantly asking "are you still there?" every second. This is efficient and real-time.

### Infrastructure as Code (IaC)
Our `deployment.yaml` and `service.yaml` are **declarative configuration files** — they describe the desired state of the infrastructure, and Kubernetes ensures reality matches the declaration. This is the same principle behind Terraform, Pulumi, and AWS CloudFormation.

---

## 7. What to Say During the Demo

### Opening (30 seconds)
> "Netflix has 260 million subscribers. Every day, their Chaos Monkey tool deliberately kills random servers in production — to prove the system can survive. This practice is called **Chaos Engineering**. We built a live demonstration of exactly this principle."

### Show the StreamFlux homepage
> "This is StreamFlux — our Netflix-style streaming interface. Behind this are **three independent server instances**, each running in a **Docker container**, orchestrated by **Kubernetes**."

### Kill a server
> "Watch — I'm going to kill the active server right now." *[click Kill]*
> "The video didn't stop. Kubernetes detected the failure and **automatically rerouted traffic** to a standby server in milliseconds. The standby becomes active, and K8s is already **spawning a new pod** to restore our 3-replica target."

### Explain what just happened
> "This is **zero-downtime failover**. The user never saw a buffering screen. Kubernetes's **ReplicaSet** ensures we always have exactly 3 running pods. Kill one — it makes a new one."

### Trigger slow mode
> "But here's the interesting one — **Gray Failure**. A server that's alive but sick. This is harder to detect than a crash, because the server still responds — just very slowly." *[click Slow Down]*
> "You can see the video quality degrading — the blur represents buffering and poor stream quality. Now watch the countdown — **Kubernetes is running its liveness probe every 2 seconds**. The probe times out at 2 seconds, the server takes 3 seconds to respond... so K8s registers a failure."
> *[wait for auto-heal]*
> "**K8s auto-healed it.** Without anyone touching anything. It detected the gray failure, killed the degraded container, and brought up a fresh healthy one. That's **self-healing infrastructure**."

### Closing
> "This is exactly how companies like Netflix, Uber, and Spotify operate at scale. Containerization with Docker, orchestration with Kubernetes, and Chaos Engineering to ensure resilience. We've built a production-grade demonstration of all three concepts working together."

---

## Technology Summary

| Tool | Category | Purpose |
|------|----------|---------|
| **FastAPI** | Backend Framework | REST API + SSE streaming endpoints |
| **Docker** | Containerization | Package backend into portable images |
| **Kubernetes (K8s)** | Orchestration | Deploy, manage, and heal containers |
| **Minikube** | Local K8s | Run full K8s cluster on a laptop |
| **Next.js** | Frontend Framework | StreamFlux UI + Chaos Controls panel |
| **Vercel** | Cloud CDN | Global deployment of the frontend |
| **ngrok** | Secure Tunnel | Expose local K8s to the public internet |
| **Framer Motion** | Animation | Smooth server node transitions |
| **kubectl** | K8s CLI | Control cluster, port-forward |
| **WebSockets/SSE** | Protocol | Real-time push from backend to browser |
| **Python** | Language | Backend logic |
| **JavaScript** | Language | Frontend logic |

---

*Built as a Chaos Engineering & Self-Healing Cluster demonstration project.*
*Architecture inspired by Netflix's Chaos Monkey and Google's Site Reliability Engineering (SRE) practices.*
