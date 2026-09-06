import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ImagePlus, LoaderCircle, Plus,
  ShieldAlert, UploadCloud, Video, WifiOff, X,
} from 'lucide-react';
import { API_BASE_URL, MEDIA_MTX_HLS_URL, MEDIA_MTX_URL } from '../config';

const zoneStroke = '#f97316';

function apiHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function incidentValue(incident, key) {
  return incident?.metadata?.[key] ?? incident?.[key];
}

function formatPoint(value) {
  const point = Array.isArray(value) ? value : null;
  return point && point.length === 2
    ? `(${Number(point[0]).toFixed(0)}, ${Number(point[1]).toFixed(0)})`
    : 'Not recorded';
}

function evidenceUrl(incident) {
  if (!incident?.evidence_image_url) return null;
  return incident.evidence_image_url.startsWith('/')
    ? `${API_BASE_URL}${incident.evidence_image_url}`
    : incident.evidence_image_url;
}

function incidentDescription(incident) {
  const type = incident.incident_type;
  if (type === 'UNATTENDED_BAGGAGE') {
    const objectClass = incidentValue(incident, 'objectClass') || 'object';
    const duration = incidentValue(incident, 'stationarySeconds');
    return `Unattended ${objectClass}${duration !== undefined ? ` for ${Number(duration).toFixed(1)} seconds` : ''}.`;
  }
  if (type === 'ZONE_INTRUSION') {
    return `Restricted-zone entry detected at ${formatPoint(incidentValue(incident, 'point'))}.`;
  }
  if (type === 'WATCHLIST_MATCH') {
    return `Potential watchlist match: ${incidentValue(incident, 'identity') || 'unknown identity'}.`;
  }
  if (type === 'FALL_DETECTED') {
    return `Possible fall detected${incidentValue(incident, 'persons') ? ` with ${incidentValue(incident, 'persons')} person(s) in frame` : ''}.`;
  }
  return incident.incident_type || 'Incident detected.';
}

