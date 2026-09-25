import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ImagePlus, LoaderCircle, Plus,
  RefreshCw, Search, Trash2, UploadCloud, User, Video, WifiOff, X,
} from 'lucide-react';
import { API_BASE_URL, MEDIA_MTX_HLS_URL, MEDIA_MTX_URL } from '../config';

function apiHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export function getTargetImageUrl(target) {
  if (!target) return '';
  const path = target.reference_image_url || target.url;
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
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
  if (incident?.evidence_image_url) {
    return incident.evidence_image_url.startsWith('/')
      ? `${API_BASE_URL}${incident.evidence_image_url}`
      : incident.evidence_image_url;
  }
  if (incident?.evidence_image_base64) {
    return `data:image/jpeg;base64,${incident.evidence_image_base64}`;
  }
  return null;
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
      ['Threshold', num(get('thresholdSeconds')) && `${num(get('thresholdSeconds'))} s`],
    ],
  }),
  CAMERA_TAMPERING: (get) => ({
    summary: `Camera tampering detected (${(get('tamperType') || 'obscured').replace(/_/g, ' ')}).`,
    chips: [
      ['Type', get('tamperType')],
      ['Baseline diff', num(get('baselineDifference') ?? get('difference'), 2)],
      ['Consecutive', get('consecutiveFrames')],
    ],
  }),
  PERIMETER_BREACH: (get) => ({
    summary: `Perimeter intrusion into restricted zone "${get('zoneName') || 'unnamed'}".`,
    chips: [
      ['Zone', get('zoneName')],
      ['Track', get('trackId')],
      ['Point', formatPoint(get('detectionPoint'))],
    ],
  }),
  SUSPICIOUS_LOITERING: (get) => ({
    summary: `Subject loitering in restricted area for ${num(get('dwellTimeSeconds') ?? get('durationSeconds')) ?? '—'} seconds.`,
    chips: [
      ['Track', get('trackId')],
      ['Dwell time', num(get('dwellTimeSeconds') ?? get('durationSeconds')) && `${num(get('dwellTimeSeconds') ?? get('durationSeconds'))} s`],
      ['Threshold', num(get('thresholdSeconds')) && `${num(get('thresholdSeconds'))} s`],
      ['Zone', get('zoneName')],
    ],
  }),
  VIOLENCE_DETECTED: (get) => ({
    summary: 'Physical altercation or violent motion detected.',
    chips: [
      ['Combat intensity', num(get('combatIntensity') ?? get('motionScore'), 2)],
      ['Involved tracks', list(get('involvedTracks'))],
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
  ARMED_VIOLENCE: (get) => ({
    summary: `CRITICAL (P1): Armed violence detected! Subject with weapon engaged in violent altercation on track #${get('trackId') ?? '—'}.`,
    chips: [
      ['Priority', 'P1 CRITICAL'],
      ['Track', get('trackId')],
      ['Weapon', get('weapon') || 'Detected'],
      ['Involved Tracks', list(get('trackIds'))],
    ],
  }),
  VIOLENT_ASSAULT_COLLAPSE: (get) => ({
    summary: `CRITICAL (P2): Violent assault resulting in passenger collapse/fall detected on track #${get('trackId') ?? '—'}.`,
    chips: [
      ['Priority', 'P2 HIGH'],
      ['Track', get('trackId')],
      ['Posture', get('torsoAngleDeg') ? `${get('torsoAngleDeg')}°` : 'Horizontal'],
    ],
  }),
  WATCHLIST_MATCH: (get) => ({
    summary: `Watchlist match: ${get('subjectName') || get('identity') || 'unidentified subject'}.`,
    chips: [
      ['Subject', get('subjectName') || get('identity')],
      ['Track', get('trackId')],
      ['Match distance', num(get('matchDistance') ?? get('distance'), 3)],
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
  const [previewUrl, setPreviewUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleImageChange = (event) => {
    const file = event.target.files?.[0] || null;
    setImage(file);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    if (file) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }
  };

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

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
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      onUploaded(data.target || { name: name.trim() });
      onClose();
    } catch (uploadError) {
      setError(uploadError?.message || 'Upload failed. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/80 p-4 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="watchlist-modal-title"
    >
      <form onSubmit={submit} className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
          <div>
            <h2 id="watchlist-modal-title" className="font-bold text-white">Add watchlist target</h2>
            <p className="text-xs text-zinc-400 mt-1">Upload a clear, front-facing reference image.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-zinc-400 hover:text-white transition-colors" aria-label="Close watchlist upload"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wide text-zinc-400 mb-1.5">Identity name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. John Smith"
            />
          </label>

          <div>
            <span className="block text-xs font-bold uppercase tracking-wide text-zinc-400 mb-1.5">Reference image</span>
            {previewUrl ? (
              <div className="relative group rounded-xl overflow-hidden border border-white/15 bg-white/5 p-3 flex items-center gap-3">
                <img src={previewUrl} alt="Target preview" className="w-16 h-16 rounded-lg object-cover border border-white/20 shrink-0 bg-black" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{image?.name}</p>
                  <p className="text-[11px] text-zinc-400">{image ? (image.size / 1024).toFixed(1) : 0} KB</p>
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 mt-1 font-semibold">
                    <Check size={12} /> Ready to register
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setImage(null);
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                  }}
                  className="p-1.5 text-zinc-400 hover:text-rose-400 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                  title="Remove photo"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <label className="border-2 border-dashed border-white/15 hover:border-indigo-500/50 rounded-xl p-5 flex flex-col items-center justify-center gap-2 cursor-pointer bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
                <UploadCloud size={28} className="text-indigo-400" />
                <span className="text-xs font-semibold text-zinc-200">Click to select photo</span>
                <span className="text-[10px] text-zinc-500">JPG, PNG, or WebP portrait (max 5MB)</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  onChange={handleImageChange}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {error && <p className="text-xs font-medium text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg">{error}</p>}

          <button
            type="submit"
            disabled={saving || !name.trim() || !image}
            className="w-full flex justify-center items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2.5 text-sm font-bold text-white transition-colors"
          >
            {saving ? <LoaderCircle size={16} className="animate-spin" /> : <UploadCloud size={16} />}
            {saving ? 'Registering target...' : 'Upload target'}
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

  const fallbackToHls = useCallback(() => {
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
        if (peerConnection.iceConnectionState === 'failed') fallbackToHls();
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
      fallbackToHls();
    }
  }, [cameraId, cleanup, fallbackToHls]);

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

        {uploadedTarget && (
          <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-300 shadow-sm animate-in fade-in duration-200">
            <div className="flex items-center gap-3">
              {uploadedTarget.url || uploadedTarget.reference_image_url ? (
                <img
                  src={getTargetImageUrl(uploadedTarget)}
                  alt={uploadedTarget.name}
                  className="h-12 w-12 rounded-lg object-cover border border-emerald-500/40 shadow-sm bg-black"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-lg">
                  {uploadedTarget.name?.charAt(0)?.toUpperCase() || 'T'}
                </div>
              )}
              <div>
                <p className="text-sm font-bold">Successfully registered target: {uploadedTarget.name}</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400/80">Reference photo saved. Edge nodes will download it at their next sync.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUploadedTarget(null)}
              className="p-1 text-emerald-600 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {watchlistOpen && <WatchlistUploadModal token={token} onClose={() => setWatchlistOpen(false)} onUploaded={setUploadedTarget} />}
    </main>
  );
}

export function WatchlistView({ token }) {
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [lastTarget, setLastTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const fetchTargets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/watchlist`, {
        headers: apiHeaders(token),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load watchlist (HTTP ${response.status})`);
      }
      const data = await response.json();
      setTargets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Watchlist fetch error:', err);
      setError(err.message || 'Could not load watchlist targets.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTargets();
  }, [fetchTargets]);

  const handleDelete = async (id) => {
    if (!id) return;
    setDeletingId(id);
    try {
      const response = await fetch(`${API_BASE_URL}/api/watchlist/${id}`, {
        method: 'DELETE',
        headers: apiHeaders(token),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete target.');
      }
      setTargets((prev) => prev.filter((t) => (t._id || t.id) !== id && t.subject_id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const filteredTargets = targets.filter((target) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (target.name || '').toLowerCase().includes(q) ||
      (target.subject_id || '').toLowerCase().includes(q)
    );
  });

  return (
    <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-5 md:p-8 custom-scrollbar animate-fade-in-up">
      <div className="mx-auto max-w-6xl">
        {/* Header Section */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">Watchlist Queue & Gallery</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
              Registered facial recognition targets synced to edge camera nodes for live identity matching.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchTargets}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10 transition-colors"
              title="Refresh watchlist"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition-colors shadow-sm"
            >
              <Plus size={15} /> Add target
            </button>
          </div>
        </div>

        {/* Success Banner if target uploaded */}
        {lastTarget && (
          <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-300">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold">
                ✓
              </span>
              <div>
                <p className="text-sm font-bold">Target "{lastTarget.name}" registered successfully!</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400/80">Edge AI vision nodes will download this reference on their next poll cycle.</p>
              </div>
            </div>
            <button type="button" onClick={() => setLastTarget(null)} className="p-1 hover:opacity-75">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Search and Stats bar */}
        <div className="mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-72">
            <Search size={14} className="absolute left-3 top-3 text-gray-400 dark:text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or ID..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-xs text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-zinc-400">
            <span>
              Total Targets: <strong className="text-gray-900 dark:text-white">{targets.length}</strong>
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Edge Sync Active
            </span>
          </div>
        </div>

        {/* Loading State */}
        {loading && targets.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/80">
                <div className="aspect-square w-full rounded-xl bg-gray-200 dark:bg-white/5 mb-3" />
                <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-white/5 mb-2" />
                <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-white/5" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-500/20 dark:bg-rose-500/10 mb-6">
            <AlertTriangle size={28} className="mx-auto text-rose-500 mb-2" />
            <p className="text-sm font-bold text-rose-700 dark:text-rose-300">{error}</p>
            <button
              type="button"
              onClick={fetchTargets}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500"
            >
              <RefreshCw size={13} /> Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && targets.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center shadow-sm dark:border-white/10 dark:bg-zinc-900/80">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 mb-4">
              <User size={32} />
            </div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">No watchlist targets registered</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400 max-w-sm mx-auto">
              Add identities and reference photos so connected camera nodes can identify individuals of interest in real time.
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 shadow-sm"
            >
              <Plus size={15} /> Add First Target
            </button>
          </div>
        )}

        {/* Targets Gallery Grid */}
        {!loading && filteredTargets.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredTargets.map((target) => {
              const targetId = target._id || target.id;
              const photoUrl = getTargetImageUrl(target);
              const isDeleting = deletingId === targetId;
              const isConfirming = confirmDeleteId === targetId;

              return (
                <div
                  key={targetId}
                  className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md dark:border-white/10 dark:bg-zinc-900/80 flex flex-col"
                >
                  {/* Photo Container */}
                  <div className="relative aspect-square w-full bg-zinc-950 overflow-hidden">
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={target.name}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fallback = e.currentTarget.parentElement?.querySelector('.fallback-avatar');
                          if (fallback) fallback.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div className={`fallback-avatar absolute inset-0 ${photoUrl ? 'hidden' : ''} flex flex-col items-center justify-center bg-zinc-900 text-zinc-500`}>
                      <User size={48} className="mb-1 text-zinc-600" />
                      <span className="text-xs font-bold uppercase tracking-wider">{target.name}</span>
                    </div>

                    {/* Status Pill */}
                    <div className="absolute top-3 right-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/90 backdrop-blur-sm px-2.5 py-0.5 text-[10px] font-black text-white shadow-md">
                        <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                        ACTIVE
                      </span>
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="p-4 flex flex-col flex-1 justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white text-base truncate" title={target.name}>
                        {target.name}
                      </h3>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-zinc-400">
                        <span className="font-mono rounded bg-gray-100 px-1.5 py-0.5 dark:bg-white/10 truncate max-w-[150px]" title={target.subject_id}>
                          ID: {target.subject_id ? target.subject_id.slice(0, 8) + '...' : '—'}
                        </span>
                        <time>{target.created_at ? new Date(target.created_at).toLocaleDateString() : 'Active'}</time>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-2 border-t border-gray-100 dark:border-white/5 flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500">
                        Edge Vision Linked
                      </span>

                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDelete(targetId)}
                            disabled={isDeleting}
                            className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold transition-colors disabled:opacity-50"
                          >
                            {isDeleting ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 bg-gray-200 dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/20 text-gray-700 dark:text-zinc-300 rounded text-[10px] font-semibold transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(targetId)}
                          className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/15 rounded-lg transition-colors"
                          title="Delete target from watchlist"
                          aria-label={`Delete ${target.name}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {open && (
        <WatchlistUploadModal
          token={token}
          onClose={() => setOpen(false)}
          onUploaded={(newTarget) => {
            setLastTarget(newTarget);
            fetchTargets();
          }}
        />
      )}
    </main>
  );
}

export function IncidentLogView({ alerts, onDeleteAlert }) {
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (id) => {
    if (!onDeleteAlert) return;
    setDeletingId(id);
    await onDeleteAlert(id);
    setDeletingId(null);
  };

  return (
    <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-5 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6"><h1 className="text-2xl font-black text-gray-900 dark:text-white">Incident logs</h1><p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Live incidents and edge-supplied detection metadata.</p></div>
        <div className="space-y-3">
          {alerts.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">No incidents have been received.</div>}
          {alerts.map((incident) => {
            const image = evidenceUrl(incident);
            const { summary, chips } = describeIncident(incident);
            const incidentId = incident.id || incident._id;
            return (
              <article key={incidentId} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900/80">
                <div className="flex flex-col gap-4 p-4 sm:flex-row">
                  {image ? <img src={image} alt="Incident evidence" className="h-36 w-full rounded-lg bg-black object-cover sm:w-56" /> : <div className="flex h-36 w-full items-center justify-center rounded-lg bg-zinc-950 text-zinc-500 sm:w-56"><WifiOff size={25} /></div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-2.5 py-1 text-[11px] font-black text-orange-600 dark:text-orange-300"><AlertTriangle size={13} /> {incident.incident_type}</span>
                      <div className="flex items-center gap-3">
                        <time className="text-xs font-medium text-gray-500 dark:text-zinc-400">{incident.timestamp ? new Date(incident.timestamp).toLocaleString() : '—'}</time>
                        {onDeleteAlert && (
                          <button
                            type="button"
                            onClick={() => handleDelete(incidentId)}
                            disabled={deletingId === incidentId}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors disabled:opacity-50"
                            title="Delete alert (irrelevant)"
                            aria-label="Delete alert"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
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
