import React, { useRef, useEffect, useState, memo } from 'react';
import { Video, WifiOff, Maximize, Minimize, RefreshCw } from 'lucide-react';

/**
 * WebRTCPlayer — connects to a MediaMTX WebRTC endpoint for a single camera.
 * Falls back to HLS <video> if WebRTC negotiation fails.
 *
 * Props:
 *   - cameraId: string (e.g. "CAM_01")
 *   - status: "ONLINE" | "OFFLINE"
 *   - fps: number
 *   - mediamtxUrl: string (e.g. "http://localhost:8889")
 *   - mediamtxHlsUrl: string (e.g. "http://localhost:8888")
 */
const WebRTCPlayer = memo(({ cameraId, status, fps, mediamtxUrl, mediamtxHlsUrl }) => {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const [mode, setMode] = useState('webrtc'); // 'webrtc' | 'hls' | 'offline'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const containerRef = useRef(null);

  const isOnline = status === 'ONLINE';

  // Cleanup function
  const cleanup = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = '';
    }
  };

  // Connect via WebRTC to MediaMTX
  const connectWebRTC = async () => {
    cleanup();
    setConnecting(true);

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcRef.current = pc;

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setConnecting(false);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          console.warn(`[WebRTC:${cameraId}] Connection failed, falling back to HLS`);
          fallbackToHLS();
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // MediaMTX WebRTC WHEP endpoint
      const whepUrl = `${mediamtxUrl}/cam/${cameraId}/whep`;
      const res = await fetch(whepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp
      });

      if (!res.ok) {
        throw new Error(`WHEP request failed: ${res.status}`);
      }

      const answerSdp = await res.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    } catch (err) {
      console.warn(`[WebRTC:${cameraId}] Failed:`, err.message);
      fallbackToHLS();
    }
  };

  // Fallback to HLS
  const fallbackToHLS = () => {
    cleanup();
    setMode('hls');
    setConnecting(false);

    if (videoRef.current && mediamtxHlsUrl) {
      videoRef.current.src = `${mediamtxHlsUrl}/cam/${cameraId}/index.m3u8`;
      videoRef.current.play().catch(() => {});
    }
  };

  // Retry connection
  const retryConnection = () => {
    setMode('webrtc');
    connectWebRTC();
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  useEffect(() => {
    if (isOnline) {
      connectWebRTC();
    } else {
      cleanup();
      setMode('offline');
      setConnecting(false);
    }

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, isOnline]);

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
          <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Connecting...</span>
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
          <button
            onClick={retryConnection}
            className="p-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
            title="Reconnect"
          >
            <RefreshCw size={12} className="text-white/80" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
            title="Fullscreen"
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
              {fps > 0 ? `${fps.toFixed(1)} FPS` : 'LIVE'}
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
