"""
state_server.py — Multi-User State Coordinator (v3)
=====================================================
Port 8001. Every browser tab connects here via WebSocket.
Single source of truth for all cluster state.

Key fixes vs v2:
  • Fallback heal timer fires 13s after /slow regardless of SSE pod routing
    (the SSE could be pinned to a DIFFERENT pod than the one /slow hit — v2's
    watchdog relied on SSE going silent, which never happened when SSE was on
    a healthy pod, causing the 30-second regression)
  • slowServerId in state — degradation scoped to one server, not global
  • try/finally on every chaos action — isBusy always clears even on exceptions
  • Load-based auto-scale: >3 viewers on one server → promote standby → shift viewers
  • Removed all unnecessary tail sleeps (1.5s in kill, 0.8s in auto-heal)
"""

import asyncio
import json
import uuid
import time
import os
from collections import deque
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import httpx

K8S_URL = os.environ.get("K8S_URL", "http://localhost:8000")
NGROK_HEADERS = {"ngrok-skip-browser-warning": "true"} if "ngrok" in K8S_URL else {}

# ── Tunable constants ──────────────────────────────────────────────────────────
HEAL_FALLBACK_DELAY  = 13.0   # seconds after /slow before we force auto-heal
LOAD_THRESHOLD       = 5      # viewers on ONE server that triggers extra-server activation
LOAD_CHECK_INTERVAL  = 2.0    # how often load-balance loop runs (seconds)

ADMIN_TOKEN = os.environ.get("ADMIN_KEY", "f0177230bbdac3587cbdee7114cbd897c6f7181c4c639bc8c8cf56fb13e09e14")

# ── Shared state ───────────────────────────────────────────────────────────────
state = {
    "servers": [
        {"id": "srv-1", "label": "Server 1", "status": "active"},
        {"id": "srv-2", "label": "Server 2", "status": "standby"},
        {"id": "srv-3", "label": "Server 3", "status": "standby"},
    ],
    "viewers": [],            # [{id, label, serverId, status}]  (_wsId stripped before send)
    "activeServerId": "srv-1",
    "slowServerId":   None,   # which specific server is slow (None = no slow)
    "isSlowMode":     False,
    "isBuffering":    False,
    "isBusy":         False,
    "serverCounter":  4,
    "version":        0,
}

connected: list[WebSocket] = []

# ── SSE monitor globals ────────────────────────────────────────────────────────
_last_pod_id:      str | None = None
_last_slow_mode:   bool       = False
_sse_last_msg_time: float     = time.time()

# ── Heal fallback task reference (one at a time) ───────────────────────────────
_heal_fallback_task: asyncio.Task | None = None

# ── Rate limiting ──────────────────────────────────────────────────────────────
_ip_last_join_time = {}
_global_join_timestamps = deque(maxlen=30)


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_active_servers() -> list:
    return [s for s in state["servers"] if s["status"] == "active"]

def get_active_server():
    return next((s for s in state["servers"] if s["status"] in ("active", "slow")), None)

def get_standby_server():
    return next((s for s in state["servers"] if s["status"] == "standby"), None)

def next_server_id_label() -> tuple[str, str]:
    n = state["serverCounter"]
    state["serverCounter"] += 1
    return f"srv-{n}", f"Server {n}"

def viewer_count_for(server_id: str) -> int:
    return sum(1 for v in state["viewers"] if v["serverId"] == server_id)

def assign_server_for_new_viewer() -> str:
    """Assign new viewer to the least-loaded active server."""
    active = get_active_servers()
    if not active:
        return state["activeServerId"] or "srv-1"
    counts = {s["id"]: viewer_count_for(s["id"]) for s in active}
    return min(counts, key=counts.get)

def _public_state() -> dict:
    """State safe to send to browser (strips internal _wsId)."""
    return {
        **state,
        "viewers": [
            {k: v for k, v in viewer.items() if k != "_wsId"}
            for viewer in state["viewers"]
        ],
    }


async def broadcast(event_type: str = "STATE_UPDATE", extra: dict | None = None):
    """Send full state to every connected tab. Remove dead sockets silently."""
    state["version"] += 1
    msg = {"type": event_type, "state": _public_state()}
    if extra:
        msg.update(extra)
    payload = json.dumps(msg, default=str)
    dead = []
    for ws in list(connected):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _remove_websocket(ws)


