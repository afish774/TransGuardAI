// frontend/src/pages/Dashboard.jsx
// Trans Guard AI Dashboard — live incidents, zone editor, watchlist panel.
import React, { useEffect, useMemo, useRef, useState } from "react";
import ZoneEditor from "../components/ZoneEditor";
import WatchlistPanel from "../components/WatchlistPanel";
import { API_BASE_URL, MEDIA_MTX_URL } from "../config";

const API_BASE = API_BASE_URL;
const WS_URL = (import.meta.env.VITE_WS_BASE || API_BASE_URL.replace(/^http/, 'ws')) + "/ws/dashboard";
const CAMERA_ID = import.meta.env.VITE_CAMERA_ID || "cam0";

const TYPE_META = {
  FALL_DETECTED: { label: "Fall Detected", color: "#ff3c3c", icon: "🚨" },
  UNATTENDED_BAGGAGE: { label: "Unattended Baggage", color: "#ffa726", icon: "🎒" },
  ZONE_INTRUSION: { label: "Zone Intrusion", color: "#ab47bc", icon: "⛔" },
  WATCHLIST_MATCH: { label: "Watchlist Match", color: "#42a5f5", icon: "👤" },
};

function IncidentCard({ inc, onAck }) {
  const meta = TYPE_META[inc.incidentType] || { label: inc.incidentType, color: "#888", icon: "⚠️" };
  return (
    <div style={{ ...styles.incident, borderLeft: `4px solid ${meta.color}`, opacity: inc.acknowledged ? 0.5 : 1 }}>
      <div style={styles.incidentHead}>
        <span>{meta.icon} <strong>{meta.label}</strong></span>
        <span style={styles.time}>{new Date(inc.timestamp).toLocaleTimeString()}</span>
      </div>
      <div style={styles.detail}>
        {inc.incidentType === "UNATTENDED_BAGGAGE" && (
          <>A <b>{inc.objectClass}</b> (track #{inc.trackId}) has been stationary for{" "}
          <b>{inc.stationarySeconds}s</b> with no person nearby.</>
        )}
        {inc.incidentType === "ZONE_INTRUSION" && (
          <>Person entered restricted zone at point [{inc.point?.map((n) => Math.round(n)).join(", ")}].</>
        )}
        {inc.incidentType === "WATCHLIST_MATCH" && (
          <>Face matched watchlist identity: <b>{inc.identity}</b>.</>
        )}
        {inc.incidentType === "FALL_DETECTED" && (
          <>Possible fall — {inc.persons} person(s) in frame. Verify immediately.</>
        )}
      </div>
      {inc.snapshot && (
        <img src={`data:image/jpeg;base64,${inc.snapshot}`} alt="snapshot" style={styles.snap} />
      )}
      {!inc.acknowledged && (
        <button style={styles.ack} onClick={() => onAck(inc._id)}>Acknowledge</button>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [incidents, setIncidents] = useState([]);
  const [filter, setFilter] = useState("ALL");
  const [zoneOpen, setZoneOpen] = useState(false);
  const [live, setLive] = useState(false);
  const wsRef = useRef(null);

  // Initial load
  useEffect(() => {
    fetch(`${API_BASE}/api/incidents?limit=100`)
      .then((r) => r.json())
      .then((data) => setIncidents(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, []);

  // Live incident feed
  useEffect(() => {
    let dead = false;
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setLive(true);
      ws.onclose = () => {
        setLive(false);
        if (!dead) setTimeout(connect, 3000); // auto-reconnect
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "incident" && msg.incident) {
            setIncidents((prev) => [msg.incident, ...prev].slice(0, 200));
          }
        } catch { /* ignore */ }
      };
    };
    connect();
    return () => { dead = true; wsRef.current?.close(); };
  }, []);

  const ack = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/incidents/${id}/ack`, { method: "PATCH" });
      if (!res.ok) throw new Error('Unable to acknowledge this incident.');
      const updated = await res.json();
      setIncidents((prev) => prev.map((i) => (i._id === id ? updated : i)));
    } catch (error) {
      console.error(error);
    }
  };

  const filtered = useMemo(
    () => (filter === "ALL" ? incidents : incidents.filter((i) => i.incidentType === filter)),
    [incidents, filter]
  );

  const counts = useMemo(() => {
    const c = {};
    for (const i of incidents) c[i.incidentType] = (c[i.incidentType] || 0) + 1;
    return c;
  }, [incidents]);

  return (
    <div style={styles.page}>
      <header style={styles.topbar}>
        <h2 style={{ margin: 0 }}>Trans Guard AI</h2>
        <span style={{ color: live ? "#4caf50" : "#ff3c3c", fontSize: 13 }}>
          ● {live ? "Live" : "Disconnected"}
        </span>
        <div style={{ flex: 1 }} />
        <button style={styles.zoneBtn} onClick={() => setZoneOpen(true)}>
          🛑 Define Zone
        </button>
      </header>

      <div style={styles.layout}>
        <main style={styles.main}>
          {/* Your existing WebRTC player stays here (MediaMTX WHEP/WebRTC) */}
          <div style={styles.player}>
            <iframe
              title="live"
              src={`${MEDIA_MTX_URL}/${CAMERA_ID}`}
              style={{ width: "100%", height: "100%", border: 0, borderRadius: 8 }}
              allow="autoplay; camera"
            />
          </div>

          <div style={styles.filters}>
            {["ALL", ...Object.keys(TYPE_META)].map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                style={{ ...styles.chip, ...(filter === t ? styles.chipActive : {}) }}
              >
                {t === "ALL" ? `All (${incidents.length})` : `${TYPE_META[t].label} (${counts[t] || 0})`}
              </button>
            ))}
          </div>

          <div style={styles.feed}>
            {filtered.length === 0 && <p style={{ color: "#9aa0a6" }}>No incidents.</p>}
            {filtered.map((inc) => (
              <IncidentCard key={inc._id} inc={inc} onAck={ack} />
            ))}
          </div>
        </main>

        <aside style={styles.side}>
          <WatchlistPanel apiBase={API_BASE} />
        </aside>
      </div>

      {zoneOpen && (
        <ZoneEditor cameraId={CAMERA_ID} apiBase={API_BASE} onClose={() => setZoneOpen(false)} />
      )}
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#0b0e13", color: "#e8eaed", fontFamily: "system-ui, sans-serif" },
  topbar: { display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: "1px solid #2a2f3a" },
  zoneBtn: { background: "#ab47bc", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer" },
  layout: { display: "flex", gap: 16, padding: 16, alignItems: "flex-start" },
  main: { flex: 1, minWidth: 0 },
  side: { width: 300, flexShrink: 0 },
  player: { aspectRatio: "16/9", background: "#000", borderRadius: 8, overflow: "hidden", marginBottom: 12 },
  filters: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  chip: { background: "#1c212b", color: "#c7ccd4", border: "1px solid #2a2f3a", borderRadius: 20, padding: "6px 12px", cursor: "pointer", fontSize: 13 },
  chipActive: { background: "#2f6fed", color: "#fff", borderColor: "#2f6fed" },
  feed: { display: "flex", flexDirection: "column", gap: 10, maxHeight: "50vh", overflowY: "auto" },
  incident: { background: "#14181f", borderRadius: 10, padding: 12 },
  incidentHead: { display: "flex", justifyContent: "space-between", marginBottom: 6 },
  time: { color: "#9aa0a6", fontSize: 12 },
  detail: { fontSize: 14, color: "#c7ccd4", marginBottom: 8 },
  snap: { width: "100%", maxWidth: 320, borderRadius: 6, border: "1px solid #2a2f3a" },
  ack: { marginTop: 8, background: "transparent", color: "#8ab4f8", border: "1px solid #8ab4f8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 },
};
