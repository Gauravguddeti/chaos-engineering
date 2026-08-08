"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Server, Wifi, XCircle, Volume2, VolumeX, Play, Pause, ArrowLeft, Loader, Activity } from "lucide-react";

const API_BASE = "http://localhost:8000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── CATALOGUE ────────────────────────────────────────────
// All 5 titles — 5 are playable, rest are placeholder visual filler
const CATALOGUE = [
  { id: "spiderman", title: "The Amazing Spider-Man 2", year: 2014, poster: "/spiderman2.png", video: "/video.mp4",        playable: true  },
  { id: "topgun",    title: "Top Gun: Maverick",        year: 2022, poster: "/topgun.png",       video: "/topgun.mp4",     playable: true  },
  { id: "chhaava",   title: "Chhaava",                  year: 2025, poster: "/chhaava.png",      video: "/chhaava.mp4",    playable: true  },
  { id: "social",    title: "The Social Network",        year: 2010, poster: "/socialnetwork.png",video: "/socialnetwork.mp4", playable: true },
  { id: "rush",      title: "Rush Hour 3",               year: 2007, poster: "/rushhour3.png",   video: "/rushhour3.mp4",  playable: true  },
  // Placeholder fillers — same poster, not clickable
  { id: "ph1",  title: "Interstellar",    year: 2014, poster: "/spiderman2.png",   video: null, playable: false },
  { id: "ph2",  title: "Dune: Part Two",  year: 2024, poster: "/topgun.png",       video: null, playable: false },
  { id: "ph3",  title: "Oppenheimer",     year: 2023, poster: "/chhaava.png",      video: null, playable: false },
  { id: "ph4",  title: "The Godfather",   year: 1972, poster: "/socialnetwork.png",video: null, playable: false },
  { id: "ph5",  title: "Inception",       year: 2010, poster: "/rushhour3.png",    video: null, playable: false },
];
const PLAYABLE = CATALOGUE.filter((c) => c.playable);
const FILLER   = CATALOGUE.filter((c) => !c.playable);

// ─── SERVER STATE ─────────────────────────────────────────
const makeInitialServers = () => [
  { id: "srv-1", label: "Server 1", status: "active" },
  { id: "srv-2", label: "Server 2", status: "standby" },
  { id: "srv-3", label: "Server 3", status: "standby" },
];
let serverCounter = 4;

const STATUS_COLORS = {
  active:  "var(--healthy)",
  standby: "var(--muted)",
  slow:    "var(--slow)",
  dead:    "var(--dead)",
  booting: "var(--boot)",
};

// ─── LOG HELPERS ──────────────────────────────────────────
let logIdCounter = 0;
const pad = (n) => String(n).padStart(2, "0");
const makeLog = (msg, type = "info") => {
  const d = new Date();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return { id: logIdCounter++, msg, type, time };
};

