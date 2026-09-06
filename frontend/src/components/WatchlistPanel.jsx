// frontend/src/components/WatchlistPanel.jsx
// Upload / list / delete watchlist faces (uploads/watchlist/ via backend).
import React, { useEffect, useRef, useState } from "react";

export default function WatchlistPanel({ apiBase }) {
  const [faces, setFaces] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () =>
    fetch(`${apiBase}/api/watchlist`)
      .then((r) => {
        if (!r.ok) throw new Error('Unable to load watchlist');
        return r.json();
      })
      .then(setFaces)
      .catch(() => setFaces([]));

  useEffect(load, [apiBase]);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await fetch(`${apiBase}/api/watchlist`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      load();
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (name) => {
    if (!window.confirm(`Remove ${name} from watchlist?`)) return;
    try {
      const response = await fetch(`${apiBase}/api/watchlist/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!response.ok) throw new Error('Unable to remove face');
      load();
    } catch (error) {
      alert(`Remove failed: ${error.message}`);
    }
  };

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <h3 style={{ margin: 0 }}>Watchlist</h3>
        <label style={styles.uploadBtn}>
          {busy ? "Uploading…" : "＋ Upload face"}
          <input
            ref={fileRef}
            type="file"
            accept=".jpg,.jpeg,.png"
            hidden
            onChange={upload}
            disabled={busy}
          />
        </label>
      </div>
      {faces.length === 0 && <p style={styles.empty}>No watchlist faces yet.</p>}
      <div style={styles.grid}>
        {faces.map((f) => (
          <div key={f.name} style={styles.item}>
            <img src={`${apiBase}${f.url}`} alt={f.name} style={styles.img} />
            <div style={styles.name} title={f.name}>{f.name}</div>
            <button type="button" style={styles.del} onClick={() => remove(f.name)} aria-label={`Remove ${f.name}`}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  card: { background: "#14181f", borderRadius: 12, padding: 16, color: "#e8eaed" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  uploadBtn: {
    background: "#2f6fed", color: "#fff", borderRadius: 6,
    padding: "6px 12px", cursor: "pointer", fontSize: 13,
  },
  empty: { color: "#9aa0a6", fontSize: 13 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 10 },
  item: { position: "relative", textAlign: "center" },
  img: { width: "100%", height: 90, objectFit: "cover", borderRadius: 8, border: "1px solid #2a2f3a" },
  name: { fontSize: 11, color: "#9aa0a6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  del: {
    position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.7)",
    color: "#ff6b6b", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11,
  },
};
