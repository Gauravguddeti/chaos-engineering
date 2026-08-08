"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Server, Wifi, XCircle, Volume2, VolumeX, Play, Pause, ArrowLeft, Loader, Activity, User, Users } from "lucide-react";

const WS_BASE = "ws://localhost:8001";   // State coordinator — single source of truth

// ─── CATALOGUE ─────────────────────────────────────────────────────────────────
const CATALOGUE = [
  { id: "spiderman", title: "The Amazing Spider-Man 2", year: 2014, poster: "/spiderman2.png", video: "/video.mp4",           playable: true  },
  { id: "topgun",    title: "Top Gun: Maverick",        year: 2022, poster: "/topgun.png",       video: "/topgun.mp4",        playable: true  },
  { id: "chhaava",   title: "Chhaava",                  year: 2025, poster: "/chhaava.png",      video: "/chhaava.mp4",       playable: true  },
  { id: "social",    title: "The Social Network",        year: 2010, poster: "/socialnetwork.png",video: "/socialnetwork.mp4", playable: true  },
  { id: "rush",      title: "Rush Hour 3",               year: 2007, poster: "/rushhour3.png",   video: "/rushhour3.mp4",     playable: true  },
  { id: "ph1",  title: "Interstellar",    year: 2014, poster: "/spiderman2.png",   video: null, playable: false },
  { id: "ph2",  title: "Dune: Part Two",  year: 2024, poster: "/topgun.png",       video: null, playable: false },
  { id: "ph3",  title: "Oppenheimer",     year: 2023, poster: "/chhaava.png",      video: null, playable: false },
  { id: "ph4",  title: "The Godfather",   year: 1972, poster: "/socialnetwork.png",video: null, playable: false },
  { id: "ph5",  title: "Inception",       year: 2010, poster: "/rushhour3.png",    video: null, playable: false },
];
const PLAYABLE = CATALOGUE.filter((c) => c.playable);
const FILLER   = CATALOGUE.filter((c) => !c.playable);

// ─── SERVER STATE (initial) ────────────────────────────────────────────────────
const makeInitialServers = () => [
  { id: "srv-1", label: "Server 1", status: "active" },
  { id: "srv-2", label: "Server 2", status: "standby" },
  { id: "srv-3", label: "Server 3", status: "standby" },
];

const STATUS_COLORS = {
  active:  "var(--healthy)",
  standby: "var(--muted)",
  slow:    "var(--slow)",
  dead:    "var(--dead)",
  booting: "var(--boot)",
};

// ─── LOG HELPERS ───────────────────────────────────────────────────────────────
let logIdCounter = 0;
const pad     = (n) => String(n).padStart(2, "0");
const makeLog = (msg, type = "info") => {
  const d = new Date();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return { id: logIdCounter++, msg, type, time };
};

