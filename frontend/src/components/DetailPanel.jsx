import React, { memo } from 'react';
import { ShieldCheck, X, ArrowUpRight, MoreVertical, AlertTriangle, Eye, Camera } from 'lucide-react';
import { getEnrichedData, getSeverityStyles } from '../utils/alertUtils';
import { API_BASE_URL } from '../config';

const DetailPanel = memo(({ alert: rawAlert, onClose }) => {
  if (!rawAlert) {
    return (
      <div className="absolute top-4 right-4 bottom-4 w-[400px] bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.6)] dark:ring-1 dark:ring-white/10 rounded-xl flex flex-col items-center justify-center z-10 border border-gray-100 dark:border-white/5">
        <ShieldCheck size={48} className="text-gray-200 dark:text-gray-700 mb-4" />
        <h3 className="text-gray-400 dark:text-zinc-500 font-medium text-sm">Select an event to view details</h3>
      </div>
    );
  }

  const alert = getEnrichedData(rawAlert);
  const severityStyle = getSeverityStyles(alert.incident_info.severity);

  return (
    <div className="hidden lg:flex absolute top-4 bottom-4 right-4 w-[420px] bg-white/95 dark:bg-zinc-900/90 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.6)] dark:ring-1 dark:ring-white/10 border border-gray-200/50 dark:border-white/10 flex-col z-[1000] overflow-hidden animate-fade-in-up">
      {/* Tabs */}
      <div className="flex items-center gap-6 px-6 pt-5 border-b border-gray-100 dark:border-white/5 shrink-0">
        <button className="pb-3 text-[13px] font-semibold text-gray-900 dark:text-zinc-100 border-b-2 border-gray-900 dark:border-indigo-500">Overview</button>
        <button className="pb-3 text-[13px] font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors">Camera</button>
        <button className="pb-3 text-[13px] font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors">History</button>
        <button className="pb-3 text-[13px] font-medium text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors">Export</button>
        <button type="button" onClick={onClose} className="ml-auto mb-3 p-1 text-gray-400 dark:text-zinc-500 hover:text-gray-900 dark:hover:text-white" aria-label="Close incident details"><X size={18} /></button>
      </div>

      <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
        {/* Title block */}
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 tracking-tight">{alert.bus_cam_id}</h2>
            {/* Signal bars */}
            <div className="flex items-end gap-[2px] h-4 mb-1">
              <div className="w-[3px] h-2 bg-gray-900 dark:bg-indigo-500"></div>
              <div className="w-[3px] h-2.5 bg-gray-900 dark:bg-indigo-500"></div>
              <div className="w-[3px] h-3.5 bg-gray-900 dark:bg-indigo-500"></div>
              <div className="w-[3px] h-4 bg-gray-300"></div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-gray-500 dark:text-zinc-400">
            <ArrowUpRight size={18} className="cursor-pointer hover:text-gray-900 dark:hover:text-white" />
            <MoreVertical size={18} className="cursor-pointer hover:text-gray-900 dark:hover:text-white" />
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-[130px_1fr] gap-y-3.5 text-[13px] mb-8">
          <div className="text-gray-400 dark:text-zinc-500 font-medium">Vehicle Type</div>
          <div className="text-gray-900 dark:text-zinc-100 font-medium uppercase">City Bus - Route 42</div>

          <div className="text-gray-400 dark:text-zinc-500 font-medium">Incident Time</div>
          <div className="text-gray-900 dark:text-zinc-100 font-medium">{new Date(alert.timestamp).toLocaleTimeString()}</div>

          <div className="text-gray-400 dark:text-zinc-500 font-medium">Recorded Speed</div>
          <div className="text-gray-900 dark:text-zinc-100 font-medium">{alert.speed} km/h</div>

          <div className="text-gray-400 dark:text-zinc-500 font-medium">GPS Coordinates</div>
          <div className="text-gray-900 dark:text-zinc-100 font-medium">
            {Number.isFinite(alert.gps?.lat) && Number.isFinite(alert.gps?.lon)
              ? `${alert.gps.lat.toFixed(4)}, ${alert.gps.lon.toFixed(4)}`
              : 'Location unavailable'}
          </div>

          <div className="text-gray-400 dark:text-zinc-500 font-medium">Camera Node</div>
          <div className="text-gray-900 dark:text-zinc-100 font-medium uppercase">192.168.1.104 (Tapo C100)</div>
        </div>

        <div className="h-px bg-gray-100 dark:bg-white/5 w-full mb-6"></div>

        {/* Watchlist / AI Review Section */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900 dark:text-zinc-100 text-[15px]">AI Incident Analysis</h3>
          <button className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 dark:text-zinc-100 bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 shadow-sm px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-white/10 dark:bg-[#1e1e1e] transition-colors">
            <Eye size={12} /> View stream
          </button>
        </div>

        <div className="bg-gray-50 dark:bg-[#1e1e1e] border border-gray-200 dark:border-white/10 rounded-lg p-4 mb-6 shadow-sm">
          <div className="grid grid-cols-[130px_1fr] gap-y-3.5 text-[13px]">
            <div className="text-gray-400 dark:text-zinc-500 font-medium flex items-start gap-1.5">
              <AlertTriangle size={14} className={severityStyle.text} fill="currentColor" />
              AI Trigger
            </div>
            <div className="text-gray-900 dark:text-zinc-100 font-bold flex flex-col gap-1.5">
              <span className={severityStyle.text}>{alert.incident_info.label}</span>
            </div>

            {alert.incident_type === 'WATCHLIST_MATCH' ? (
              <>
                <div className="text-gray-400 dark:text-zinc-500 font-medium">Subject Match</div>
                <div className="text-orange-600 font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse"></span>
                  Pending Review
                </div>

                <div className="text-gray-400 dark:text-zinc-500 font-medium">Confidence Score</div>
                <div className="text-gray-900 dark:text-zinc-100 font-bold">87%</div>

                <div className="text-gray-400 dark:text-zinc-500 font-medium pt-2">Action Required</div>
                <div className="flex items-center gap-2 pt-1">
                  <button className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors">Confirm</button>
                  <button className="flex-1 bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl hover:bg-gray-100 dark:hover:bg-white/10 dark:bg-white/5 text-gray-700 dark:text-zinc-200 border border-gray-300 dark:border-gray-600 font-bold py-1.5 px-3 rounded text-xs transition-colors">Dismiss</button>
                </div>
              </>
            ) : (
              <>
                <div className="text-gray-400 dark:text-zinc-500 font-medium">Driver Status</div>
                <div className="text-gray-900 dark:text-zinc-100 font-medium">{alert.driver} (Active)</div>

                <div className="text-gray-400 dark:text-zinc-500 font-medium pt-2">Action Required</div>
                <div className="flex items-center gap-2 pt-1">
                  <button className="bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-zinc-200 font-semibold py-1.5 px-4 rounded text-xs transition-colors">Acknowledge Alert</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Camera Image */}
        {(alert.evidence_image_base64 || alert.evidence_image_url) ? (
          <div className="mt-2">
            <div className="rounded-xl overflow-hidden bg-black mb-1.5 relative border border-gray-200 dark:border-white/10">
              <img src={alert.evidence_image_url ? (alert.evidence_image_url.startsWith('/') ? `${API_BASE_URL}${alert.evidence_image_url}` : alert.evidence_image_url) : `data:image/jpeg;base64,${alert.evidence_image_base64}`} alt="Incident evidence" className="w-full object-cover opacity-90" />
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[0, 1, 2, 3].map((frame) => <div key={frame} className={`bg-gray-200 dark:bg-white/10 aspect-video rounded-md overflow-hidden ${frame ? 'opacity-70' : ''}`}><img src={alert.evidence_image_url ? (alert.evidence_image_url.startsWith('/') ? `${API_BASE_URL}${alert.evidence_image_url}` : alert.evidence_image_url) : `data:image/jpeg;base64,${alert.evidence_image_base64}`} alt={`Evidence frame ${frame + 1}`} className="w-full h-full object-cover" /></div>)}
            </div>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1e1e1e] aspect-video flex items-center justify-center text-gray-300 dark:text-zinc-500 mt-2">
            <Camera size={32} />
          </div>
        )}
      </div>
    </div>
  );
});

export default DetailPanel;