function ZoneEditor({ cameraId, token, onClose }) {
  const overlayRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const pointAtEvent = useCallback((event) => {
    const rect = overlayRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }, []);

  const closestPointIndex = useCallback((point) => {
    const threshold = 0.028;
    let index = -1;
    let bestDistance = Infinity;
    points.forEach((candidate, candidateIndex) => {
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance < threshold && distance < bestDistance) {
        index = candidateIndex;
        bestDistance = distance;
      }
    });
    return index;
  }, [points]);

  const onPointerDown = (event) => {
    event.preventDefault();
    const point = pointAtEvent(event);
    const existingIndex = closestPointIndex(point);
    if (existingIndex >= 0) {
      setDraggedIndex(existingIndex);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    setPoints((current) => [...current, point]);
  };

  const onPointerMove = (event) => {
    if (draggedIndex === null) return;
    const point = pointAtEvent(event);
    setPoints((current) => current.map((existing, index) => (index === draggedIndex ? point : existing)));
  };

  const stopDragging = (event) => {
    if (draggedIndex !== null && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggedIndex(null);
  };

  const saveZone = async () => {
    if (points.length < 3) {
      setError('Add at least three points to create a zone.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/edge/zone`, {
        method: 'POST',
        headers: { ...apiHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera_id: cameraId,
          polygon: points.map((point) => [Number(point.x.toFixed(6)), Number(point.y.toFixed(6))]),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to save the zone.');
      setMessage('Zone saved. The edge worker will apply it on its next poll.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const svgPoints = points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ');

  return (
    <div className="fixed inset-0 z-[2000] bg-black/80 p-4 flex items-center justify-center">
      <div className="w-full max-w-5xl bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
          <div>
            <h2 className="font-bold text-white">Define restricted zone — {cameraId}</h2>
            <p className="text-xs text-zinc-400 mt-1">Click to add vertices; drag a vertex to refine it. Coordinates are stored normalized to the video frame.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-zinc-400 hover:text-white" aria-label="Close zone editor"><X size={20} /></button>
        </div>

        <div className="p-5">
          <div className="relative aspect-video rounded-xl overflow-hidden bg-black border border-white/10">
            <LiveVideo cameraId={cameraId} compact />
            <svg
              ref={overlayRef}
              className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={stopDragging}
              onPointerCancel={stopDragging}
            >
              {points.length >= 2 && <polyline points={svgPoints} fill="rgba(249,115,22,0.20)" stroke={zoneStroke} strokeWidth="0.55" />}
              {points.length >= 3 && <polygon points={svgPoints} fill="rgba(249,115,22,0.20)" stroke={zoneStroke} strokeWidth="0.55" />}
              {points.map((point, index) => (
                <g key={index}>
                  <circle cx={point.x * 100} cy={point.y * 100} r="1.4" fill="#fff" stroke={zoneStroke} strokeWidth="0.6" />
                  <text x={point.x * 100 + 1.7} y={point.y * 100 - 1.7} fill="#fff" fontSize="3.2">{index + 1}</text>
                </g>
              ))}
            </svg>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-zinc-400">{points.length} point{points.length === 1 ? '' : 's'} defined</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length} className="px-3 py-2 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/15 disabled:opacity-40">Undo</button>
              <button type="button" onClick={() => setPoints([])} disabled={!points.length} className="px-3 py-2 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/15 disabled:opacity-40">Clear</button>
              <button type="button" onClick={saveZone} disabled={saving} className="px-4 py-2 rounded-lg text-xs font-bold bg-orange-500 hover:bg-orange-400 text-white disabled:opacity-60 flex items-center gap-2">
                {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />} Save zone
              </button>
            </div>
          </div>
          {message && <p className="mt-3 text-sm text-emerald-400">{message}</p>}
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function WatchlistUploadModal({ token, onClose, onUploaded }) {
  const [name, setName] = useState('');
  const [image, setImage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!image) {
      setError('Choose a JPEG, PNG, or WebP target image.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('image', image);
      const response = await fetch(`${API_BASE_URL}/api/watchlist`, {
        method: 'POST',
        headers: apiHeaders(token),
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to upload watchlist target.');
      onUploaded(data.target);
      onClose();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-black/80 p-4 flex items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
          <div>
            <h2 className="font-bold text-white">Add watchlist target</h2>
            <p className="text-xs text-zinc-400 mt-1">Upload a clear, front-facing reference image.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-zinc-400 hover:text-white" aria-label="Close watchlist upload"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wide text-zinc-400 mb-1.5">Identity name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. John Smith" />
          </label>
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wide text-zinc-400 mb-1.5">Reference image</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => setImage(event.target.files?.[0] || null)} className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-white/15" />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button disabled={saving} className="w-full flex justify-center items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 py-2.5 text-sm font-bold text-white">
            {saving ? <LoaderCircle size={16} className="animate-spin" /> : <UploadCloud size={16} />} Upload target
          </button>
        </div>
      </form>
    </div>
  );
}

function LiveVideo({ cameraId, compact = false }) {
  const videoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const [state, setState] = useState('connecting');
  const [mode, setMode] = useState('WebRTC');

  const cleanup = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
    }
  }, []);

  const useHls = useCallback(() => {
    cleanup();
    setMode('HLS');
    setState('live');
    if (videoRef.current) {
      videoRef.current.src = `${MEDIA_MTX_HLS_URL}/cam/${cameraId}/index.m3u8`;
      videoRef.current.play().catch(() => setState('offline'));
    }
  }, [cameraId, cleanup]);

  const connect = useCallback(async () => {
    cleanup();
    setState('connecting');
    setMode('WebRTC');
    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peerConnectionRef.current = peerConnection;
      peerConnection.addTransceiver('video', { direction: 'recvonly' });
      peerConnection.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setState('live');
        }
      };
      peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'failed') useHls();
        if (peerConnection.iceConnectionState === 'disconnected') setState('reconnecting');
      };
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const response = await fetch(`${MEDIA_MTX_URL}/cam/${cameraId}/whep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: peerConnection.localDescription.sdp,
      });
      if (!response.ok) throw new Error(`WHEP failed: ${response.status}`);
      await peerConnection.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    } catch {
      useHls();
    }
  }, [cameraId, cleanup, useHls]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  return (
    <div className="absolute inset-0 bg-black">
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
      {!compact && (
        <div className="absolute left-3 right-3 bottom-3 flex items-center justify-between pointer-events-none">
          <span className="rounded bg-black/70 px-2 py-1 text-[10px] font-bold uppercase text-white">{mode}</span>
          {state !== 'live' && <span className="rounded bg-black/70 px-2 py-1 text-[10px] font-bold uppercase text-amber-300">{state}</span>}
        </div>
      )}
    </div>
  );
}

export function DashboardOperationsView({ cameras, token }) {
  const [selectedCameraId, setSelectedCameraId] = useState(cameras[0]?.camera_id || 'cam0');
  const [zoneOpen, setZoneOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [uploadedTarget, setUploadedTarget] = useState(null);
  const cameraId = cameras.some((camera) => camera.camera_id === selectedCameraId)
    ? selectedCameraId
    : cameras[0]?.camera_id || 'cam0';

  return (
    <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-5 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">Live safety operations</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Configure camera zones and manage watchlist identities.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setWatchlistOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-800 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"><ImagePlus size={15} /> Add target</button>
            <button type="button" onClick={() => setZoneOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-400"><ShieldAlert size={15} /> Define zone</button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900/80">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-white/10">
            <div className="flex items-center gap-2">
              <Video size={16} className="text-indigo-500" />
              <select value={cameraId} onChange={(event) => setSelectedCameraId(event.target.value)} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm font-bold text-gray-800 dark:border-white/10 dark:bg-zinc-950 dark:text-white">
                {(cameras.length ? cameras : [{ camera_id: 'cam0', status: 'UNKNOWN' }]).map((camera) => <option key={camera.camera_id} value={camera.camera_id}>{camera.camera_id} — {camera.status}</option>)}
              </select>
            </div>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Live stream</span>
          </div>
          <div className="relative aspect-video bg-black">
            <LiveVideo cameraId={cameraId} />
          </div>
        </div>
        {uploadedTarget && <p className="mt-4 rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">Uploaded {uploadedTarget.name}. Edge nodes will receive it at their next watchlist sync.</p>}
      </div>

      {zoneOpen && <ZoneEditor cameraId={cameraId} token={token} onClose={() => setZoneOpen(false)} />}
      {watchlistOpen && <WatchlistUploadModal token={token} onClose={() => setWatchlistOpen(false)} onUploaded={setUploadedTarget} />}
    </main>
  );
}

export function WatchlistView({ token }) {
  const [open, setOpen] = useState(false);
  const [lastTarget, setLastTarget] = useState(null);
  return (
    <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-5 md:p-8">
      <div className="mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-900/80">
        <div className="flex items-start justify-between gap-4">
          <div><h1 className="text-2xl font-black text-gray-900 dark:text-white">Watchlist queue</h1><p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Add a reference image for edge-side identity matching.</p></div>
          <button type="button" onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500"><Plus size={15} /> Add target</button>
        </div>
        {lastTarget && <p className="mt-6 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">Uploaded {lastTarget.name}. Edge nodes will receive it at their next watchlist sync.</p>}
      </div>
      {open && <WatchlistUploadModal token={token} onClose={() => setOpen(false)} onUploaded={setLastTarget} />}
    </main>
  );
}

export function IncidentLogView({ alerts }) {
  return (
    <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-5 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6"><h1 className="text-2xl font-black text-gray-900 dark:text-white">Incident logs</h1><p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Live incidents and edge-supplied detection metadata.</p></div>
        <div className="space-y-3">
          {alerts.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">No incidents have been received.</div>}
          {alerts.map((incident) => {
            const image = evidenceUrl(incident);
            return (
              <article key={incident.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900/80">
                <div className="flex flex-col gap-4 p-4 sm:flex-row">
                  {image ? <img src={image} alt="Incident evidence" className="h-36 w-full rounded-lg bg-black object-cover sm:w-56" /> : <div className="flex h-36 w-full items-center justify-center rounded-lg bg-zinc-950 text-zinc-500 sm:w-56"><WifiOff size={25} /></div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-2.5 py-1 text-[11px] font-black text-orange-600 dark:text-orange-300"><AlertTriangle size={13} /> {incident.incident_type}</span>
                      <time className="text-xs font-medium text-gray-500 dark:text-zinc-400">{new Date(incident.timestamp).toLocaleString()}</time>
                    </div>
                    <h2 className="mt-3 text-base font-bold text-gray-900 dark:text-white">{incident.camera_id}</h2>
                    <p className="mt-1 text-sm text-gray-600 dark:text-zinc-300">{incidentDescription(incident)}</p>
                    {incident.incident_type === 'UNATTENDED_BAGGAGE' && <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded bg-gray-100 px-2 py-1 dark:bg-white/10">Object: {incidentValue(incident, 'objectClass') || 'unknown'}</span><span className="rounded bg-gray-100 px-2 py-1 dark:bg-white/10">Stationary: {incidentValue(incident, 'stationarySeconds') ?? '—'} sec</span><span className="rounded bg-gray-100 px-2 py-1 dark:bg-white/10">Track: {incidentValue(incident, 'trackId') ?? '—'}</span></div>}
                    {incident.incident_type === 'ZONE_INTRUSION' && <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded bg-gray-100 px-2 py-1 dark:bg-white/10">Point: {formatPoint(incidentValue(incident, 'point'))}</span><span className="rounded bg-gray-100 px-2 py-1 dark:bg-white/10">Track: {incidentValue(incident, 'trackId') ?? '—'}</span></div>}
                    {incident.incident_type === 'WATCHLIST_MATCH' && <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded bg-gray-100 px-2 py-1 dark:bg-white/10">Identity: {incidentValue(incident, 'identity') || 'unknown'}</span><span className="rounded bg-gray-100 px-2 py-1 dark:bg-white/10">Track: {incidentValue(incident, 'trackId') ?? '—'}</span><span className="rounded bg-gray-100 px-2 py-1 dark:bg-white/10">Confidence: {incident.confidence ?? '—'}%</span></div>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
