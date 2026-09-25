import React from 'react';
import { ShieldAlert, Cpu } from 'lucide-react';

export const DocsView = () => {
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-6 md:p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-black text-gray-900 dark:text-zinc-100 mb-6 tracking-tight">System Architecture & Edge Documentation</h1>
        <div className="bg-white dark:bg-zinc-900/80 border border-gray-200 dark:border-white/10 rounded-2xl p-6 md:p-8 shadow-sm space-y-6 text-sm text-gray-700 dark:text-zinc-300">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">6-Pillar Edge Surveillance Overview</h2>
            <p className="leading-relaxed text-gray-600 dark:text-zinc-400">
              Trans Guard AI runs an isolated 4-process Python edge pipeline (<code className="text-xs font-mono bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">capture</code>, <code className="text-xs font-mono bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">inference</code>, <code className="text-xs font-mono bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">publisher</code>, <code className="text-xs font-mono bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">telemetry</code>) operating locally with hardware-accelerated YOLOv8 tracking and MediaMTX WebRTC broadcasting.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-zinc-950/60 border border-gray-200 dark:border-white/10">
              <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                <ShieldAlert size={16} className="text-indigo-500" /> Active Pillars
              </h3>
              <ul className="text-xs space-y-1.5 text-gray-600 dark:text-zinc-400 list-disc list-inside">
                <li><strong>Pillar 1 (Overcrowding):</strong> 15-frame temporal consensus + hysteresis.</li>
                <li><strong>Pillar 2 (Lost &amp; Found):</strong> ByteTrack 10px drift tolerance &amp; 45s dwell.</li>
                <li><strong>Pillar 3 (Fall Detection):</strong> Aspect ratio + nose vs hip elevation.</li>
                <li><strong>Pillar 4 (Weapons):</strong> Crop-level YOLO secondary inference.</li>
                <li><strong>Pillar 5 (Violence):</strong> Pairwise IoU overlap + wrist velocity.</li>
                <li><strong>Pillar 6 (Face &amp; Watchlist):</strong> 128-d ResNet metric embeddings &amp; track memoisation.</li>
              </ul>
            </div>
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-zinc-950/60 border border-gray-200 dark:border-white/10">
              <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                <Cpu size={16} className="text-indigo-500" /> Streaming &amp; Telemetry
              </h3>
              <ul className="text-xs space-y-1.5 text-gray-600 dark:text-zinc-400 list-disc list-inside">
                <li><strong>MediaMTX RTSP Pipe:</strong> <code className="font-mono">rtsp://127.0.0.1:8554/cam/CAM_01</code></li>
                <li><strong>WebRTC Player:</strong> Low-latency WHEP protocol on port 8889.</li>
                <li><strong>Node Heartbeat:</strong> JSON ping every 10s to <code className="font-mono">/api/edge/heartbeat</code>.</li>
                <li><strong>Watchlist Sync:</strong> Periodic sync every 30s with automatic cache eviction.</li>
              </ul>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-indigo-50/60 dark:bg-indigo-500/10 border border-indigo-200/50 dark:border-indigo-500/20 text-xs text-indigo-900 dark:text-indigo-200">
            <h4 className="font-bold mb-1">Starting Edge Nodes Locally</h4>
            <p className="font-mono bg-white dark:bg-zinc-950 p-2.5 rounded-lg border border-indigo-200 dark:border-indigo-500/30 text-[11px] text-gray-800 dark:text-zinc-200 overflow-x-auto">
              python trans_guard_engine.py --camera CAM_01 --url rtsp://&lt;CAMERA_IP&gt;:554/stream --headless
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
