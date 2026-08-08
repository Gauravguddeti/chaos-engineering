import os
import json
import time
import asyncio
import socket
from fastapi import FastAPI
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Chaos Backend")

# Allow the frontend (running on any port) to talk to us without CORS errors
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Pod identity — each container gets its own unique hostname from Kubernetes.
# This is how we tell which replica answered a request.
# ---------------------------------------------------------------------------
POD_ID = socket.gethostname()
START_TIME = time.time()

# ---------------------------------------------------------------------------
# Global slow-mode flag.
# When True, every /stream heartbeat waits SLOW_DELAY seconds before sending.
# This simulates a degraded pod, not a dead one — a deliberately different
# failure mode from /crash.
# ---------------------------------------------------------------------------
slow_mode: bool = False
SLOW_DELAY_SECONDS: float = 3.0


# ---------------------------------------------------------------------------
# /health  — quick liveness check, used by Kubernetes liveness probe
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    if slow_mode:
        # Simulate gray failure: health check still passes, but takes 3s to respond
        await asyncio.sleep(SLOW_DELAY_SECONDS)
        
    return {
        "status": "ok",
        "pod_id": POD_ID,
        "slow_mode": slow_mode,
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "timestamp": time.time(),
    }


# ---------------------------------------------------------------------------
# /stream  — Server-Sent Events heartbeat.
#
# Why SSE instead of plain polling?
#   The browser opens ONE persistent HTTP connection here and the server
#   pushes events down it continuously. No repeated request overhead.
#   This is the "data stream that never stops" centerpiece of the demo —
#   even while a pod is dying and Kubernetes is rerouting, the client stays
#   connected and just starts receiving events from the new pod.
#
# Each event carries:
#   pod_id    — which replica is currently answering
#   counter   — monotonically increasing number (visible on screen)
#   slow_mode — whether THIS pod is currently in degraded mode
#   timestamp — Unix epoch float
# ---------------------------------------------------------------------------
@app.get("/stream")
async def stream():
    async def event_generator():
        counter = 0
        while True:
            if slow_mode:
                # Simulate degraded performance: pause before each event
                await asyncio.sleep(SLOW_DELAY_SECONDS)

            counter += 1
            payload = {
                "pod_id": POD_ID,
                "counter": counter,
                "slow_mode": slow_mode,
                "timestamp": time.time(),
            }
            # SSE format:
            #   retry: tells the browser how many ms to wait before reconnecting
            #          after a disconnect. Default is 3000ms — we set 1000ms so
            #          the UI snaps back to a healthy pod within ~1 second of K8s
            #          spinning up the replacement, making the recovery visually fast.
            #   data:  the actual JSON payload
            yield f"retry: 1000\ndata: {json.dumps(payload)}\n\n"
            await asyncio.sleep(0.8)   # ~1 heartbeat per second in normal mode

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Tells nginx/proxies: don't buffer this
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# /crash  — CHAOS ACTION 1: hard-kill this process.
#
# Why os._exit(1) instead of sys.exit()?
#   sys.exit() raises SystemExit, which Python frameworks can catch and
#   handle gracefully. os._exit() bypasses all that and immediately kills
#   the OS process — exactly what a real crash looks like.
#   Kubernetes will see the container exit with code 1, mark the pod as
#   Failed, and immediately schedule a replacement.
#
# We schedule the kill 150ms in the future so we have time to actually
# send the HTTP response back first (otherwise the client gets a connection
# error before it knows what happened).
# ---------------------------------------------------------------------------
@app.post("/crash")
async def crash():
    async def _do_crash():
        await asyncio.sleep(0.15)
        os._exit(1)

    asyncio.create_task(_do_crash())
    return {"message": "Pod is crashing now!", "pod_id": POD_ID}


# ---------------------------------------------------------------------------
# /slow  — CHAOS ACTION 2: switch this pod into degraded/slow mode.
#
# This is intentionally different from /crash:
#   - The pod stays alive and responds to Kubernetes health checks (so K8s
#     does NOT auto-replace it — the pod looks "healthy" from K8s's point
#     of view but feels broken to real users).
#   - Stream events start arriving 3 seconds apart instead of 1 second apart.
#   - On the dashboard, this shows up as visible lag, not a missing pod.
#   This is a realistic simulation of a memory-starved or overloaded service.
# ---------------------------------------------------------------------------
@app.post("/slow")
async def slow():
    global slow_mode
    slow_mode = True
    return {
        "message": "Slow mode ON — pod is now degraded",
        "pod_id": POD_ID,
        "delay_seconds": SLOW_DELAY_SECONDS,
    }


# ---------------------------------------------------------------------------
# /reset  — Turn slow mode back off (useful during demo to show recovery)
# ---------------------------------------------------------------------------
@app.post("/reset")
async def reset():
    global slow_mode
    slow_mode = False
    return {"message": "Slow mode OFF — pod is healthy again", "pod_id": POD_ID}