// ═══════════════════════════════════════════════════════════
//  ROOT PAGE
// ═══════════════════════════════════════════════════════════
export default function Home() {
  const videoRef     = useRef(null);
  const logEndRef    = useRef(null);
  // Stable refs used inside the SSE handler (avoids stale closure issues)
  const isSlowModeRef     = useRef(false);
  const serversRef        = useRef([]);
  const isBusyRef         = useRef(false);
  const prevPodIdRef      = useRef(null);
  const handleAutoHealRef = useRef(null);  // always points to latest handleAutoHeal

  const [muted, setMuted]               = useState(true);
  const [isPaused, setIsPaused]         = useState(false);
  const [nowPlaying, setNowPlaying]     = useState(null);
  const [isBuffering, setIsBuffering]   = useState(false);
  const [isSlowMode, setIsSlowMode]     = useState(false);
  const [servers, setServers]           = useState(makeInitialServers);
  const [isBusy, setIsBusy]             = useState(false);
  const [countdown, setCountdown]       = useState(null);  // seconds until K8s auto-heals
  // Start logs EMPTY — initial message added in useEffect (client-only) to avoid hydration mismatch
  const [logs, setLogs]                 = useState([]);

  // Keep refs in sync with state so SSE handler always reads fresh values
  useEffect(() => { isSlowModeRef.current = isSlowMode; }, [isSlowMode]);
  useEffect(() => { serversRef.current    = servers;    }, [servers]);
  useEffect(() => { isBusyRef.current     = isBusy;     }, [isBusy]);

  // Add initial "System ready" log only on the client to avoid SSR timestamp mismatch
  useEffect(() => {
    setLogs([makeLog("System ready. Select a title to begin streaming.", "info")]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // runs once on mount (client only)

  const addLog = useCallback((msg, type = "info") => {
    setLogs((prev) => [...prev, makeLog(msg, type)]);
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // SSE — pinned to ONE pod. When the slow pod is killed by K8s, the SSE
  // drops and reconnects to a fresh healthy pod. The FIRST message from that
  // new pod has slow_mode:false — that's our reliable auto-heal signal.
  useEffect(() => {
    let justReconnected = false;
    let lastMsgTime = Date.now();

    const sse = new EventSource(`${API_BASE}/stream`);

    sse.onmessage = (e) => {
      lastMsgTime = Date.now();
      const data = JSON.parse(e.data);
      const newPodId = data.pod_id;

      // ── TRIGGER 1: pod_id changed ──────────────────────────────────────────
      const podChanged = prevPodIdRef.current && prevPodIdRef.current !== newPodId;
      // ── TRIGGER 2: first message after any reconnect ───────────────────────
      const freshConnect = justReconnected;
      justReconnected = false;
      // ── TRIGGER 3: slow_mode just flipped to false on any message ──────────
      const slowFlipped = !data.slow_mode && isSlowModeRef.current;

      if ((podChanged || freshConnect || slowFlipped) && !data.slow_mode && isSlowModeRef.current && !isBusyRef.current) {
        handleAutoHealRef.current?.();
      }

      prevPodIdRef.current = newPodId;
    };

    sse.onerror = () => {
      justReconnected = true;
      console.log("SSE dropped — reconnecting...");
    };

    // ── WATCHDOG: fires if SSE goes silent for >6s while in slow mode ────────
    // In slow mode the backend sends a heartbeat every ~3.8s. If we haven't
    // heard anything for 6s, the connection is stale (port-forward TCP can hang
    // without a clean close). We trigger auto-heal immediately instead of waiting
    // for the reconnect — this cuts the "awkward pause" from ~30s to ~0s.
    const watchdog = setInterval(() => {
      if (isSlowModeRef.current && !isBusyRef.current && Date.now() - lastMsgTime > 6000) {
        console.log("SSE watchdog: silence > 6s in slow mode — triggering auto-heal");
        handleAutoHealRef.current?.();
      }
    }, 500);

    return () => { sse.close(); clearInterval(watchdog); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // stable — reads all values via refs


  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !muted;
      setMuted((m) => !m);
    }
  };

  // ── Auto-heal triggered by SSE detection ────────────────
  // Called automatically when K8s kills the slow pod and SSE reconnects to a healthy one.
  const handleAutoHeal = useCallback(async () => {
    // Guard: don't double-fire
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setIsBusy(true);
    setCountdown(null);

    const currentServers = serversRef.current;
    const slowServer    = currentServers.find((s) => s.status === "slow");
    const standbyServer = currentServers.find((s) => s.status === "standby");

    addLog("🤖 Kubernetes detected health-check timeout — auto-healing gray failure!", "boot");

    if (slowServer) {
      setServers((prev) => prev.map((s) => s.id === slowServer.id ? { ...s, status: "dead" } : s));
    }
    await sleep(500);

    if (standbyServer) {
      setServers((prev) => prev.map((s) => s.id === standbyServer.id ? { ...s, status: "active" } : s));
    }
    setIsSlowMode(false);
    isSlowModeRef.current = false;
    if (videoRef.current) videoRef.current.play().catch(() => {});
    addLog(`Traffic restored to ${standbyServer?.label ?? "healthy server"} — video quality back to normal.`, "ok");

    await sleep(500);

    const newId    = `srv-${serverCounter++}`;
    const newLabel = `Server ${serverCounter - 1}`;
    addLog(`Kubernetes spawning ${newLabel} to restore replica count to 3...`, "boot");
    setServers((prev) => [
      ...prev.filter((s) => s.id !== slowServer?.id),
      { id: newId, label: newLabel, status: "booting" },
    ]);

    await sleep(1400);
    setServers((prev) => prev.map((s) => s.id === newId ? { ...s, status: "standby" } : s));
    addLog(`${newLabel} online — cluster fully healed. All 3 replicas healthy. ✅`, "ok");

    await sleep(800);
    isBusyRef.current = false;
    setIsBusy(false);
  }, [addLog]);

  // Keep handleAutoHealRef in sync so SSE closure always calls the latest version
  useEffect(() => { handleAutoHealRef.current = handleAutoHeal; }, [handleAutoHeal]);

  // ── Countdown timer during slow mode ───────────────────
  // Shows how many seconds until K8s auto-heals (~14s: 2 failures × (5s period + 2s timeout))
  useEffect(() => {
    if (!isSlowMode) {
      setCountdown(null);
      return;
    }
    const HEAL_SECONDS = 7;  // period=2s + timeout=2s + failureThreshold=1 + restart ~3s
    setCountdown(HEAL_SECONDS);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c === null || c <= 1) { clearInterval(interval); return null; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isSlowMode]);

  // ── /health poll — REMOVED ─────────────────────────────
  // Polling /health is unreliable because port-forward load-balances across
  // ALL 3 pods. We'd always hit a healthy pod and get slow_mode:false immediately.
  // The SSE stream (below) stays pinned to ONE pod — that's the correct signal.

  // ── Start playing a title ──────────────────────────────
  const playTitle = (title) => {
    setNowPlaying(title);
    setIsPaused(false);
    addLog(`Playing "${title.title}" — stream active.`, "ok");
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.muted = muted;
        videoRef.current.play().catch(() => {});
      }
    }, 100);
  };

  const togglePause = () => {
    if (!videoRef.current) return;
    if (isPaused) {
      videoRef.current.play().catch(() => {});
      setIsPaused(false);
    } else {
      videoRef.current.pause();
      setIsPaused(true);
    }
  };

  // ── Go back to homepage ────────────────────────────────
  const goHome = () => {
    if (videoRef.current) videoRef.current.pause();
    setNowPlaying(null);
    setIsSlowMode(false);
    setIsBuffering(false);
    setIsPaused(false);
    addLog("Stopped playback. Returned to homepage.", "info");
  };

  // ─── KILL ACTION ───────────────────────────────────────
  const triggerCrash = useCallback(async () => {
    if (isBusy || !nowPlaying) return;
    setIsBusy(true);

    const activeServer = servers.find((s) => s.status === "active" || s.status === "slow");
    // Pick the first standby — this is the pod K8s will route traffic to immediately
    const standbyServer = servers.find((s) => s.status === "standby");
    if (!activeServer) { setIsBusy(false); return; }

    addLog(`Killing ${activeServer.label}...`, "error");

    // Freeze video + buffering ring
    setIsBuffering(true);
    if (videoRef.current) videoRef.current.pause();

    // Mark active server as dead
    setServers((prev) =>
      prev.map((s) => s.id === activeServer.id ? { ...s, status: "dead" } : s)
    );
    try { await fetch(`${API_BASE}/crash`, { method: "POST" }); } catch (_) {}

    await sleep(600);
    addLog(`${activeServer.label} terminated. Re-routing traffic...`, "error");

    // STEP 2: Promote a standby to active immediately (this is zero-downtime)
    // In real K8s the load balancer already routes to healthy pods — we mirror that here.
    if (standbyServer) {
      setServers((prev) =>
        prev.map((s) => s.id === standbyServer.id ? { ...s, status: "active" } : s)
      );
      setIsBuffering(false);
      setIsPaused(false);
      if (videoRef.current) videoRef.current.play().catch(() => {});
      addLog(`Traffic rerouted to ${standbyServer.label} — stream uninterrupted.`, "ok");
    }

    await sleep(600);

    // STEP 3: Remove dead server, K8s spawns a fresh pod to restore replica count to 3
    const newId    = `srv-${serverCounter++}`;
    const newLabel = `Server ${serverCounter - 1}`;
    addLog(`Kubernetes detected missing replica — spawning ${newLabel} to restore count to 3...`, "boot");
    setServers((prev) => [
      ...prev.filter((s) => s.id !== activeServer.id),
      { id: newId, label: newLabel, status: "booting" },
    ]);

    await sleep(1400);

    // New pod finishes booting — goes to STANDBY (not active, standbys handle it)
    setServers((prev) =>
      prev.map((s) => s.id === newId ? { ...s, status: "standby" } : s)
    );
    addLog(`${newLabel} online — replica count restored to 3. ${newLabel} on standby.`, "ok");

    await sleep(1500);
    setIsBusy(false);
  }, [isBusy, nowPlaying, servers, addLog]);

  // ─── SLOW ACTION (toggle) ──────────────────────────────
  const triggerSlow = useCallback(async () => {
    if (isBusy || !nowPlaying) return;
    setIsBusy(true);

    if (isSlowMode) {
      // UNDO slow mode manually
      setIsSlowMode(false);
      setCountdown(null);
      setServers((prev) =>
        prev.map((s) => s.status === "slow" ? { ...s, status: "active" } : s)
      );
      try { await fetch(`${API_BASE}/reset`, { method: "POST" }); } catch (_) {}
      addLog("Slowdown manually removed — server restored to normal performance.", "ok");
      setIsBusy(false);
      return;
    }

    const activeServer = servers.find((s) => s.status === "active");
    if (!activeServer) { setIsBusy(false); return; }

    addLog(`Injecting latency into ${activeServer.label}...`, "warn");
    setIsSlowMode(true);
    setServers((prev) =>
      prev.map((s) => s.id === activeServer.id ? { ...s, status: "slow" } : s)
    );
    try { await fetch(`${API_BASE}/slow`, { method: "POST" }); } catch (_) {}
    addLog(`${activeServer.label} degraded (Gray Failure). K8s health probe will time out in ~7s and auto-heal!`, "warn");
    setIsBusy(false);
  }, [isBusy, nowPlaying, isSlowMode, servers, addLog]);

  // ─── RESET ACTION ──────────────────────────────────────
  const triggerReset = useCallback(async () => {
    setIsBusy(true);
    setIsBuffering(false);
    setIsSlowMode(false);
    setIsPaused(false);
    setCountdown(null);
    serverCounter = 4;
    setServers(makeInitialServers());
    if (videoRef.current) videoRef.current.play().catch(() => {});
    try { await fetch(`${API_BASE}/reset`, { method: "POST" }); } catch (_) {}
    addLog("Cluster reset — all 3 servers restored to healthy state.", "ok");
    await sleep(600);
    setIsBusy(false);
  }, [addLog]);

  // ─── DERIVED ───────────────────────────────────────────
  const isVideoPlaying = !!nowPlaying;
  const activeServer   = servers.find((s) => s.status === "active" || s.status === "slow");
  const heroTitle      = PLAYABLE[0]; // First playable = hero banner feature

  return (
    <div className="dashboard">

      {/* ── HEADER ─────────────────────────────────────── */}
      <header>
        <h1>Chaos Engineering <span className="accent">Live Demo</span></h1>
        <div className="tagline">
          <span className="live-dot" />
          Kill a server. Watch nothing break.
        </div>
      </header>

      {/* ── TOP ROW ────────────────────────────────────── */}
      <div className="top-section">

        {/* LEFT: Streaming box — homepage OR player, same box */}
        <div className={`glass-panel streaming-box ${isSlowMode ? "is-slow" : "is-normal"}`}>
          <AnimatePresence mode="wait">
            {nowPlaying ? (
              /* ── PLAYER VIEW ── */
              <motion.div
                key="player"
                className="player-view"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                {/* Topbar is NOT inside the blur wrapper — always crisp */}
                <div className="player-topbar">
                  <div className="player-controls-bar">
                    <button className="ctrl-btn back" onClick={goHome}>
                      <ArrowLeft size={13} /> Browse
                    </button>
                    <span className="player-title">{nowPlaying.title}</span>
                  </div>
                  <div className="player-controls-bar">
                    <button className="ctrl-btn" onClick={togglePause}>
                      {isPaused ? <Play size={13} fill="white" /> : <Pause size={13} />}
                      {isPaused ? "Resume" : "Pause"}
                    </button>
                    <button className="ctrl-btn" onClick={toggleMute}>
                      {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                      {muted ? "Unmute" : "Mute"}
                    </button>
                  </div>
                </div>

                {/* ONLY the video element gets the blur — overlays are outside this wrapper */}
                <div className={`video-el-wrap ${isSlowMode ? "is-slow" : ""}`}>
                  <video
                    ref={videoRef}
                    src={nowPlaying.video}
                    autoPlay
                    loop
                    muted={muted}
                    playsInline
                  />
                </div>

                {/* Buffering overlay — outside blur wrapper, always crisp */}
                <AnimatePresence>
                  {isBuffering && (
                    <motion.div
                      className="buffering-overlay"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <div className="buffer-spinner" />
                      <p>Reconnecting to server...</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

            ) : (
              /* ── STREAMING HOMEPAGE ── */
              <motion.div
                key="home"
                className="stream-home"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                {/* Hero banner featuring first playable title */}
                <div className="hero-banner">
                  <img className="hero-bg" src={heroTitle.poster} alt="" />
                  <div className="hero-overlay">
                    <div className="hero-text">
                      <div className="hero-service-name">Stream<span>Flux</span></div>
                      <div className="hero-tagline">Resilient streaming, powered by Kubernetes</div>
                    </div>
                    <button className="hero-play-btn" onClick={() => playTitle(heroTitle)}>
                      <Play size={14} fill="black" /> Play Now
                    </button>
                  </div>
                </div>

                <div className="content-rows">
                  <div className="row-label">▶ Available to Stream</div>
                  <div className="poster-row">
                    {PLAYABLE.map((title) => (
                      <div
                        key={title.id}
                        className="poster-card playable"
                        onClick={() => playTitle(title)}
                        title={`Play ${title.title}`}
                      >
                        <img src={title.poster} alt={title.title} />
                        <div className="poster-title">{title.title}</div>
                        <div className="playable-badge">▶ Play</div>
                      </div>
                    ))}
                  </div>

                  <div className="row-label">Continue Watching</div>
                  <div className="poster-row">
                    {[...PLAYABLE].reverse().map((title) => (
                      <div
                        key={`cw-${title.id}`}
                        className="poster-card playable"
                        onClick={() => playTitle(title)}
                      >
                        <img src={title.poster} alt={title.title} />
                        <div className="poster-title">{title.title}</div>
                        <div className="playable-badge">▶ Play</div>
                      </div>
                    ))}
                  </div>

                  <div className="row-label">Recommended</div>
                  <div className="poster-row">
                    {FILLER.map((title) => (
                      <div key={title.id} className="poster-card" title="Not available in demo">
                        <img src={title.poster} alt={title.title} />
                        <div className="poster-title">{title.title}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT: Controls + Live Log */}
        <div className="glass-panel controls-panel">
          <h2>Chaos Controls</h2>

          {/* Buttons ALWAYS at top */}
          <div className="btns">
            <button
              className="btn btn-crash"
              onClick={triggerCrash}
              disabled={isBusy || !isVideoPlaying}
            >
              💀 Kill Active Server
            </button>
            <button
              className={`btn ${isSlowMode ? "btn-reset" : "btn-slow"}`}
              onClick={triggerSlow}
              disabled={isBusy || !isVideoPlaying}
            >
              {isSlowMode ? "✅ Undo Slowdown" : "🐌 Slow Down Active Server"}
            </button>
            <button
              className="btn btn-reset"
              onClick={triggerReset}
              disabled={isBusy}
            >
              🔄 Restart / Reset Cluster
            </button>
          </div>

          {/* Countdown banner during slow mode */}
          {isSlowMode && (
            <div className="countdown-banner">
              <span className="countdown-label">⏱ K8s auto-heal</span>
              <span className="countdown-num">
                {countdown !== null && countdown > 0 ? `${countdown}s` : "⌛"}
              </span>
              <span className="countdown-sub">
                {countdown !== null && countdown > 0
                  ? "Health probe timing out"
                  : "Detecting... healing soon"}
              </span>
            </div>
          )}

          {/* Gate message — shown when video is NOT playing */}
          {!isVideoPlaying && (
            <div className="gate-msg">
              ⚠ Start playing a video first — select any title from the streaming homepage on the left to enable chaos controls.
            </div>
          )}

          {/* Live text log */}
          <div className="log-section">
            <div className="log-label">
              <Activity size={11} /> Live System Log
            </div>
            <div className="log-entries">
              {logs.length === 0 && (
                <div className="log-empty">No events yet.</div>
              )}
              {logs.map((entry) => (
                <div key={entry.id} className={`log-entry ${entry.type}`}>
                  <span className="log-time">{entry.time}</span>
                  <span>{entry.msg}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* ── INFRA FLOW DIAGRAM (unchanged) ─────────────── */}
      <div className="glass-panel infra-panel">
        <div className="infra-title">
          Infrastructure Layer — {servers.length} servers running
          {isVideoPlaying && nowPlaying && (
            <span style={{ color: "var(--healthy)", marginLeft: "0.75rem" }}>
              ● Streaming: {nowPlaying.title}
            </span>
          )}
        </div>

        <div className="infra-flow">
          <div className="user-node">
            <div className="user-icon-wrap"><Wifi size={20} /></div>
            <span>You</span>
          </div>

          <div className="traffic-track">
            <motion.div
              className="traffic-dot"
              style={{
                color:      isSlowMode ? "var(--slow)" : "var(--healthy)",
                background: isSlowMode ? "var(--slow)" : "var(--healthy)",
              }}
              animate={{ left: ["0%", "95%"] }}
              transition={{
                duration: isSlowMode ? 3.8 : 1.2,
                repeat:   Infinity,
                ease:     "linear",
              }}
            />
          </div>

          <div className="servers-row">
            <AnimatePresence mode="popLayout">
              {servers.map((server) => (
                <ServerNode key={server.id} server={server} />
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── SERVER NODE ─────────────────────────────────────────
function ServerNode({ server }) {
  const color    = STATUS_COLORS[server.status] || STATUS_COLORS.standby;
  const isActive  = server.status === "active";
  const isSlow    = server.status === "slow";
  const isDead    = server.status === "dead";
  const isBooting = server.status === "booting";
  const isLive    = isActive || isSlow;

  return (
    <motion.div
      className="server-node"
      layout
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: isDead ? 0.8 : 1, opacity: isDead ? 0.5 : 1 }}
      exit={{ scale: 0, opacity: 0, rotate: 10, transition: { duration: 0.4, ease: "easeIn" } }}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      style={{ "--node-color": color }}
    >
      <div
        className={`server-beam ${isLive ? "visible" : ""}`}
        style={{ "--beam-color": color }}
      />

      <div
        className="node-circle"
        style={{
          borderColor: color,
          boxShadow: isLive ? `0 0 18px ${color}55` : "none",
        }}
      >
        {isLive && (
          <motion.div
            className="pulse-ring"
            style={{ color }}
            animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: isSlow ? 1.0 : 2.0, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        {isDead    ? <XCircle size={20} color={color} /> :
         isBooting ? <Loader  size={20} color={color} /> :
                     <Server  size={20} color={color} />}
        {isBooting && <div className="boot-ring" />}
      </div>

      <div className="node-label">{server.label}</div>
      <div className="node-status" style={{ color }}>{server.status}</div>
    </motion.div>
  );
}
