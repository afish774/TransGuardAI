import React, { useState, useEffect } from 'react';
import { Camera, Plus, RefreshCw, XCircle } from 'lucide-react';
import WebRTCPlayer from '../components/WebRTCPlayer';
import { API_BASE_URL, MEDIA_MTX_URL, MEDIA_MTX_HLS_URL } from '../config';

export const CameraNodesView = ({ activeCameras = [], token }) => {
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [cameraId, setCameraId] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState('');

  useEffect(() => {
    if (!isProvisionModalOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsProvisionModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProvisionModalOpen]);

  const handleProvisionSubmit = async (e) => {
    e.preventDefault();
    setProvisionError('');

    let cleanRtsp = rtspUrl.trim();
    // Auto-correct common typo 'rstp://' -> 'rtsp://'
    if (cleanRtsp.toLowerCase().startsWith('rstp://')) {
      cleanRtsp = 'rtsp://' + cleanRtsp.slice(7);
      setRtspUrl(cleanRtsp);
    }

    if (!cleanRtsp.match(/^(rtsp|rtsps|http|https):\/\/.+/i)) {
      setProvisionError('RTSP URL must start with rtsp:// or rtsps:// (e.g. rtsp://192.168.1.100:554/stream).');
      return;
    }

    setIsProvisioning(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/edge/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ camera_id: cameraId.trim(), rtsp_url: cleanRtsp }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setIsProvisionModalOpen(false);
        setCameraId('');
        setRtspUrl('');
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
    if (count <= 2) return 'grid-cols-1 lg:grid-cols-2';
    if (count <= 4) return 'grid-cols-1 md:grid-cols-2';
    return 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
  };

  const onlineCameras = activeCameras.filter(c => c.status === 'ONLINE');
  const offlineCameras = activeCameras.filter(c => c.status !== 'ONLINE');

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-6 md:p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-zinc-100 tracking-tight">Camera Grid Operations</h1>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
              {onlineCameras.length} online · {offlineCameras.length} offline · {activeCameras.length} registered
            </p>
          </div>
          <button type="button" onClick={() => setIsProvisionModalOpen(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-lg shadow-sm transition-colors flex items-center gap-2 self-start sm:self-auto">
            <Plus size={15} /> Provision Node
          </button>
        </div>

        {activeCameras.length > 0 ? (
          <div className={`grid ${getGridCols(activeCameras.length)} gap-6 mb-8`}>
            {activeCameras.map((cam) => (
              <WebRTCPlayer key={cam.camera_id} cameraId={cam.camera_id} status={cam.status} fps={cam.fps || 0} mediamtxUrl={MEDIA_MTX_URL} mediamtxHlsUrl={MEDIA_MTX_HLS_URL} />
            ))}
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl p-12 md:p-16 flex flex-col items-center justify-center text-center shadow-sm mb-8">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center mb-4">
              <Camera size={28} className="text-gray-400 dark:text-zinc-500" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-2">No Active Cameras Connected</h3>
            <p className="text-sm text-gray-500 dark:text-zinc-400 max-w-md mb-4">
              Start your Python edge engine instance to link RTSP camera streams. Each engine pushes a telemetry heartbeat every 10 seconds.
            </p>
            <code className="text-xs bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-white/10 rounded-lg px-4 py-2.5 text-gray-600 dark:text-zinc-400 font-mono">
              python trans_guard_engine.py --camera CAM_01 --url rtsp://&lt;IP&gt;:554/stream
            </code>
          </div>
        )}

        {activeCameras.length > 0 && (
          <div className="bg-white dark:bg-zinc-900/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/5 flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider">Node Hardware Telemetry</h3>
              <span className="text-xs text-gray-400 dark:text-zinc-500 font-mono">Edge Cluster</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-white/5">
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Camera ID</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Node Host</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Throughput</th>
                    <th className="py-3 px-6 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Last Heartbeat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {activeCameras.map((cam) => (
                    <tr key={cam.camera_id} className="hover:bg-gray-50/60 dark:hover:bg-white/5 transition-colors">
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-white/10 flex items-center justify-center">
                            <Camera size={14} className="text-gray-600 dark:text-zinc-300" />
                          </div>
                          <span className="font-semibold text-gray-900 dark:text-zinc-100">{cam.camera_id}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        {cam.status === 'ONLINE' ? (
                          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium text-sm">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" /> Online
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-medium text-sm">
                            <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" /> Offline
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-6 text-sm text-gray-600 dark:text-zinc-400 font-mono">{cam.node_id || 'edge-local'}</td>
                      <td className="py-4 px-6 text-sm text-gray-600 dark:text-zinc-400">
                        {cam.fps > 0 ? <span className="font-semibold text-gray-900 dark:text-zinc-200">{cam.fps.toFixed(1)} FPS</span> : '—'}
                      </td>
                      <td className="py-4 px-6 text-sm text-gray-600 dark:text-zinc-400">
                        {cam.last_heartbeat ? new Date(cam.last_heartbeat).toLocaleTimeString() : 'Recent'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isProvisionModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-labelledby="provision-modal-title">
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
              <button type="button" onClick={() => setIsProvisionModalOpen(false)} aria-label="Close provision modal" className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                <XCircle size={20} />
              </button>
              <h2 id="provision-modal-title" className="text-xl font-bold text-gray-900 dark:text-zinc-100 mb-1">Provision AI Edge Node</h2>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mb-5">Register a new camera RTSP stream for YOLOv8 edge analysis.</p>
              {provisionError && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-xs rounded-lg">{provisionError}</div>
              )}
              <form onSubmit={handleProvisionSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">Camera ID</label>
                  <input type="text" required placeholder="e.g. CAM_02" value={cameraId} onChange={(e) => setCameraId(e.target.value)} className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-white/10 rounded-lg px-3.5 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">RTSP Stream URL</label>
                  <input type="text" required placeholder="rtsp://192.168.1.100:554/stream" value={rtspUrl} onChange={(e) => setRtspUrl(e.target.value)} className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-white/10 rounded-lg px-3.5 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="pt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setIsProvisionModalOpen(false)} className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors">Cancel</button>
                  <button type="submit" disabled={isProvisioning} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2">
                    {isProvisioning ? (<><RefreshCw size={14} className="animate-spin" /> Deploying...</>) : 'Deploy Node'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
