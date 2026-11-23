import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Siren,
  MapPin,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  ImagePlus,
  X,
  Check,
  Radio,
  Video,
  LayoutGrid,
  Square,
  ShieldCheck,
  Sun,
  Moon,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { API_BASE_URL, MEDIA_MTX_HLS_URL, MEDIA_MTX_URL } from '../config';
import { getEnrichedData, getEvidenceSrc } from '../utils/alertUtils';
import { WatchlistUploadModal } from './LiveCameraOperations';
import { useToast } from './ToastProvider';
import {
  SPRING,
  StatusDot,
  TelemetryRow,
  SecondaryButton,
} from './ui/LuxuryPrimitives';

function formatIstTime(ts) {
  if (!ts) return '--:--:--';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toTimeString().slice(0, 8);
  }
}

function isPhysicalSos(alert) {
  if (!alert) return false;
  const type = String(alert.incident_type || '').toUpperCase();
  const src = String(alert.metadata?.source || '').toLowerCase();
  return (
    type.includes('SOS') ||
    type.includes('PANIC') ||
    src.includes('esp32') ||
    src.includes('physical') ||
    src.includes('hardware')
  );
}

const MissionVideoStream = memo(function MissionVideoStream({
  cameraId,
  onStreamStateChange,
  reconnectNonce,
}) {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const mountedRef = useRef(true);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // Ignore teardown errors
      }
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
    }
  }, []);

  const fallbackToHls = useCallback(() => {
    cleanup();
    if (!mountedRef.current) return;
    onStreamStateChange?.({ state: 'standby' });
    if (videoRef.current) {
      const base = (MEDIA_MTX_HLS_URL || '').replace(/\/+$/, '');
      videoRef.current.src = `${base}/cam/${cameraId}/index.m3u8`;
      const p = videoRef.current.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          if (mountedRef.current) onStreamStateChange?.({ state: 'standby' });
        });
      }
    }
  }, [cameraId, cleanup, onStreamStateChange]);

  const connect = useCallback(async () => {
    cleanup();
    if (!mountedRef.current) return;
    onStreamStateChange?.({ state: 'connecting' });

    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
      fallbackToHls();
      return;
    }

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;
      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (!mountedRef.current || !videoRef.current) return;
        if (event.streams && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        } else if (event.track) {
          let stream = videoRef.current.srcObject;
          if (!stream || !(stream instanceof MediaStream)) {
            stream = new MediaStream();
            videoRef.current.srcObject = stream;
          }
          stream.addTrack(event.track);
        }
        const p = videoRef.current.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
        onStreamStateChange?.({ state: 'live' });
      };

      pc.oniceconnectionstatechange = () => {
        if (!pcRef.current || !mountedRef.current) return;
        if (pc.iceConnectionState === 'failed') {
          fallbackToHls();
        } else if (pc.iceConnectionState === 'disconnected') {
          onStreamStateChange?.({ state: 'standby' });
        } else if (
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed'
        ) {
          onStreamStateChange?.({ state: 'live' });
        }
      };

      const offer = await pc.createOffer();
      if (!mountedRef.current || pcRef.current !== pc) return;
      await pc.setLocalDescription(offer);

      const cleanBase = (MEDIA_MTX_URL || '').replace(/\/+$/, '');
      const res = await fetch(`${cleanBase}/cam/${cameraId}/whep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp,
      });
      if (!res.ok) throw new Error(`Stream HTTP ${res.status}`);
      const answerSdp = await res.text();
      if (!mountedRef.current || pcRef.current !== pc) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch {
      fallbackToHls();
    }
  }, [cameraId, cleanup, fallbackToHls, onStreamStateChange]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [connect, cleanup, reconnectNonce]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      onPlaying={() => onStreamStateChange?.({ state: 'live' })}
      className="h-full w-full object-contain"
    />
  );
});

export default function MissionControlDashboard({
  cameras = [],
  alerts = [],
  token,
  selectedVehicle = 'BUS_001',
  onSelectVehicle,
  esp32Telemetry = null,
  onAcknowledgeAlert,
  isDarkMode = true,
  toggleDarkMode,
}) {
  const toast = useToast();
  const busCameras = useMemo(() => {
    const matched = cameras.filter((c) => (c.vehicle_id || 'BUS_001') === selectedVehicle);
    return matched.length > 0 ? matched : cameras;
  }, [cameras, selectedVehicle]);

  const [selectedCameraId, setSelectedCameraId] = useState(busCameras[0]?.camera_id || 'CAM_01');
  const [multiCamMode, setMultiCamMode] = useState(false);
  const [streamMeta, setStreamMeta] = useState({ state: 'standby' });
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);

  const [pinnedAlertId, setPinnedAlertId] = useState(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [telegramDispatchedAt, setTelegramDispatchedAt] = useState(null);

  const [sirenRemainingMs, setSirenRemainingMs] = useState(0);
  const sirenTimerRef = useRef(null);
  const videoContainerRef = useRef(null);

  useEffect(() => {
    if (busCameras.length <= 1 && multiCamMode) {
      setMultiCamMode(false);
    }
  }, [busCameras.length, multiCamMode]);

  const cameraId = useMemo(() => {
    if (busCameras.some((c) => c.camera_id === selectedCameraId)) return selectedCameraId;
    return busCameras[0]?.camera_id || 'CAM_01';
  }, [busCameras, selectedCameraId]);

  const activeCameraObj = useMemo(
    () => busCameras.find((c) => c.camera_id === cameraId) || null,
    [busCameras, cameraId]
  );

  const activeRawAlert = useMemo(() => {
    if (pinnedAlertId) {
      const found = alerts.find((a) => (a.id || a._id) === pinnedAlertId);
      if (found) return found;
    }
    const pendingAlerts = alerts.filter(
      (a) => a.status !== 'REVIEWED' && a.status !== 'DISMISSED'
    );
    if (pendingAlerts.length === 0) return null;
    const sosFirst = pendingAlerts.find((a) => isPhysicalSos(a));
    return sosFirst || pendingAlerts[0];
  }, [alerts, pinnedAlertId]);

  const activeAlert = useMemo(
    () => (activeRawAlert ? getEnrichedData(activeRawAlert) : null),
    [activeRawAlert]
  );

  const isAlertActive = Boolean(activeAlert && activeRawAlert?.status !== 'DISMISSED');
  const isSosEvent = isPhysicalSos(activeRawAlert);
  const isAlreadyReviewed = activeRawAlert?.status === 'REVIEWED';

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    return () => {
      if (sirenTimerRef.current) clearInterval(sirenTimerRef.current);
    };
  }, []);

  const handleStreamStateChange = useCallback((patch) => {
    setStreamMeta((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const startSirenCountdown = useCallback(() => {
    if (sirenTimerRef.current) clearInterval(sirenTimerRef.current);
    const durationMs = 5000;
    const endTime = Date.now() + durationMs;
    setSirenRemainingMs(durationMs);

    sirenTimerRef.current = setInterval(() => {
      const left = Math.max(0, endTime - Date.now());
      setSirenRemainingMs(left);
      if (left <= 0) {
        clearInterval(sirenTimerRef.current);
        sirenTimerRef.current = null;
      }
    }, 50);
  }, []);

  const handleSelectTimelineAlert = (raw) => {
    const id = raw.id || raw._id;
    setPinnedAlertId(id);
    if (raw.camera_id) {
      const camObj = cameras.find((c) => c.camera_id === raw.camera_id);
      if (camObj?.vehicle_id && onSelectVehicle) {
        onSelectVehicle(camObj.vehicle_id);
      } else if (raw.metadata?.vehicle_id && onSelectVehicle) {
        onSelectVehicle(raw.metadata.vehicle_id);
      }
      setSelectedCameraId(raw.camera_id);
    }
  };

  const handleApproveAndTriggerSiren = async () => {
    if (isDispatching || sirenRemainingMs > 0) return;
    setIsDispatching(true);
    try {
      let acknowledgedOk = false;

      if (activeRawAlert && !isAlreadyReviewed && onAcknowledgeAlert) {
        const alertId = activeRawAlert.id || activeRawAlert._id;
        acknowledgedOk = await onAcknowledgeAlert(alertId, 'REVIEWED');
      }

      if (!acknowledgedOk) {
        const res = await fetch(
          `${API_BASE_URL}/api/alerts/command?vehicle_id=${encodeURIComponent(selectedVehicle)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              vehicle_id: selectedVehicle,
              reason: activeRawAlert ? 'DISPATCH_APPROVED' : 'MANUAL_OPERATOR_SIREN',
              incident_id: activeRawAlert?.id || activeRawAlert?._id || null,
              incident_type: activeRawAlert?.incident_type || 'MANUAL_SIREN',
            }),
          }
        );
        if (!res.ok) throw new Error(`Command failed (${res.status})`);
      }

      setTelegramDispatchedAt(new Date());
      startSirenCountdown();
    } catch (err) {
      console.error('Siren dispatch error:', err);
    } finally {
      setIsDispatching(false);
    }
  };

  const handleDismissAlert = async () => {
    if (!activeRawAlert || isDismissing) return;
    setIsDismissing(true);
    try {
      const alertId = activeRawAlert.id || activeRawAlert._id;
      if (onAcknowledgeAlert) {
        await onAcknowledgeAlert(alertId, 'DISMISSED');
      }
      setPinnedAlertId(null);
    } finally {
      setIsDismissing(false);
    }
  };

  const liveLat = Number.isFinite(esp32Telemetry?.lat)
    ? esp32Telemetry.lat
    : Number.isFinite(activeAlert?.gps?.lat)
    ? activeAlert.gps.lat
    : null;
  const liveLon = Number.isFinite(esp32Telemetry?.lon)
    ? esp32Telemetry.lon
    : Number.isFinite(activeAlert?.gps?.lon)
    ? activeAlert.gps.lon
    : null;
  const hasCoordinates = liveLat !== null && liveLon !== null;
  const speedKmph = Number.isFinite(esp32Telemetry?.speed_kmph) ? esp32Telemetry.speed_kmph : 0;
  const satellites = Number.isFinite(esp32Telemetry?.satellites) ? esp32Telemetry.satellites : 0;
  const gpsLocked = Boolean(esp32Telemetry?.has_fix);
  const esp32Online = Boolean(esp32Telemetry?.online);

  const mapsUrl = hasCoordinates
    ? `https://www.google.com/maps?q=${liveLat.toFixed(6)},${liveLon.toFixed(6)}`
    : null;

  const sirenActive = sirenRemainingMs > 0;
  const sirenProgressPct = (sirenRemainingMs / 5000) * 100;
  const sirenSecondsLabel = (sirenRemainingMs / 1000).toFixed(1);

  const evidenceSrc = activeRawAlert ? getEvidenceSrc(activeRawAlert, API_BASE_URL) : null;
  const formattedCamLabel = cameraId.toUpperCase().replace(/^CAM_?0?/, 'CAM-0');
  const isStreamLive = streamMeta.state === 'live';

  return (
    <main className="flex-1 min-h-0 h-full overflow-y-auto lg:overflow-hidden bg-[var(--bg-canvas)] flex flex-col lg:flex-row custom-scrollbar">
      {/* =================================================================
          CENTER STAGE (68%) — Apple Studio Display Viewport + Activity Strip
          ================================================================= */}
      <section className="w-full lg:w-[68%] flex flex-col shrink-0 lg:shrink lg:min-h-0 h-auto lg:h-full p-4 sm:p-5 gap-4 sm:gap-5 lg:border-r lg:border-[var(--border-hairline)]">
        {/* Framed Matte Video Canvas */}
        <div
          ref={videoContainerRef}
          className="relative aspect-video lg:aspect-auto lg:flex-1 lg:min-h-0 w-full rounded-[16px] sm:rounded-[20px] overflow-hidden dot-grid-standby border border-[var(--border-hairline)]"
          style={{
            boxShadow: '0 16px 40px -20px rgba(0, 0, 0, 0.45), inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
          }}
        >
          {multiCamMode && busCameras.length > 1 ? (
            <div
              className={`absolute inset-0 p-3 pt-14 pb-14 grid gap-2.5 ${
                busCameras.length <= 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2'
              }`}
            >
              {busCameras.map((cam) => {
                const isSelectedTile = cam.camera_id === cameraId;
                return (
                  <div
                    key={cam.camera_id}
                    onClick={() => {
                      setSelectedCameraId(cam.camera_id);
                      setMultiCamMode(false);
                    }}
                    className={`relative rounded-xl overflow-hidden bg-black border cursor-pointer transition-colors ${
                      isSelectedTile ? 'border-white/30' : 'border-white/10 hover:border-white/25'
                    }`}
                  >
                    <MissionVideoStream
                      cameraId={cam.camera_id}
                      reconnectNonce={reconnectNonce}
                    />
                    <div className="luxury-glass absolute top-2.5 left-2.5 h-6 px-2.5 rounded-full flex items-center gap-1.5 text-[10px] font-mono text-white">
                      <StatusDot variant={cam.status === 'ONLINE' ? 'live' : 'standby'} />
                      <span>{cam.camera_id}</span>
                      {cam.camera_position && (
                        <span className="text-white/55">· {cam.camera_position}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div className="absolute inset-0">
                <MissionVideoStream
                  cameraId={cameraId}
                  onStreamStateChange={handleStreamStateChange}
                  reconnectNonce={reconnectNonce}
                />
              </div>

              {/* Apple Studio Display-style Minimal Optical Standby */}
              {!isStreamLive && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
                  <div className="w-12 h-12 rounded-full border border-white/[0.08] bg-white/[0.03] flex items-center justify-center">
                    <Video size={18} strokeWidth={1.5} className="text-white/[0.36]" />
                  </div>
                  <div>
                    <div className="text-[13px] font-medium tracking-[-0.015em] text-white/[0.72]">
                      {streamMeta.state === 'connecting' ? 'Connecting Camera Feed' : 'Camera Standby'}
                    </div>
                    <div className="text-[11px] text-white/[0.34] mt-0.5">
                      {formattedCamLabel} · Waiting for active video stream
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Subtle Optical Edge Gradients */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/50 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />

          {/* TOP-LEFT APPLE FROSTED GLASS CAPSULE */}
          <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-10 flex items-center gap-2 max-w-[65%]">
            <div className="luxury-glass h-7 sm:h-8 px-2.5 sm:px-3.5 rounded-full flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-[12px] min-w-0">
              <StatusDot variant={isStreamLive ? 'live' : 'standby'} pulse={isStreamLive} />
              <span className="font-mono tabular-nums font-medium text-white/[0.94] truncate">
                {multiCamMode ? `${selectedVehicle} · ${busCameras.length} Cams` : formattedCamLabel}
              </span>
              {!multiCamMode && activeCameraObj?.camera_position && (
                <>
                  <span className="hidden sm:inline text-white/[0.24]">·</span>
                  <span className="hidden sm:inline text-white/[0.68] truncate">
                    {activeCameraObj.camera_position}
                  </span>
                </>
              )}
              {!multiCamMode && (
                <>
                  <span className="hidden sm:inline text-white/[0.24]">·</span>
                  <span className="hidden sm:inline text-white/[0.64]">
                    {isStreamLive ? 'Live' : 'Standby'}
                  </span>
                </>
              )}
            </div>

            {!multiCamMode && busCameras.length > 1 && (
              <select
                value={cameraId}
                onChange={(e) => setSelectedCameraId(e.target.value)}
                aria-label="Switch camera on this bus"
                className="luxury-glass h-7 sm:h-8 px-2 sm:px-3 max-w-[115px] sm:max-w-none truncate rounded-full font-mono text-[10.5px] sm:text-[11px] text-white/[0.88] focus:outline-none cursor-pointer"
              >
                {busCameras.map((c) => (
                  <option key={c.camera_id} value={c.camera_id} className="bg-[#0B0B0E] text-white">
                    {c.camera_id}
                    {c.camera_position ? ` (${c.camera_position})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* TOP-RIGHT CIRCULAR GLASS HARDWARE CONTROLS */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 flex items-center gap-1.5 sm:gap-2">
            {busCameras.length > 1 && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                transition={{ duration: 0.12 }}
                onClick={() => setMultiCamMode((v) => !v)}
                className="luxury-glass h-7 sm:h-8 px-2.5 sm:px-3 rounded-full flex items-center gap-1.5 text-[10.5px] sm:text-[11px] font-medium text-white/[0.84] hover:text-white transition-colors cursor-pointer"
                title={multiCamMode ? 'Single camera focus' : 'Show all cameras on this bus'}
              >
                {multiCamMode ? (
                  <>
                    <Square size={11} strokeWidth={1.75} />
                    <span>Focus</span>
                  </>
                ) : (
                  <>
                    <LayoutGrid size={11} strokeWidth={1.75} />
                    <span>All ({busCameras.length})</span>
                  </>
                )}
              </motion.button>
            )}

            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              transition={{ duration: 0.12 }}
              onClick={() => setReconnectNonce((n) => n + 1)}
              className="luxury-glass h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center text-white/[0.72] hover:text-white transition-colors cursor-pointer"
              title="Reconnect feed"
              aria-label="Reconnect feed"
            >
              <RefreshCw size={12.5} strokeWidth={1.75} />
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              transition={{ duration: 0.12 }}
              onClick={toggleFullscreen}
              className="luxury-glass h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center text-white/[0.72] hover:text-white transition-colors cursor-pointer"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 size={12.5} strokeWidth={1.75} />
              ) : (
                <Maximize2 size={12.5} strokeWidth={1.75} />
              )}
            </motion.button>
          </div>

          {/* BOTTOM FLOATING GLASS TELEMETRY CAPSULE */}
          <div className="absolute inset-x-3 bottom-3 sm:inset-x-4 sm:bottom-4 z-10 flex items-center justify-between gap-2">
            <div className="luxury-glass h-7 sm:h-8 px-2.5 sm:px-3.5 rounded-full flex items-center gap-2 sm:gap-3 text-[10.5px] sm:text-[11px] font-mono tabular-nums text-white/[0.88] max-w-[calc(100%-44px)] overflow-hidden">
              <span className="flex items-center gap-1.5">
                <MapPin size={12} strokeWidth={1.75} className="text-white/[0.48]" />
                <span>
                  {hasCoordinates
                    ? `${liveLat.toFixed(5)}, ${liveLon.toFixed(5)}`
                    : 'Acquiring GPS'}
                </span>
              </span>
              <span className="h-3 w-px bg-white/15" />
              <span>
                {speedKmph.toFixed(1)} <span className="text-white/[0.45]">km/h</span>
              </span>
              <span className="hidden sm:inline-block h-3 w-px bg-white/15" />
              <span className="hidden sm:inline">
                {satellites} <span className="text-white/[0.45]">Sats</span>
              </span>
            </div>

            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="luxury-glass h-8 w-8 rounded-full flex items-center justify-center text-white/[0.78] hover:text-white transition-colors"
                title="Open in Google Maps"
                aria-label="Open in Google Maps"
              >
                <ExternalLink size={13} strokeWidth={1.75} />
              </a>
            )}
          </div>
        </div>

        {/* RECENT ACTIVITY TIMELINE STRIP */}
        <div className="h-[118px] shrink-0 pt-3.5 border-t border-[var(--border-hairline)] flex flex-col justify-between overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium tracking-[-0.015em] text-[var(--text-primary)]">
                Recent Activity
              </span>
              <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                {alerts.length}
              </span>
            </div>

            <div className="flex items-center gap-4">
              {pinnedAlertId && (
                <button
                  type="button"
                  onClick={() => setPinnedAlertId(null)}
                  className="text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  Return to live
                </button>
              )}
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                transition={{ duration: 0.12 }}
                onClick={() => setWatchlistOpen(true)}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                <ImagePlus size={13} strokeWidth={1.75} />
                <span>Add Target</span>
              </motion.button>
            </div>
          </div>

          <div className="flex items-center gap-2.5 overflow-x-auto custom-scrollbar pb-0.5">
            {alerts.length === 0 ? (
              <div className="w-full h-[68px] flex items-center gap-2.5 text-[13px] text-[var(--text-muted)]">
                <StatusDot variant="live" />
                <span>All clear — no incidents recorded in this session.</span>
              </div>
            ) : (
              alerts.slice(0, 14).map((raw) => {
                const enriched = getEnrichedData(raw);
                const id = raw.id || raw._id;
                const isSelected = (activeRawAlert?.id || activeRawAlert?._id) === id;
                const sos = isPhysicalSos(raw);
                const st = raw.status || 'NEW';
                const dotVariant =
                  st === 'REVIEWED'
                    ? 'live'
                    : st === 'DISMISSED'
                    ? 'muted'
                    : sos || enriched.incident_info.severity === 'CRITICAL'
                    ? 'alert'
                    : 'standby';

                return (
                  <motion.button
                    key={id}
                    type="button"
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ duration: 0.14 }}
                    onClick={() => handleSelectTimelineAlert(raw)}
                    className={`shrink-0 w-[210px] h-[68px] rounded-xl px-3.5 py-2.5 text-left border transition-colors flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--bg-elevated)] border-[var(--border-hover)]'
                        : 'bg-[var(--bg-surface)] border-[var(--border-hairline)] hover:border-[var(--border-hover)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusDot variant={dotVariant} />
                        <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">
                          {enriched.incident_info.label}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-[10px] text-[var(--text-muted)] shrink-0">
                        {formatIstTime(raw.timestamp)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-[var(--text-secondary)] truncate">
                        {sos ? 'Physical SOS' : enriched.camera_id}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {st === 'REVIEWED'
                          ? 'Accepted'
                          : st === 'DISMISSED'
                          ? 'Dismissed'
                          : 'Pending'}
                      </span>
                    </div>
                  </motion.button>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* =================================================================
          RIGHT INSPECTOR DRAWER (32%) — Apple Pro Utility Column
          ================================================================= */}
      <aside className="w-full lg:w-[32%] bg-[var(--bg-rail)] border-t lg:border-t-0 border-[var(--border-hairline)] flex flex-col shrink-0 lg:shrink lg:min-h-0 h-auto lg:h-full lg:overflow-y-auto custom-scrollbar">
        {/* TOP UTILITY BAR: Structured Appearance & Sound Controls (Desktop — mobile uses TopStatusBar) */}
        <div className="hidden lg:flex px-6 py-3 border-b border-[var(--border-hairline)] items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot variant={isAlertActive && !isAlreadyReviewed ? 'alert' : 'live'} />
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)] truncate">
              Console Controls
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {toggleDarkMode && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.12 }}
                onClick={toggleDarkMode}
                title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                className="h-7 px-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-hairline)] hover:border-[var(--border-hover)] text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {isDarkMode ? (
                  <>
                    <Sun size={12.5} strokeWidth={1.75} />
                    <span>Light</span>
                  </>
                ) : (
                  <>
                    <Moon size={12.5} strokeWidth={1.75} />
                    <span>Dark</span>
                  </>
                )}
              </motion.button>
            )}

            {toast && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.12 }}
                onClick={toast.toggleAudio}
                title={toast.audioEnabled ? 'Mute alert audio' : 'Unmute alert audio'}
                aria-label={toast.audioEnabled ? 'Mute alert audio' : 'Unmute alert audio'}
                className={`h-7 px-2.5 rounded-lg border text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  toast.audioEnabled
                    ? 'bg-[var(--bg-surface)] border-[var(--border-hairline)] hover:border-[var(--border-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    : 'bg-[var(--status-standby)]/12 border-[var(--status-standby)]/30 text-[var(--status-standby)]'
                }`}
              >
                {toast.audioEnabled ? (
                  <>
                    <Volume2 size={12.5} strokeWidth={1.75} />
                    <span>Sound</span>
                  </>
                ) : (
                  <>
                    <VolumeX size={12.5} strokeWidth={1.75} />
                    <span>Muted</span>
                  </>
                )}
              </motion.button>
            )}
          </div>
        </div>

        {/* SECTION 1: LIVE VEHICLE STATUS */}
        <motion.div
          layout
          transition={SPRING}
          className={`flex-1 min-h-[200px] px-6 py-6 border-b border-[var(--border-hairline)] flex flex-col justify-between relative ${
            isAlertActive && !isAlreadyReviewed ? 'sos-ambient-glow' : ''
          }`}
        >
          <AnimatePresence mode="wait">
            {!isAlertActive ? (
              <motion.div
                key="monitoring-active"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={SPRING}
                className="flex-1 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                    Vehicle Status
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--status-live)]">
                    <StatusDot variant="live" />
                    <span>Protected</span>
                  </span>
                </div>

                <div className="my-auto py-7">
                  <div className="w-10 h-10 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-hairline)] flex items-center justify-center mb-4">
                    <ShieldCheck
                      size={18}
                      strokeWidth={1.75}
                      className="text-[var(--status-live)]"
                    />
                  </div>
                  <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-[var(--text-primary)] leading-tight">
                    Monitoring Active
                  </h2>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                    <span className="font-mono tabular-nums text-[var(--text-primary)]">
                      {selectedVehicle}
                    </span>{' '}
                    is operating normally with{' '}
                    <span className="font-mono tabular-nums text-[var(--text-primary)]">
                      {busCameras.length || 1}
                    </span>{' '}
                    {busCameras.length === 1 ? 'camera' : 'cameras'} linked.
                  </p>
                </div>

                <div className="flex items-center justify-between text-[12px] text-[var(--text-muted)]">
                  <span>Primary Feed</span>
                  <span className="font-mono tabular-nums text-[var(--text-primary)]">
                    {formattedCamLabel}
                  </span>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={`alert-${activeRawAlert.id || activeRawAlert._id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={SPRING}
                className="flex-1 flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--status-alert)]">
                      <StatusDot variant="alert" pulse={!isAlreadyReviewed} />
                      <span>{isSosEvent ? 'Physical SOS Button' : 'Alert Detected'}</span>
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                      {formatIstTime(activeRawAlert.timestamp)} IST
                    </span>
                  </div>

                  <h2 className="text-[21px] font-semibold tracking-[-0.03em] text-[var(--text-primary)] leading-snug">
                    {activeAlert.incident_info.label}
                  </h2>

                  <p className="text-[13px] text-[var(--text-secondary)] mt-1.5">
                    <span className="font-mono text-[var(--text-primary)]">{selectedVehicle}</span>
                    {' · '}
                    <span className="font-mono text-[var(--text-primary)]">
                      {activeAlert.camera_id}
                    </span>
                    {activeAlert.confidence !== null && (
                      <>
                        {' · '}
                        <span className="font-mono tabular-nums text-[var(--text-primary)]">
                          {activeAlert.confidence}%
                        </span>
                      </>
                    )}
                  </p>
                </div>

                {evidenceSrc && (
                  <div className="rounded-xl overflow-hidden bg-black border border-[var(--border-hairline)] h-[126px] shrink-0">
                    <img
                      src={evidenceSrc}
                      alt="Incident snapshot"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                    {hasCoordinates
                      ? `${liveLat.toFixed(5)}, ${liveLon.toFixed(5)}`
                      : 'Location pending'}
                  </span>
                  {isAlreadyReviewed ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--status-live)]">
                      <Check size={12} strokeWidth={2} />
                      <span>Approved</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--status-alert)]">
                      <Radio size={12} strokeWidth={1.75} />
                      <span>Awaiting Dispatch</span>
                    </span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* SECTION 2: TACTILE DISPATCH CONTROLS */}
        <div className="px-6 py-5 border-b border-[var(--border-hairline)] shrink-0 space-y-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Dispatch
            </span>
            <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
              {selectedVehicle}
            </span>
          </div>

          <motion.button
            type="button"
            layout
            transition={SPRING}
            whileTap={sirenActive || isDispatching ? undefined : { scale: 0.98 }}
            onClick={handleApproveAndTriggerSiren}
            disabled={isDispatching || sirenActive}
            className={`relative w-full h-11 rounded-xl overflow-hidden font-medium text-[13px] flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              sirenActive
                ? 'bg-[var(--bg-elevated)] border border-[#FF453A]/50 text-[var(--text-primary)] cursor-default'
                : isAlertActive && !isAlreadyReviewed
                ? 'bg-[#FF453A] hover:bg-[#ff564b] text-white'
                : 'bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-fg)]'
            }`}
          >
            {sirenActive && (
              <motion.div
                className="absolute inset-y-0 left-0 bg-[#FF453A]/35"
                initial={{ width: '100%' }}
                animate={{ width: `${sirenProgressPct}%` }}
                transition={{ duration: 0.05, ease: 'linear' }}
              />
            )}

            <span className="relative z-10 flex items-center gap-2">
              <Siren
                size={15}
                strokeWidth={1.75}
                className={sirenActive ? 'text-[var(--status-alert)]' : ''}
              />
              {sirenActive ? (
                <span className="font-mono tabular-nums text-[12px]">
                  Siren Active on {selectedVehicle} · {sirenSecondsLabel}s
                </span>
              ) : isDispatching ? (
                <span>Sending Command…</span>
              ) : isAlertActive && !isAlreadyReviewed ? (
                <span>Approve &amp; Sound Siren</span>
              ) : (
                <span>Trigger Vehicle Siren</span>
              )}
            </span>
          </motion.button>

          <SecondaryButton
            onClick={handleDismissAlert}
            disabled={!activeRawAlert || isDismissing || activeRawAlert?.status === 'DISMISSED'}
            className="w-full h-9 rounded-xl text-[12px]"
          >
            <X size={13} strokeWidth={1.75} />
            <span>{isDismissing ? 'Dismissing…' : 'Dismiss'}</span>
          </SecondaryButton>
        </div>

        {/* SECTION 3: APPLE INSET HARDWARE TELEMETRY GROUP */}
        <div className="px-6 py-5 shrink-0">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Hardware Telemetry
            </span>
            <StatusDot variant={esp32Online ? 'live' : 'muted'} />
          </div>

          <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-hairline)] px-4">
            <TelemetryRow
              label="GPS Fix"
              value={gpsLocked ? `Locked · ${satellites} Sats` : 'Acquiring'}
              dot={gpsLocked ? 'live' : 'standby'}
              accent={gpsLocked ? 'default' : 'standby'}
            />
            <TelemetryRow
              label="Node IP"
              value={esp32Telemetry?.ip || (esp32Online ? 'Connected' : 'Standby')}
            />
            <TelemetryRow
              label="Telegram"
              value={
                telegramDispatchedAt
                  ? `Sent ${formatIstTime(telegramDispatchedAt)}`
                  : esp32Telemetry?.telegram_configured
                  ? 'Ready'
                  : 'Standby'
              }
              dot={telegramDispatchedAt || esp32Telemetry?.telegram_configured ? 'live' : 'standby'}
            />
            <TelemetryRow
              label="Sync"
              value={
                esp32Online && Number.isFinite(esp32Telemetry?.age_ms)
                  ? `${(esp32Telemetry.age_ms / 1000).toFixed(1)}s ago`
                  : 'Offline'
              }
            />
          </div>
        </div>
      </aside>

      {watchlistOpen && (
        <WatchlistUploadModal
          token={token}
          onClose={() => setWatchlistOpen(false)}
          onUploaded={() => setWatchlistOpen(false)}
        />
      )}
    </main>
  );
}