def _remove_websocket(ws: WebSocket):
    if ws in connected:
        connected.remove(ws)
    state["viewers"] = [v for v in state["viewers"] if v.get("_wsId") != id(ws)]


# ── SSE monitor ────────────────────────────────────────────────────────────────

async def monitor_k8s_sse():
    """
    Secondary signal: monitors K8s SSE stream for pod changes.
    NOTE: This alone is NOT reliable for slow-mode detection because
    kubectl port-forward may pin the SSE to a DIFFERENT pod than the one
    /slow hit. The primary heal signal is the FALLBACK TIMER in _do_slow().
    This SSE monitor acts as an EARLY trigger when routing happens to align.
    """
    global _last_pod_id, _last_slow_mode, _sse_last_msg_time

    while True:
        try:
            async with httpx.AsyncClient(timeout=None, headers=NGROK_HEADERS) as client:
                async with client.stream("GET", f"{K8S_URL}/stream") as resp:
                    print("[SSE] Connected to K8s stream")
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        try:
                            data = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue

                        _sse_last_msg_time = time.time()
                        pod_id   = data.get("pod_id")
                        slow_now = data.get("slow_mode", False)

                        pod_changed  = _last_pod_id is not None and pod_id != _last_pod_id
                        slow_flipped = _last_slow_mode and not slow_now

                        if (pod_changed or slow_flipped) and state["isSlowMode"] and not state["isBusy"]:
                            print(f"[SSE] Early heal signal: pod={pod_id}, slow={slow_now}")
                            asyncio.create_task(_do_auto_heal())

                        _last_pod_id   = pod_id
                        _last_slow_mode = slow_now

        except Exception as e:
            print(f"[SSE] Stream dropped ({e}), retrying in 1s…")
            await asyncio.sleep(1)





# ── Load-balance loop ─────────────────────────────────────────────────────────

async def load_balance_loop():
    """
    Runs every 2s. If any active server has > LOAD_THRESHOLD viewers,
    promote a standby to active and redistribute some viewers to it.
    When load drops, demote the extra server back to standby.
    """
    while True:
        await asyncio.sleep(LOAD_CHECK_INTERVAL)

        if state["isBusy"] or state["isSlowMode"]:
            continue

        active_servers = get_active_servers()
        if not active_servers:
            continue

        # Check if any server is overloaded
        overloaded = next(
            (s for s in active_servers if viewer_count_for(s["id"]) > LOAD_THRESHOLD),
            None
        )

        if overloaded:
            standby = get_standby_server()
            if standby:
                await _activate_load_server(overloaded, standby)
        else:
            # If more than 1 active and no server overloaded, try to scale back
            if len(active_servers) > 1:
                primary_id = state["activeServerId"]
                # Pick the extra active server (not the primary)
                extra = next((s for s in active_servers if s["id"] != primary_id), None)
                if extra and viewer_count_for(extra["id"]) == 0:
                    await _deactivate_load_server(extra)

        # ── Dynamic Pool Capacity (Maintain exactly 2 standbys) ──
        standbys = [s for s in state["servers"] if s["status"] == "standby"]
        if len(standbys) < 2:
            needed = 2 - len(standbys)
            for _ in range(needed):
                new_id, new_label = next_server_id_label()
                state["servers"].append({"id": new_id, "label": new_label, "status": "standby"})
            await broadcast("POOL_GROWN", {"log": {"msg": f"📈 Pool grown to maintain standby capacity.", "type": "info"}})
        elif len(standbys) > 2:
            excess = len(standbys) - 2
            for _ in range(excess):
                s = next((s for s in reversed(state["servers"]) if s["status"] == "standby"), None)
                if s:
                    state["servers"].remove(s)
            await broadcast("POOL_SHRUNK", {"log": {"msg": f"📉 Pool shrunk to remove excess capacity.", "type": "info"}})


