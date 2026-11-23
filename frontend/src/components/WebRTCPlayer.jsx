import React, { useRef, useEffect, useState, memo, useCallback } from 'react';
import { VideoOff, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { StatusDot } from './ui/LuxuryPrimitives';

const WebRTCPlayer = memo(({ cameraId, status, fps = 0, mediamtxUrl, mediamtxHlsUrl }) => {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const containerRef = useRef(null);
  const isMountedRef = useRef(true);

  const [mode, setMode] = useState('webrtc');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connecting, setConnecting] = useState(true);

  const isOnline = status === 'ONLINE';
  const numericFps = Number(fps) || 0;

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = true;
  }, []);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // Ignore
      }
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
    }
  }, []);

  const safePlay = () => {
    if (!videoRef.current) return;
    try {
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch {
      // Ignore
    }
  };

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
          fallbackToHLS();
        } else if (
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed'
        ) {
          if (isMountedRef.current) setConnecting(false);
        }
      };

      const offer = await pc.createOffer();
      if (!isMountedRef.current || pcRef.current !== pc) return;
      await pc.setLocalDescription(offer);

      const cleanMediaUrl = (mediamtxUrl || '').replace(/\/+$/, '');
      const res = await fetch(`${cleanMediaUrl}/cam/${cameraId}/whep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp,
      });

      if (!res.ok) throw new Error(`Stream request failed: ${res.status}`);
      const answerSdp = await res.text();
      if (!isMountedRef.current || pcRef.current !== pc) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch {
      if (!isMountedRef.current) return;
      fallbackToHLS();
    }
  }, [cameraId, cleanup, fallbackToHLS, mediamtxUrl]);

  const retryConnection = () => {
    if (!isOnline) return;
    connectWebRTC();
  };

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
      className="relative dot-grid-standby rounded-2xl overflow-hidden border border-white/[0.06] group"
      style={{ boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.06)' }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onPlaying={() => setConnecting(false)}
        onLoadedData={() => setConnecting(false)}
        className={`w-full aspect-video object-cover ${
          !isOnline || connecting ? 'opacity-0' : 'opacity-100'
        } transition-opacity duration-300`}
      />

      {/* Calm Monochrome Signal Standby Overlay — ZERO loud red screens */}
      {!isOnline && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <VideoOff size={20} strokeWidth={1.5} className="text-white/[0.24]" />
          <span className="text-[12px] font-medium text-white/[0.44] tracking-[-0.01em]">
            Signal Standby
          </span>
        </div>
      )}

      {isOnline && connecting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
          <div className="w-5 h-5 border border-white/20 border-t-white/70 rounded-full animate-spin" />
          <span className="text-[11px] text-white/[0.44]">Connecting feed</span>
        </div>
      )}

      {/* Top Glass HUD */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
        <div className="luxury-glass h-7 px-2.5 rounded-lg flex items-center gap-2 text-[11px]">
          <StatusDot variant={isOnline ? 'live' : 'muted'} />
          <span className="font-mono tabular-nums font-medium text-white/[0.90]">{cameraId}</span>
        </div>

        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {isOnline && (
            <button
              type="button"
              onClick={retryConnection}
              className="luxury-glass h-7 w-7 rounded-lg flex items-center justify-center text-white/[0.72] hover:text-white cursor-pointer"
              title="Reconnect stream"
              aria-label="Reconnect stream"
            >
              <RefreshCw size={12} strokeWidth={1.75} />
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="luxury-glass h-7 w-7 rounded-lg flex items-center justify-center text-white/[0.72] hover:text-white cursor-pointer"
            title="Fullscreen"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 size={12} strokeWidth={1.75} />
            ) : (
              <Maximize2 size={12} strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>

      {/* Bottom Subtle Telemetry Bar */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        {isOnline && (
          <div className="luxury-glass h-6 px-2.5 rounded-md flex items-center gap-2 font-mono tabular-nums text-[10px] text-white/[0.76]">
            <span>{numericFps > 0 ? `${numericFps.toFixed(1)} FPS` : 'Live'}</span>
            <span className="text-white/20">·</span>
            <span className="uppercase text-white/[0.48]">
              {mode === 'webrtc' ? 'WebRTC' : 'HLS'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

WebRTCPlayer.displayName = 'WebRTCPlayer';
export default WebRTCPlayer;
