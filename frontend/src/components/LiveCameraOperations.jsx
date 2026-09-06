import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ImagePlus, LoaderCircle, Plus,
  UploadCloud, Video, WifiOff, X,
} from 'lucide-react';
import { API_BASE_URL, MEDIA_MTX_HLS_URL, MEDIA_MTX_URL } from '../config';

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

// Numeric metadata can arrive as a number or a numeric string depending on the
// multipart encoding, and may legitimately be absent. Coerce defensively so a
// missing field renders an em dash instead of "NaN" or crashing on .toFixed().
function num(value, digits = 1) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : null;
}

function list(value) {
  return Array.isArray(value) ? value.join(', ') : null;
}

// Per-pillar presentation registry. Each entry maps an incident type to a
// one-line summary and a set of metadata chips. Returning chips as data
// (rather than JSX per branch) keeps every pillar rendering through one
// code path, so a new incident type cannot introduce a mapping error.
const PILLAR_VIEWS = {
  OVERCROWD_DETECTED: (get) => ({
    summary: `Crowd density exceeded the safe threshold (${get('personCount') ?? '—'} people detected).`,
    chips: [
      ['Current', get('personCount')],
      ['Peak', get('peakCount')],
      ['Threshold', get('threshold')],
    ],
  }),
  UNATTENDED_BAGGAGE: (get) => ({
    summary: `Unattended ${get('objectClass') || 'object'}${num(get('unattendedSeconds') ?? get('stationarySeconds')) ? ` for ${num(get('unattendedSeconds') ?? get('stationarySeconds'))} seconds` : ''}.`,
    chips: [
      ['Object', get('objectClass')],
      ['Unattended', num(get('unattendedSeconds')) && `${num(get('unattendedSeconds'))} s`],
      ['Stationary', num(get('stationarySeconds')) && `${num(get('stationarySeconds'))} s`],
      ['Track', get('trackId')],
    ],
  }),
  FALL_DETECTED: (get) => ({
    summary: `Possible fall detected${get('trackId') !== undefined ? ` for track #${get('trackId')}` : ''}. Verify immediately.`,
    chips: [
      ['Track', get('trackId')],
      ['People in frame', get('persons')],
    ],
  }),
  CRIME_WEAPON_DETECTED: (get) => ({
    summary: `Possible ${get('weapon') || 'weapon'} detected on track #${get('trackId') ?? '—'}.`,
    chips: [
      ['Weapon', get('weapon')],
      ['Model confidence', num(get('confidence')) && `${num(get('confidence'))}%`],
      ['Track', get('trackId')],
    ],
  }),
  CRIME_VIOLENCE_DETECTED: (get) => ({
    summary: `Violent interaction detected between tracks ${list(get('trackIds')) || '—'}.`,
    chips: [
      ['Tracks', list(get('trackIds'))],
      ['Overlap (IoU)', num(get('iou'), 3)],
      ['Wrist velocity', num(get('wristSpeedPxPerSec')) && `${num(get('wristSpeedPxPerSec'))} px/s`],
    ],
  }),
  WATCHLIST_MATCH: (get) => ({
    summary: `Potential watchlist match: ${get('identity') || 'unknown identity'}.`,
    chips: [
      ['Identity', get('identity')],
      ['Track', get('trackId')],
    ],
  }),
  ZONE_INTRUSION: (get) => ({
    summary: `Restricted-zone entry detected at ${formatPoint(get('point'))}.`,
    chips: [
      ['Point', Array.isArray(get('point')) ? formatPoint(get('point')) : null],
      ['Track', get('trackId')],
    ],
  }),
};

// Resolves an incident into { summary, chips }. Unknown incident types degrade
// to a readable label rather than rendering blank, so an engine-side addition
// never produces an empty log entry in the operator UI.
function describeIncident(incident) {
  const get = (key) => incidentValue(incident, key);
  const view = PILLAR_VIEWS[incident?.incident_type];
  if (!view) {
    return {
      summary: (incident?.incident_type || 'INCIDENT').replace(/_/g, ' ').toLowerCase(),
      chips: [],
    };
  }
  const { summary, chips } = view(get);
  return {
    summary,
    chips: chips.filter(([, value]) => value !== undefined && value !== null && value !== ''),
  };
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
      // Clear the form before unmounting so a reopened modal starts clean.
      setName('');
      setImage(null);
      onUploaded(data.target || { name: name.trim() });
      onClose();
    } catch (uploadError) {
      // Network failures reject rather than resolve, so they land here too;
      // nothing escapes as an unhandled rejection.
      setError(uploadError?.message || 'Upload failed. Check your connection and try again.');
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

// Memoised: the parent re-renders whenever a new incident arrives over the
// socket. Without this, every incident would remount the <video> element and
// tear down the peer connection, visibly freezing the stream. Props are
// primitives, so the default shallow comparison is sufficient.
const LiveVideo = memo(function LiveVideo({ cameraId, compact = false }) {
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
});

export function DashboardOperationsView({ cameras, token }) {
  const [selectedCameraId, setSelectedCameraId] = useState(cameras[0]?.camera_id || 'cam0');
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
            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Monitor live camera feeds and manage watchlist identities.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setWatchlistOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-800 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"><ImagePlus size={15} /> Add target</button>
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
            const { summary, chips } = describeIncident(incident);
            return (
              <article key={incident.id || incident._id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900/80">
                <div className="flex flex-col gap-4 p-4 sm:flex-row">
                  {image ? <img src={image} alt="Incident evidence" className="h-36 w-full rounded-lg bg-black object-cover sm:w-56" /> : <div className="flex h-36 w-full items-center justify-center rounded-lg bg-zinc-950 text-zinc-500 sm:w-56"><WifiOff size={25} /></div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-2.5 py-1 text-[11px] font-black text-orange-600 dark:text-orange-300"><AlertTriangle size={13} /> {incident.incident_type}</span>
                      <time className="text-xs font-medium text-gray-500 dark:text-zinc-400">{incident.timestamp ? new Date(incident.timestamp).toLocaleString() : '—'}</time>
                    </div>
                    <h2 className="mt-3 text-base font-bold text-gray-900 dark:text-white">{incident.camera_id}</h2>
                    <p className="mt-1 text-sm text-gray-600 dark:text-zinc-300">{summary}</p>
                    {chips.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        {chips.map(([label, value]) => (
                          <span key={label} className="rounded bg-gray-100 px-2 py-1 dark:bg-white/10">
                            {label}: <span className="font-semibold">{String(value)}</span>
                          </span>
                        ))}
                      </div>
                    )}
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