async def _activate_load_server(overloaded, new_active):
    """Promote a standby server and shift half the overloaded server's viewers."""
    state["isBusy"] = True
    try:
        new_active["status"] = "active"
        await broadcast("LOAD_SCALE_UP", {
            "log": {
                "msg": f"⚡ Load threshold exceeded — activating {new_active['label']} to distribute traffic.",
                "type": "boot"
            }
        })

        await asyncio.sleep(0.3)

        # Shift half of overloaded server's viewers to new server
        ovl_viewers = [v for v in state["viewers"] if v["serverId"] == overloaded["id"]]
        to_shift = ovl_viewers[:len(ovl_viewers) // 2]
        for v in to_shift:
            v["serverId"] = new_active["id"]
            v["status"]   = "ok"

        await asyncio.sleep(0.3)

        await broadcast("LOAD_REDISTRIBUTED", {
            "log": {
                "msg": f"↔ {len(to_shift)} viewer(s) shifted to {new_active['label']} — load balanced.",
                "type": "ok"
            }
        })
    finally:
        state["isBusy"] = False
        await broadcast()


async def _deactivate_load_server(server):
    """Move viewers back to primary and put extra server back to standby."""
    state["isBusy"] = True
    try:
        primary_id = state["activeServerId"]
        # Move all viewers from this server to primary
        for v in state["viewers"]:
            if v["serverId"] == server["id"]:
                v["serverId"] = primary_id
                v["status"]   = "ok"

        await asyncio.sleep(0.3)
        server["status"] = "standby"
        await broadcast("LOAD_SCALE_DOWN", {
            "log": {
                "msg": f"📉 Load reduced — {server['label']} returned to standby.",
                "type": "info"
            }
        })
    finally:
        state["isBusy"] = False
        await broadcast()


# ── Chaos action implementations ───────────────────────────────────────────────

async def _do_kill():
    if state["isBusy"]:
        return
    state["isBusy"] = True

    try:
        active  = get_active_server()
        standby = get_standby_server()
        if not active:
            return

        dead_id    = active["id"]
        dead_label = active["label"]

        active["status"]     = "dead"
        state["isBuffering"] = True
        for v in state["viewers"]:
            if v["serverId"] == dead_id:
                v["status"] = "reconnecting"

        await broadcast("CHAOS_KILL", {
            "log": {"msg": f"💀 Killing {dead_label}…", "type": "error"}
        })

        async with httpx.AsyncClient(headers=NGROK_HEADERS) as c:
            try:
                await c.post(f"{K8S_URL}/crash", timeout=5)
            except Exception:
                pass

        await asyncio.sleep(0.5)

        # Promote standby → active (zero-downtime reroute)
        if standby:
            standby["status"]       = "active"
            state["activeServerId"] = standby["id"]
            state["isBuffering"]    = False
            for v in state["viewers"]:
                if v.get("status") == "reconnecting":
                    v["serverId"] = standby["id"]
                    v["status"]   = "ok"
            await broadcast("TRAFFIC_REROUTED", {
                "log": {
                    "msg": f"{dead_label} terminated. Traffic rerouted to {standby['label']} — stream uninterrupted. ✅",
                    "type": "ok"
                }
            })

        await asyncio.sleep(0.5)

        # Spawn replacement pod
        new_id, new_label = next_server_id_label()
        state["servers"] = [s for s in state["servers"] if s["id"] != dead_id]
        state["servers"].append({"id": new_id, "label": new_label, "status": "booting"})
        await broadcast("SERVER_BOOTING", {
            "log": {
                "msg": f"🔄 Kubernetes spawning {new_label} to restore replica count to 3…",
                "type": "boot"
            }
        })

        await asyncio.sleep(1.4)

        for s in state["servers"]:
            if s["id"] == new_id:
                s["status"] = "standby"
        await broadcast("SERVER_READY", {
            "log": {
                "msg": f"{new_label} online — cluster fully restored. All 3 replicas healthy. ✅",
                "type": "ok"
            }
        })

    finally:
        state["isBusy"] = False
        await broadcast()


async def _do_slow():
    if state["isBusy"]:
        return
    state["isBusy"] = True

    try:
        active = get_active_server()
        if not active:
            return

        active["status"]      = "slow"
        state["isSlowMode"]   = True
        state["slowServerId"] = active["id"]
        state["activeServerId"] = active["id"]

        # Only degrade viewers on THIS server (not all viewers)
        for v in state["viewers"]:
            if v["serverId"] == active["id"]:
                v["status"] = "degraded"

        async with httpx.AsyncClient(headers=NGROK_HEADERS) as c:
            try:
                await c.post(f"{K8S_URL}/slow", timeout=5)
            except Exception:
                pass

        await broadcast("CHAOS_SLOW", {
            "log": {
                "msg": f"🐌 {active['label']} degraded (Gray Failure). K8s health probe will time out in ~7s and auto-heal!",
                "type": "warn"
            }
        })

        # ── PRIMARY HEAL SIGNAL: Fallback timer ─────────────────────────────
        # The SSE monitor may not detect the pod change if /slow hit a different
        # pod than the one SSE is subscribed to. This timer guarantees auto-heal
        # fires within HEAL_FALLBACK_DELAY seconds regardless of SSE routing.
        global _heal_fallback_task
        if _heal_fallback_task and not _heal_fallback_task.done():
            _heal_fallback_task.cancel()
        _heal_fallback_task = asyncio.create_task(_heal_fallback(HEAL_FALLBACK_DELAY))

    finally:
        state["isBusy"] = False
        await broadcast()


async def _heal_fallback(delay: float):
    """Fire auto-heal after `delay` seconds if still needed."""
    await asyncio.sleep(delay)
    if state["isSlowMode"] and not state["isBusy"]:
        print(f"[Fallback] {delay}s elapsed, still slow — auto-healing now")
        await _do_auto_heal()


async def _do_undo_slow():
    """Manually cancel slow mode before K8s auto-heals."""
    if state["isBusy"]:
        return
    state["isBusy"] = True

    # Cancel fallback timer since user is manually undoing
    global _heal_fallback_task
    if _heal_fallback_task and not _heal_fallback_task.done():
        _heal_fallback_task.cancel()

    try:
        for s in state["servers"]:
            if s["status"] == "slow":
                s["status"] = "active"
        state["isSlowMode"]   = False
        state["slowServerId"] = None
        for v in state["viewers"]:
            if v.get("status") == "degraded":
                v["status"] = "ok"

        async with httpx.AsyncClient(headers=NGROK_HEADERS) as c:
            try:
                await c.post(f"{K8S_URL}/reset", timeout=5)
            except Exception:
                pass

        await broadcast("SLOW_UNDONE", {
            "log": {"msg": "✅ Slowdown manually removed — server restored to normal.", "type": "ok"}
        })
    finally:
        state["isBusy"] = False
        await broadcast()


async def _do_auto_heal():
    """
    K8s has killed the slow pod. Reflect the heal: reroute viewers to standby,
    spawn replacement pod, clear slow flags.
    Called by: SSE monitor, watchdog, OR fallback timer — whichever fires first.
    """
    if state["isBusy"]:
        return
    state["isBusy"] = True

    # Cancel fallback timer (we're already healing), unless this IS the fallback timer
    global _heal_fallback_task
    if _heal_fallback_task and not _heal_fallback_task.done():
        if _heal_fallback_task != asyncio.current_task():
            _heal_fallback_task.cancel()

    try:
        slow_server = next((s for s in state["servers"] if s["status"] == "slow"), None)
        standby     = get_standby_server()

        if not slow_server:
            return

        slow_id    = slow_server["id"]
        slow_label = slow_server["label"]

        await broadcast("AUTO_HEAL_START", {
            "log": {
                "msg": "🤖 Kubernetes detected health-check timeout — auto-healing gray failure!",
                "type": "boot"
            }
        })

        slow_server["status"] = "dead"
        await asyncio.sleep(0.4)

        if standby:
            standby["status"]       = "active"
            state["activeServerId"] = standby["id"]
            state["isSlowMode"]     = False
            state["slowServerId"]   = None
            for v in state["viewers"]:
                if v["serverId"] == slow_id:
                    v["serverId"] = standby["id"]
                    v["status"]   = "ok"
            await broadcast("AUTO_HEAL_REROUTE", {
                "log": {
                    "msg": f"Traffic restored to {standby['label']} — video quality back to normal. ✅",
                    "type": "ok"
                }
            })
        else:
            state["isSlowMode"]   = False
            state["slowServerId"] = None

        await asyncio.sleep(0.4)

        # Spawn replacement
        new_id, new_label = next_server_id_label()
        state["servers"] = [s for s in state["servers"] if s["id"] != slow_id]
        state["servers"].append({"id": new_id, "label": new_label, "status": "booting"})
        await broadcast("SERVER_BOOTING", {
            "log": {
                "msg": f"🔄 Kubernetes spawning {new_label} to restore replica count to 3…",
                "type": "boot"
            }
        })

        await asyncio.sleep(1.2)

        for s in state["servers"]:
            if s["id"] == new_id:
                s["status"] = "standby"
        await broadcast("SERVER_READY", {
            "log": {
                "msg": f"{new_label} online — cluster fully healed. All 3 replicas healthy. ✅",
                "type": "ok"
            }
        })

    finally:
        state["isBusy"] = False
        await broadcast()


async def _do_reset():
    state["isBusy"] = True

    global _heal_fallback_task
    if _heal_fallback_task and not _heal_fallback_task.done():
        _heal_fallback_task.cancel()

    try:
        state["servers"] = [
            {"id": "srv-1", "label": "Server 1", "status": "active"},
            {"id": "srv-2", "label": "Server 2", "status": "standby"},
            {"id": "srv-3", "label": "Server 3", "status": "standby"},
        ]
        state["activeServerId"] = "srv-1"
        state["isSlowMode"]     = False
        state["slowServerId"]   = None
        state["isBuffering"]    = False
        state["serverCounter"]  = 4
        for v in state["viewers"]:
            v["serverId"] = "srv-1"
            v["status"]   = "ok"

        async with httpx.AsyncClient() as c:
            try:
                await c.post(f"{K8S_URL}/reset", timeout=5)
            except Exception:
                pass

        await broadcast("CHAOS_RESET", {
            "log": {"msg": "🔄 Cluster reset — all 3 servers restored to healthy state.", "type": "ok"}
        })
    finally:
        state["isBusy"] = False
        await broadcast()


# ── WebSocket message router ───────────────────────────────────────────────────

async def handle_message(data: dict, ws: WebSocket):
    t = data.get("type")

    if t == "VIEWER_JOIN":
        now = time.time()
        ip = ws.client.host if ws.client else "unknown"
        
        # Global limit: 200 joins per 60s (Plenty for a 30-person class refreshing a few times)
        while _global_join_timestamps and now - _global_join_timestamps[0] > 60:
            _global_join_timestamps.popleft()
            
        if len(_global_join_timestamps) >= 200:
            return
            
        _global_join_timestamps.append(now)

        sid = assign_server_for_new_viewer()
        viewer = {
            "id":       str(uuid.uuid4())[:8],
            "label":    data.get("label", "Viewer"),
            "serverId": sid,
            "status":   "ok",
            "_wsId":    id(ws),
        }
        state["viewers"].append(viewer)
        await broadcast("VIEWER_JOINED", {"viewerId": viewer["id"]})
        try:
            await ws.send_text(json.dumps({
                "type": "YOUR_VIEWER_ID", "viewerId": viewer["id"]
            }))
        except Exception:
            pass

    elif t == "VIEWER_LEAVE":
        vid = data.get("viewerId")
        state["viewers"] = [v for v in state["viewers"] if v["id"] != vid]
        await broadcast("VIEWER_LEFT", {"viewerId": vid})


# ── FastAPI app ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    t1 = asyncio.create_task(monitor_k8s_sse())
    t2 = asyncio.create_task(load_balance_loop())
    yield
    t1.cancel(); t2.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected.append(websocket)
    try:
        await websocket.send_text(json.dumps({"type": "STATE_UPDATE", "state": _public_state()}))
        while True:
            data = await websocket.receive_json()
            await handle_message(data, websocket)
    except WebSocketDisconnect:
        _remove_websocket(websocket)
        await broadcast()


# ── Secure Admin Endpoints ─────────────────────────────────────────────────────

def _verify_admin(x_admin_token: str | None = Header(None)):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Forbidden")

@app.post("/admin/kill")
async def admin_kill(x_admin_token: str | None = Header(None)):
    _verify_admin(x_admin_token)
    asyncio.create_task(_do_kill())
    return {"status": "ok"}

@app.post("/admin/slow")
async def admin_slow(x_admin_token: str | None = Header(None)):
    _verify_admin(x_admin_token)
    if state["isSlowMode"]:
        asyncio.create_task(_do_undo_slow())
    else:
        asyncio.create_task(_do_slow())
    return {"status": "ok"}

@app.post("/admin/reset")
async def admin_reset(x_admin_token: str | None = Header(None)):
    _verify_admin(x_admin_token)
    asyncio.create_task(_do_reset())
    return {"status": "ok"}


@app.get("/ping")
async def ping():
    return {
        "status": "ok",
        "connections": len(connected),
        "viewers": len(state["viewers"]),
        "isSlowMode": state["isSlowMode"],
        "isBusy": state["isBusy"],
        "state_version": state["version"],
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
