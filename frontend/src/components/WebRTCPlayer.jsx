import React, { useRef, useEffect, useState, memo, useCallback } from 'react';
import { Video, WifiOff, Maximize, Minimize, RefreshCw } from 'lucide-react';

/**
 * WebRTCPlayer — connects to a MediaMTX WebRTC (WHEP) endpoint for a single camera.
 * Falls back to HLS <video> if WebRTC negotiation fails.
 *
 * Props:
 *   - cameraId: string (e.g. "CAM_01")
 *   - status: "ONLINE" | "OFFLINE"
 *   - fps: number
 *   - mediamtxUrl: string (e.g. "http://localhost:8889")
 *   - mediamtxHlsUrl: string (e.g. "http://localhost:8888")
 */
const WebRTCPlayer = memo(({ cameraId, status, fps = 0, mediamtxUrl, mediamtxHlsUrl }) => {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const containerRef = useRef(null);
  const isMountedRef = useRef(true);

  const [mode, setMode] = useState('webrtc'); // 'webrtc' | 'hls' | 'offline'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connecting, setConnecting] = useState(true);

  const isOnline = status === 'ONLINE';
  const numericFps = Number(fps) || 0;

  // Sync fullscreen state with native browser event (e.g. user presses Esc)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Guarantee video element is muted in DOM for reliable autoplay policy
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true;
    }
  }, []);

  // Cleanup peer connection and video stream
  const cleanup = useCallback(() => {
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // Ignore close errors
      }
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
    }
  }, []);

  // Helper to safely invoke video.play() across browsers and JSDOM
  const safePlay = () => {
    if (!videoRef.current) return;
    try {
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch {
      // Ignore synchronous play rejection
    }
  };

  // Fallback to HLS
  const fallbackToHLS = useCallback(() => {
    cleanup();
    if (!isMountedRef.current) return;
    setMode('hls');

    if (videoRef.current && mediamtxHlsUrl) {
      const cleanHlsUrl = mediamtxHlsUrl.replace(/\/+$/, '');
      videoRef.current.src = `${cleanHlsUrl}/cam/${cameraId}/index.m3u8`;
      safePlay();
    }
  }, [cameraId, cleanup, mediamtxHlsUrl]);

  // Connect via WebRTC (WHEP) to MediaMTX
  const connectWebRTC = useCallback(async () => {
    cleanup();
    if (!isMountedRef.current) return;
    setConnecting(true);
    setMode('webrtc');

    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
      console.warn(`[WebRTC:${cameraId}] RTCPeerConnection not supported in this environment`);
      fallbackToHLS();
      return;
    }

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      // TransGuard cameras only push video (libx264). Audio is not published.
      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (!isMountedRef.current || !videoRef.current) return;
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
        safePlay();
      };

      pc.oniceconnectionstatechange = () => {
        if (!pcRef.current) return;
        if (pc.iceConnectionState === 'failed') {
          console.warn(`[WebRTC:${cameraId}] Connection failed, attempting HLS fallback`);
          fallbackToHLS();
        } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          if (isMountedRef.current) setConnecting(false);
        }
      };

      const offer = await pc.createOffer();
      if (!isMountedRef.current || pcRef.current !== pc) return;
      await pc.setLocalDescription(offer);

      const cleanMediaUrl = (mediamtxUrl || '').replace(/\/+$/, '');
      const whepUrl = `${cleanMediaUrl}/cam/${cameraId}/whep`;

      const res = await fetch(whepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp,
      });

      if (!res.ok) {
        throw new Error(`WHEP request failed: ${res.status}`);
      }

      const answerSdp = await res.text();
      if (!isMountedRef.current || pcRef.current !== pc) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    } catch (err) {
      if (!isMountedRef.current) return;
      console.warn(`[WebRTC:${cameraId}] Failed:`, err.message);
      fallbackToHLS();
    }
  }, [cameraId, cleanup, fallbackToHLS, mediamtxUrl]);

  // Retry connection on button click
  const retryConnection = () => {
    if (!isOnline) return;
    connectWebRTC();
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    if (isOnline) {
      connectWebRTC();
    } else {
      cleanup();
      setMode('offline');
      setConnecting(false);
    }

    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [cameraId, isOnline, connectWebRTC, cleanup]);

  return (
    <div
      ref={containerRef}
      className="relative bg-black rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 group shadow-sm hover:shadow-lg transition-shadow"
    >
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onPlaying={() => setConnecting(false)}
        onLoadedData={() => setConnecting(false)}
        className={`w-full aspect-video object-cover ${!isOnline || connecting ? 'opacity-30' : 'opacity-100'} transition-opacity`}
      />

      {/* Offline overlay */}
      {!isOnline && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
          <WifiOff size={36} className="text-red-400 mb-3" />
          <span className="text-sm font-bold text-red-400 uppercase tracking-wider">Camera Offline</span>
        </div>
      )}

      {/* Connecting overlay */}
      {isOnline && connecting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-3" />
          <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Connecting Stream...</span>
        </div>
      )}

      {/* Top bar: Camera ID + Status */}
      <div className="absolute top-0 left-0 right-0 px-3 py-2 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-2">
          <Video size={14} className="text-white/80" />
          <span className="text-xs font-bold text-white tracking-wider">{cameraId}</span>
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]'}`} />
        </div>

        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {isOnline && (
            <button
              type="button"
              onClick={retryConnection}
              className="p-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
              title="Reconnect stream"
              aria-label="Reconnect stream"
            >
              <RefreshCw size={12} className="text-white/80" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
            title="Fullscreen"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen
              ? <Minimize size={12} className="text-white/80" />
              : <Maximize size={12} className="text-white/80" />
            }
          </button>
        </div>
      </div>

      {/* Bottom bar: FPS + Mode */}
      <div className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center gap-3">
          {isOnline && (
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">
              {numericFps > 0 ? `${numericFps.toFixed(1)} FPS` : 'LIVE'}
            </span>
          )}
          <span className="text-[10px] font-bold text-white/50 uppercase">
            {mode === 'webrtc' ? 'WebRTC' : mode === 'hls' ? 'HLS' : '—'}
          </span>
        </div>

        {isOnline && (
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-red-400">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            REC
          </span>
        )}
      </div>
    </div>
  );
});

WebRTCPlayer.displayName = 'WebRTCPlayer';
export default WebRTCPlayer;
