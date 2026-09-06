// frontend/src/components/ZoneEditor.jsx
// "Define Zone" overlay: click on the video frame to place polygon vertices,
// then save -> PUT /api/zones/:cameraId -> backend pushes it to the engine.
import React, { useEffect, useRef, useState } from "react";

const ENGINE_W = 1280; // must match trans_guard_engine.py --width
const ENGINE_H = 720;  // must match trans_guard_engine.py --height

export default function ZoneEditor({ cameraId, apiBase, onClose }) {
  const canvasRef = useRef(null);
  const [points, setPoints] = useState([]); // engine pixel coords
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  // Load existing zone
  useEffect(() => {
    fetch(`${apiBase}/api/zones/${cameraId}`)
      .then((r) => r.json())
      .then((z) => setPoints(z.polygon || []))
      .catch(() => {});
  }, [cameraId, apiBase]);

  // Redraw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sx = canvas.width / ENGINE_W;
    const sy = canvas.height / ENGINE_H;

    if (points.length > 0) {
      ctx.beginPath();
      points.forEach(([x, y], i) => {
        const px = x * sx, py = y * sy;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      if (points.length >= 3) ctx.closePath();
      ctx.fillStyle = "rgba(255, 60, 60, 0.25)";
      ctx.strokeStyle = "#ff3c3c";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      points.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x * sx, y * sy, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
      });
    }
  }, [points]);

  const handleClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * ENGINE_W;
    const y = ((e.clientY - rect.top) / rect.height) * ENGINE_H;
    setPoints((p) => [...p, [Math.round(x), Math.round(y)]]);
  };

  const save = async () => {
    if (points.length > 0 && points.length < 3) {
      setStatus("A polygon needs at least 3 points.");
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch(`${apiBase}/api/zones/${cameraId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ polygon: points, name: "Restricted Zone", active: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus(points.length ? "Zone saved and pushed to engine." : "Zone cleared.");
      setTimeout(onClose, 600);
    } catch (e) {
      setStatus(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <h3 style={{ margin: 0 }}>Define Restricted Zone — {cameraId}</h3>
        <p style={styles.hint}>
          Click on the frame to add vertices (minimum 3). The polygon is pushed
          live to the edge engine.
        </p>
        {/* Layer this canvas over your live <video>/WebRTC player if desired;
            here it is a coordinate plane in the engine's 1280x720 space. */}
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          onClick={handleClick}
          style={styles.canvas}
        />
        <div style={styles.row}>
          <button onClick={() => setPoints((p) => p.slice(0, -1))} disabled={!points.length}>
            Undo point
          </button>
          <button onClick={() => setPoints([])} disabled={!points.length}>
            Clear
          </button>
          <button onClick={save} disabled={saving} style={styles.primary}>
            {saving ? "Saving…" : "Save zone"}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
        {status && <p style={styles.status}>{status}</p>}
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  modal: {
    background: "#14181f", color: "#e8eaed", padding: 20, borderRadius: 12,
    width: 700, maxWidth: "95vw",
  },
  hint: { color: "#9aa0a6", fontSize: 13 },
  canvas: {
    width: "100%", background: "#0b0e13", border: "1px solid #2a2f3a",
    borderRadius: 8, cursor: "crosshair", display: "block",
  },
  row: { display: "flex", gap: 8, marginTop: 12 },
  primary: { background: "#ff3c3c", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px" },
  status: { color: "#8ab4f8", fontSize: 13, marginTop: 8 },
};