// ═══════════════════════════════════════════════════════════════════════════════
//  ROOT PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function Home() {
  const videoRef    = useRef(null);
  const logEndRef   = useRef(null);
  const wsRef       = useRef(null);
  const viewerIdRef = useRef(null);

  // ── Per-tab local state ────────────────────────────────────────────────────
  const [muted,      setMuted]      = useState(true);
  const [isPaused,   setIsPaused]   = useState(false);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [countdown,  setCountdown]  = useState(null);
  const [logs,       setLogs]       = useState([]);

  // ── Shared state — driven entirely by WebSocket from state server ──────────
  const [servers,     setServers]     = useState(makeInitialServers);
  const [viewers,     setViewers]     = useState([]);          // all connected viewers
  const [isSlowMode,  setIsSlowMode]  = useState(false);
  const [slowServerId,setSlowServerId]= useState(null);        // which server is slow
  const [isBuffering, setIsBuffering] = useState(false);
  const [isBusy,      setIsBusy]      = useState(false);

  // Initial log — client-only to avoid SSR hydration mismatch
  useEffect(() => {
    setLogs([makeLog("System ready. Select a title to begin streaming.", "info")]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addLog = useCallback((msg, type = "info") => {
    setLogs((prev) => [...prev, makeLog(msg, type)]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── WebSocket — single source of truth for all shared state ───────────────
  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "VIEWER_JOIN" }));
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      // Shared state update
      if (msg.state) {
        setServers(msg.state.servers);
        setViewers(msg.state.viewers || []);
        setIsSlowMode(msg.state.isSlowMode);
        setSlowServerId(msg.state.slowServerId || null);
        setIsBuffering(msg.state.isBuffering);
        setIsBusy(msg.state.isBusy);
        if (!msg.state.isSlowMode) setCountdown(null);
      }

      // Log messages broadcast by coordinator
      if (msg.log) addLog(msg.log.msg, msg.log.type);

      // Store this tab's viewer ID
      if (msg.type === "YOUR_VIEWER_ID") viewerIdRef.current = msg.viewerId;

      // We handle video pause/play in a separate useEffect watching `isBuffering` now
      // so this block is removed.
    };

    ws.onerror = (err) => console.warn("[WS] error", err);
    ws.onclose = ()    => console.log("[WS] closed");

    return () => {
      if (viewerIdRef.current && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: "VIEWER_LEAVE", viewerId: viewerIdRef.current })); } catch (_) {}
      }
      ws.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived: is THIS tab's stream degraded? ────────────────────────────────
  // #4 Degrade isolation — only blur if THIS viewer's server is slow.
  // Global isSlowMode is for button labels and countdown only.
  const myViewer         = useMemo(
    () => viewers.find((v) => v.id === viewerIdRef.current),
    [viewers]
  );
  const myServerIsSlow   = useMemo(
    () => myViewer?.serverId === slowServerId && isSlowMode,
    [myViewer, slowServerId, isSlowMode]
  );

  // ── Pause video during buffering/kill events ───────────────────────────────
  useEffect(() => {
    if (!videoRef.current) return;
    if (isBuffering) {
      videoRef.current.pause();
    } else if (!isPaused && nowPlaying) {
      videoRef.current.play().catch(() => {});
    }
  }, [isBuffering, isPaused, nowPlaying]);

  // ── Countdown during slow mode ─────────────────────────────────────────────
  useEffect(() => {
    if (!isSlowMode) { setCountdown(null); return; }
    const HEAL_SECONDS = 13;
    setCountdown(HEAL_SECONDS);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c === null || c <= 1) { clearInterval(interval); return null; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isSlowMode]);

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !muted;
      setMuted((m) => !m);
    }
  };

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

  const goHome = () => {
    if (videoRef.current) videoRef.current.pause();
    setNowPlaying(null);
    setIsPaused(false);
    addLog("Stopped playback. Returned to homepage.", "info");
  };

  // ─── KILL ACTION ────────────────────────────────────────────────────────────
  // #5 Seamless kill: video keeps playing. The buffering overlay shows visually
  // around the still-playing video — no pause/resume cycle on the video element.
  const triggerCrash = useCallback(() => {
    if (isBusy || !nowPlaying) return;
    // DO NOT pause video — it plays continuously through the kill event.
    // The infra layer + log animations tell the story without touching the video.
    wsRef.current?.send(JSON.stringify({ type: "CHAOS_KILL" }));
  }, [isBusy, nowPlaying]);

  // ─── SLOW ACTION ────────────────────────────────────────────────────────────
  const triggerSlow = useCallback(() => {
    if (isBusy || !nowPlaying) return;
    wsRef.current?.send(JSON.stringify({ type: "CHAOS_SLOW" }));
  }, [isBusy, nowPlaying]);

  // ─── RESET ACTION ───────────────────────────────────────────────────────────
  const triggerReset = useCallback(() => {
    setIsPaused(false);
    if (videoRef.current && videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    }
    wsRef.current?.send(JSON.stringify({ type: "CHAOS_RESET" }));
  }, []);

  // ─── DERIVED ────────────────────────────────────────────────────────────────
  const isVideoPlaying = !!nowPlaying;
  const heroTitle      = PLAYABLE[0];
  const activeServersCount = servers.filter(s => s.status === "active").length;

  return (
    <div className="dashboard">

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header>
        <h1>Chaos Engineering <span className="accent">Live Demo</span></h1>
        <div className="tagline">
          <span className="live-dot" />
          Kill a server. Watch nothing break.
          {viewers.length > 0 && (
            <span className="viewer-count">
              <Users size={12} /> {viewers.length} viewer{viewers.length !== 1 ? "s" : ""} connected
            </span>
          )}
        </div>
      </header>

      {/* ── TOP ROW ────────────────────────────────────────────────────────── */}
      <div className="top-section">

        {/* LEFT: Streaming box */}
        {/* #4 Fix: use myServerIsSlow (scoped to this tab's server), not global isSlowMode */}
        <div className={`glass-panel streaming-box ${myServerIsSlow ? "is-slow" : "is-normal"}`}>
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

                {/* #4 Fix: use myServerIsSlow for the blur */}
                <div className={`video-el-wrap ${myServerIsSlow ? "is-slow" : ""}`}>
                  <video
                    ref={videoRef}
                    src={nowPlaying.video}
                    autoPlay
                    loop
                    muted={muted}
                    playsInline
                  />
                </div>

                {/* Buffering overlay — shown during kill rerouting, video still plays behind it */}
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
                      <p>Rerouting to healthy server...</p>
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

          {!isVideoPlaying && (
            <div className="gate-msg">
              ⚠ Start playing a video first — select any title from the streaming homepage on the left to enable chaos controls.
            </div>
          )}

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

      {/* ── INFRA FLOW DIAGRAM ─────────────────────────────────────────────── */}
      <div className="glass-panel infra-panel">
        <div className="infra-title">
          Infrastructure Layer — {servers.length} server{servers.length !== 1 ? "s" : ""} running
          {activeServersCount > 1 && (
            <span style={{ color: "var(--boot)", marginLeft: "0.5rem" }}>
              · {activeServersCount} active (load balanced)
            </span>
          )}
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

          {/* Traffic dot speed driven by THIS tab's server, not global */}
          <div className="traffic-track">
            <motion.div
              className="traffic-dot"
              style={{
                color:      myServerIsSlow ? "var(--slow)" : "var(--healthy)",
                background: myServerIsSlow ? "var(--slow)" : "var(--healthy)",
              }}
              animate={{ left: ["0%", "95%"] }}
              transition={{
                duration: myServerIsSlow ? 3.8 : 1.2,
                repeat:   Infinity,
                ease:     "linear",
              }}
            />
          </div>

          <div className="servers-row">
            <AnimatePresence mode="popLayout">
              {servers.map((server) => (
                <ServerNode
                  key={server.id}
                  server={server}
                  viewers={viewers.filter((v) => v.serverId === server.id)}
                  myViewerId={viewerIdRef.current}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── SERVER NODE ──────────────────────────────────────────────────────────────
// #2: Accepts viewers prop. Stacks viewer pips vertically below the node circle.
function ServerNode({ server, viewers = [], myViewerId }) {
  const color     = STATUS_COLORS[server.status] || STATUS_COLORS.standby;
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

      {/* #2: Viewer pips — stacked vertically, animated in/out */}
      <div className="viewer-pips">
        <AnimatePresence initial={false}>
          {viewers.map((viewer, i) => (
            <ViewerPip
              key={viewer.id}
              viewer={viewer}
              index={i}
              isMine={viewer.id === myViewerId}
            />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── VIEWER PIP ───────────────────────────────────────────────────────────────
// Animated join/leave pip for each viewer attached to a server.
// Pop in from above, stack downward, fade+compress on remove.
function ViewerPip({ viewer, index, isMine }) {
  const STATUS_DOT = {
    ok:           "var(--healthy)",
    degraded:     "var(--slow)",
    reconnecting: "var(--dead)",
  };
  const dotColor = STATUS_DOT[viewer.status] || STATUS_DOT.ok;

  return (
    <motion.div
      className={`viewer-pip ${isMine ? "viewer-pip--mine" : ""}`}
      layout
      initial={{ opacity: 0, height: 0, y: -8 }}
      animate={{ opacity: 1, height: "auto", y: 0 }}
      exit={{ opacity: 0, height: 0, y: -8 }}
      transition={{
        layout:  { type: "spring", stiffness: 400, damping: 30 },
        default: { duration: 0.25, ease: "easeOut" },
      }}
    >
      <span className="pip-dot" style={{ background: dotColor }} />
      <User size={10} />
      <span className="pip-index">{index}</span>
      {isMine && <span className="pip-you">you</span>}
    </motion.div>
  );
}
