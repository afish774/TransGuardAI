import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Camera, Plus, RefreshCw, X, Check, ArrowUpRight } from 'lucide-react';
import WebRTCPlayer from '../components/WebRTCPlayer';
import { API_BASE_URL, MEDIA_MTX_URL, MEDIA_MTX_HLS_URL } from '../config';
import {
  SPRING,
  StatusDot,
  PrimaryButton,
  SecondaryButton,
} from '../components/ui/LuxuryPrimitives';

function deriveDefaultBus(cameraId) {
  const match = String(cameraId || '').match(/(\d+)$/);
  if (!match) return 'BUS_001';
  const n = parseInt(match[1], 10);
  if (!Number.isFinite(n) || n <= 1) return 'BUS_001';
  return `BUS_${String(n).padStart(3, '0')}`;
}

export const CameraNodesView = ({ activeCameras = [], token, onRefreshCameras, onFocusBus }) => {
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [cameraId, setCameraId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [cameraPosition, setCameraPosition] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState('');
  const [provisionSuccess, setProvisionSuccess] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [localCameras, setLocalCameras] = useState(activeCameras);

  useEffect(() => {
    setLocalCameras(activeCameras);
  }, [activeCameras]);

  const handleRefresh = useCallback(async () => {
    if (!token) return;
    setIsRefreshing(true);
    try {
      if (onRefreshCameras) {
        await onRefreshCameras();
      }
      const response = await fetch(`${API_BASE_URL}/api/edge/cameras`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          setLocalCameras(data);
        }
      }
    } catch (err) {
      console.warn('Failed to refresh cameras:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [token, onRefreshCameras]);

  useEffect(() => {
    handleRefresh();
  }, [handleRefresh]);

  useEffect(() => {
    if (!isProvisionModalOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsProvisionModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProvisionModalOpen]);

  const displayCameras = localCameras.length > 0 ? localCameras : activeCameras;

  const existingBusIds = useMemo(() => {
    const set = new Set(['BUS_001']);
    for (const c of displayCameras) {
      set.add(c.vehicle_id || deriveDefaultBus(c.camera_id));
    }
    return Array.from(set).sort();
  }, [displayCameras]);

  // Group cameras by Bus / Vehicle ID (1 camera per bus OR multiple cameras on one bus)
  const groupedByBus = useMemo(() => {
    const map = new Map();
    for (const cam of displayCameras) {
      const bus = cam.vehicle_id || deriveDefaultBus(cam.camera_id);
      const list = map.get(bus) || [];
      list.push({ ...cam, vehicle_id: bus });
      map.set(bus, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [displayCameras]);

  const openProvisionForBus = (presetBus = '') => {
    setProvisionError('');
    setVehicleId(presetBus);
    setCameraPosition('');
    setIsProvisionModalOpen(true);
  };

  const handleProvisionSubmit = async (e) => {
    e.preventDefault();
    setProvisionError('');
    setProvisionSuccess('');

    const cleanId = cameraId.trim();
    if (!cleanId.match(/^[A-Za-z0-9_-]+$/)) {
      setProvisionError(
        'Camera ID must contain only letters, numbers, underscores, or hyphens (e.g. CAM_02).'
      );
      return;
    }

    const cleanVehicle = vehicleId.trim();
    if (cleanVehicle && !cleanVehicle.match(/^[A-Za-z0-9_-]+$/)) {
      setProvisionError('Bus ID must contain only letters, numbers, underscores, or hyphens (e.g. BUS_001).');
      return;
    }

    let cleanRtsp = rtspUrl.trim();
    if (cleanRtsp.toLowerCase().startsWith('rstp://')) {
      cleanRtsp = 'rtsp://' + cleanRtsp.slice(7);
      setRtspUrl(cleanRtsp);
    }

    const isUrl = cleanRtsp.match(/^(rtsp|rtsps|http|https):\/\/.+/i);
    const isDeviceIndex = cleanRtsp.match(/^\d+$/);
    const isVideoFile = cleanRtsp.match(/\.(mp4|avi|mov|mkv)$/i);

    if (!isUrl && !isDeviceIndex && !isVideoFile) {
      setProvisionError(
        'Stream must be a valid URL (rtsp:// or http://), a webcam device number (e.g. 0), or a video file.'
      );
      return;
    }

    const resolvedBus = cleanVehicle || deriveDefaultBus(cleanId);
    const payload = {
      camera_id: cleanId,
      rtsp_url: cleanRtsp,
      vehicle_id: resolvedBus,
      ...(cameraPosition.trim() ? { camera_position: cameraPosition.trim() } : {}),
    };

    setIsProvisioning(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/edge/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setIsProvisionModalOpen(false);
        setCameraId('');
        setRtspUrl('');
        setVehicleId('');
        setCameraPosition('');
        setProvisionSuccess(
          `Provisioning started for ${cleanId} on ${resolvedBus}. Stream node is initializing.`
        );

        setLocalCameras((prev) => {
          if (prev.some((c) => c.camera_id === cleanId)) return prev;
          return [
            ...prev,
            {
              camera_id: cleanId,
              vehicle_id: resolvedBus,
              camera_position: cameraPosition.trim(),
              node_id: 'edge-local',
              status: 'PROVISIONING',
              fps: 0,
              last_heartbeat: new Date().toISOString(),
            },
          ];
        });

        setTimeout(() => {
          handleRefresh();
        }, 4000);
      } else {
        setProvisionError(data.error || 'Failed to provision node.');
      }
    } catch {
      setProvisionError('Network error connecting to server.');
    } finally {
      setIsProvisioning(false);
    }
  };

  const getGridCols = (count) => {
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-1 md:grid-cols-2';
    return 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
  };

  const onlineCameras = useMemo(
    () => displayCameras.filter((c) => c.status === 'ONLINE'),
    [displayCameras]
  );
  const offlineCameras = useMemo(
    () => displayCameras.filter((c) => c.status !== 'ONLINE'),
    [displayCameras]
  );

  return (
    <main className="flex-1 overflow-y-auto bg-[var(--bg-canvas)] p-6 md:p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Clean Header */}
        <div className="pb-5 border-b border-[var(--border-hairline)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-medium tracking-[-0.025em] text-[var(--text-primary)]">
              Camera Grid Operations
            </h1>
            <p className="font-mono tabular-nums text-[12px] text-[var(--text-secondary)] mt-1">
              {onlineCameras.length} online · {offlineCameras.length} offline ·{' '}
              {displayCameras.length} registered
            </p>
          </div>
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <SecondaryButton
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-9 px-3.5 text-[12px]"
              title="Refresh camera list and telemetry"
            >
              <RefreshCw
                size={13}
                strokeWidth={1.75}
                className={isRefreshing ? 'animate-spin' : ''}
              />
              <span>Refresh</span>
            </SecondaryButton>
            <PrimaryButton onClick={() => openProvisionForBus('')} className="h-9 px-4 text-[12px]">
              <Plus size={14} strokeWidth={1.75} />
              <span>Provision Node</span>
            </PrimaryButton>
          </div>
        </div>

        {provisionSuccess && (
          <div className="px-4 py-3 rounded-xl luxury-surface text-[12px] text-[var(--text-primary)] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Check size={14} strokeWidth={1.75} className="text-[var(--status-live)]" />
              <span>{provisionSuccess}</span>
            </div>
            <button
              type="button"
              onClick={() => setProvisionSuccess('')}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Per-Bus Camera Preview Sections (1 Camera = 1 Bus OR Multiple Cameras on Same Bus) */}
        {displayCameras.length > 0 ? (
          <div className="space-y-8">
            {groupedByBus.map(([busId, busCams]) => (
              <section key={busId} className="space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[13px] font-medium text-[var(--text-primary)]">
                      {busId}
                    </span>
                    <span className="text-[12px] text-[var(--text-muted)]">
                      · {busCams.length} {busCams.length === 1 ? 'camera' : 'cameras'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openProvisionForBus(busId)}
                      className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Plus size={12} strokeWidth={1.75} />
                      <span>Add Camera to {busId}</span>
                    </button>
                    {onFocusBus && (
                      <button
                        type="button"
                        onClick={() => onFocusBus(busId)}
                        className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <span>Open Console</span>
                        <ArrowUpRight size={12} strokeWidth={1.75} />
                      </button>
                    )}
                  </div>
                </div>

                <div className={`grid ${getGridCols(busCams.length)} gap-5`}>
                  {busCams.map((cam) => (
                    <WebRTCPlayer
                      key={cam.camera_id}
                      cameraId={cam.camera_id}
                      status={cam.status}
                      fps={cam.fps || 0}
                      mediamtxUrl={MEDIA_MTX_URL}
                      mediamtxHlsUrl={MEDIA_MTX_HLS_URL}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl luxury-surface p-14 flex flex-col items-center justify-center text-center">
            <Camera size={24} strokeWidth={1.5} className="text-[var(--text-muted)] mb-3.5" />
            <h3 className="text-[15px] font-medium text-[var(--text-primary)] mb-1.5">
              No Active Cameras Connected
            </h3>
            <p className="text-[13px] text-[var(--text-secondary)] max-w-md mb-5">
              Connect a camera stream from your local unit or provision a new node above.
            </p>
            <code className="text-[11px] bg-[var(--bg-elevated)] border border-[var(--border-hairline)] rounded-lg px-4 py-2 text-[var(--text-secondary)] font-mono">
              python trans_guard_engine.py --camera CAM_01 --url rtsp://&lt;IP&gt;:554/stream
            </code>
          </div>
        )}

        {/* Hardware Telemetry Table */}
        {displayCameras.length > 0 && (
          <div className="luxury-surface rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border-hairline)] flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-[var(--text-primary)]">
                Node Hardware Telemetry
              </h3>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {groupedByBus.length} {groupedByBus.length === 1 ? 'Bus' : 'Buses'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-hairline)] text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                    <th className="py-3 px-5 font-medium">Camera ID</th>
                    <th className="py-3 px-5 font-medium">Assigned Bus</th>
                    <th className="py-3 px-5 font-medium">Status</th>
                    <th className="py-3 px-5 font-medium">Node Host</th>
                    <th className="py-3 px-5 font-medium">Throughput</th>
                    <th className="py-3 px-5 font-medium">Last Heartbeat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-hairline)] text-[13px]">
                  {displayCameras.map((cam) => {
                    const fpsVal = Number(cam.fps) || 0;
                    const assignedBus = cam.vehicle_id || deriveDefaultBus(cam.camera_id);
                    let lastSeen = 'Recent';
                    if (cam.last_heartbeat) {
                      const d = new Date(cam.last_heartbeat);
                      if (!isNaN(d.getTime())) {
                        lastSeen = d.toLocaleTimeString([], { hour12: false });
                      }
                    }

                    return (
                      <tr
                        key={cam.camera_id}
                        className="hover:bg-[var(--bg-hover)] transition-colors"
                      >
                        <td className="py-3.5 px-5 font-mono text-[12px] font-medium text-[var(--text-primary)]">
                          <div>{cam.camera_id}</div>
                          {cam.camera_position && (
                            <div className="font-sans text-[11px] text-[var(--text-muted)] font-normal">
                              {cam.camera_position}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-5 font-mono text-[12px] text-[var(--text-secondary)]">
                          {assignedBus}
                        </td>
                        <td className="py-3.5 px-5">
                          {cam.status === 'ONLINE' ? (
                            <span className="inline-flex items-center gap-2 text-[12px] text-[var(--text-primary)]">
                              <StatusDot variant="live" />
                              <span>Online</span>
                            </span>
                          ) : cam.status === 'PROVISIONING' ? (
                            <span className="inline-flex items-center gap-2 text-[12px] text-[var(--status-standby)]">
                              <StatusDot variant="standby" pulse />
                              <span>Provisioning...</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                              <StatusDot variant="muted" />
                              <span>Signal Standby</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-5 text-[12px] text-[var(--text-secondary)] font-mono">
                          {cam.node_id || 'edge-local'}
                        </td>
                        <td className="py-3.5 px-5 font-mono tabular-nums text-[12px] text-[var(--text-primary)]">
                          {fpsVal > 0 ? `${fpsVal.toFixed(1)} FPS` : '—'}
                        </td>
                        <td className="py-3.5 px-5 font-mono tabular-nums text-[12px] text-[var(--text-muted)]">
                          {lastSeen}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Provision Node Modal (Supports 1-Cam-Per-Bus OR Multi-Cam on Same Bus) */}
        {isProvisionModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provision-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsProvisionModalOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={SPRING}
              className="luxury-surface rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="px-6 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between">
                <div>
                  <h2
                    id="provision-modal-title"
                    className="text-[16px] font-medium tracking-[-0.025em] text-[var(--text-primary)]"
                  >
                    Provision AI Edge Node
                  </h2>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                    Link a camera to its own bus or attach multiple cameras to one bus.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsProvisionModalOpen(false)}
                  aria-label="Close provision modal"
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>

              <div className="p-6">
                {provisionError && (
                  <div className="mb-4 px-3.5 py-2.5 bg-[#FF453A]/10 border border-[#FF453A]/25 text-[var(--status-alert)] text-[12px] rounded-lg">
                    {provisionError}
                  </div>
                )}
                <form onSubmit={handleProvisionSubmit} className="space-y-4">
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1.5">
                      Camera ID
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      placeholder="e.g. CAM_02"
                      value={cameraId}
                      onChange={(e) => setCameraId(e.target.value)}
                      className="w-full h-10 bg-[var(--bg-input)] border border-[var(--border-hairline)] rounded-lg px-3.5 font-mono text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)]"
                    />
                  </div>

                  {/* Assigned Bus / Vehicle ID (Allows Multi-Cam on Same Bus!) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                        Assigned Bus ID (Optional)
                      </label>
                      <span className="text-[10px] text-[var(--text-muted)]">
                        Reuse Bus ID for multi-cam
                      </span>
                    </div>
                    <input
                      type="text"
                      placeholder="Auto (e.g. BUS_001 to share same bus)"
                      value={vehicleId}
                      onChange={(e) => setVehicleId(e.target.value)}
                      className="w-full h-10 bg-[var(--bg-input)] border border-[var(--border-hairline)] rounded-lg px-3.5 font-mono text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)]"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {existingBusIds.map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setVehicleId(b)}
                          className={`px-2 py-0.5 rounded-md font-mono text-[10px] border transition-colors cursor-pointer ${
                            vehicleId === b
                              ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] border-transparent'
                              : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-hairline)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1.5">
                      Camera Position (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Front Cabin, Rear Door"
                      value={cameraPosition}
                      onChange={(e) => setCameraPosition(e.target.value)}
                      className="w-full h-10 bg-[var(--bg-input)] border border-[var(--border-hairline)] rounded-lg px-3.5 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1.5">
                      Stream Source
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="rtsp://192.168.1.100:554/stream or 0 for webcam"
                      value={rtspUrl}
                      onChange={(e) => setRtspUrl(e.target.value)}
                      className="w-full h-10 bg-[var(--bg-input)] border border-[var(--border-hairline)] rounded-lg px-3.5 font-mono text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)]"
                    />
                  </div>

                  <div className="pt-2 flex justify-end gap-2">
                    <SecondaryButton
                      onClick={() => setIsProvisionModalOpen(false)}
                      className="h-9 px-3.5 text-[12px]"
                    >
                      Cancel
                    </SecondaryButton>
                    <PrimaryButton
                      type="submit"
                      disabled={isProvisioning}
                      className="h-9 px-4 text-[12px]"
                    >
                      {isProvisioning ? (
                        <>
                          <RefreshCw size={13} strokeWidth={1.75} className="animate-spin" />
                          <span>Deploying…</span>
                        </>
                      ) : (
                        <span>Deploy Node</span>
                      )}
                    </PrimaryButton>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </main>
  );
};
