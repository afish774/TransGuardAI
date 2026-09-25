import React, { memo, useState, useEffect } from 'react';
import { ShieldCheck, X, Eye, Camera, Check, ShieldAlert, Cpu, Trash2, AlertTriangle } from 'lucide-react';
import { getEnrichedData, getSeverityStyles } from '../utils/alertUtils';
import { API_BASE_URL } from '../config';

const DetailPanel = memo(({ alert: rawAlert, onClose, onDeleteAlert }) => {
  const [activeTab, setActiveTab] = useState('Overview');
  const [acknowledged, setAcknowledged] = useState(false);
  const [watchlistDecision, setWatchlistDecision] = useState(null); // 'confirmed' | 'dismissed'
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
    setIsDeleting(false);
    setAcknowledged(false);
    setWatchlistDecision(null);
  }, [rawAlert?.id, rawAlert?._id]);

  if (!rawAlert) {
    return (
      <div className="absolute top-4 right-4 bottom-4 w-[400px] bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.6)] dark:ring-1 dark:ring-white/10 rounded-xl flex flex-col items-center justify-center z-10 border border-gray-100 dark:border-white/5">
        <ShieldCheck size={48} className="text-gray-200 dark:text-zinc-700 mb-4" />
        <h3 className="text-gray-400 dark:text-zinc-500 font-medium text-sm">Select an incident to view details</h3>
      </div>
    );
  }

  const alert = getEnrichedData(rawAlert);
  const severityStyle = getSeverityStyles(alert.incident_info.severity);
  const evidenceSrc = alert.evidence_image_url
    ? (alert.evidence_image_url.startsWith('/') ? `${API_BASE_URL}${alert.evidence_image_url}` : alert.evidence_image_url)
    : alert.evidence_image_base64
    ? `data:image/jpeg;base64,${alert.evidence_image_base64}`
    : null;

  return (
    <div
      className="hidden lg:flex absolute top-4 bottom-4 right-4 w-[420px] bg-white/95 dark:bg-zinc-900/90 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.6)] dark:ring-1 dark:ring-white/10 border border-gray-200/50 dark:border-white/10 flex-col z-[1000] overflow-hidden"
      style={{ animation: 'detail-slide-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      {/* Severity accent bar */}
      <div className={`h-1 w-full shrink-0 ${severityStyle.bar}`} />
      <style>{`
        @keyframes detail-slide-in {
          0% { opacity: 0; transform: translateX(30px); }
          100% { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      {/* Navigation Tabs */}
      <div className="flex items-center gap-6 px-6 pt-5 border-b border-gray-100 dark:border-white/5 shrink-0">
        {['Overview', 'Metadata', 'Evidence'].map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-[13px] font-semibold transition-colors border-b-2 ${
              activeTab === tab
                ? 'text-gray-900 dark:text-zinc-100 border-indigo-600 dark:border-indigo-500'
                : 'text-gray-400 dark:text-zinc-500 border-transparent hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto mb-3 p-1.5 rounded-lg text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white transition-colors"
          aria-label="Close incident details"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
        {/* Title Block */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded uppercase tracking-wider bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30">
                {alert.pillar}
              </span>
              <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500">
                {alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString() : 'Live'}
              </span>
            </div>
            <h2 className="text-2xl font-black text-gray-900 dark:text-zinc-100 tracking-tight">{alert.camera_id}</h2>
          </div>

        </div>

        {/* Tab 1: Overview */}
        {activeTab === 'Overview' && (
          <>
            {/* Primary Metrics Grid */}
            <div className="grid grid-cols-[130px_1fr] gap-y-3.5 text-[13px] mb-6">
              <div className="text-gray-400 dark:text-zinc-500 font-medium">Detection Pillar</div>
              <div className="text-gray-900 dark:text-zinc-100 font-bold">{alert.incident_info.label}</div>

              <div className="text-gray-400 dark:text-zinc-500 font-medium">Edge Sensor</div>
              <div className="text-gray-900 dark:text-zinc-100 font-mono font-medium">{alert.camera_id} (RTSP/WebRTC)</div>

              <div className="text-gray-400 dark:text-zinc-500 font-medium">Confidence</div>
              <div className="text-gray-900 dark:text-zinc-100 font-semibold">{alert.confidence}%</div>

              <div className="text-gray-400 dark:text-zinc-500 font-medium">Spatial Anchor</div>
              <div className="text-gray-900 dark:text-zinc-100 font-medium">
                {Number.isFinite(alert.gps?.lat) && Number.isFinite(alert.gps?.lon)
                  ? `${alert.gps.lat.toFixed(4)}, ${alert.gps.lon.toFixed(4)}`
                  : 'Calibrated Vision Zone'}
              </div>

              <div className="text-gray-400 dark:text-zinc-500 font-medium">Operator Status</div>
              <div className="font-semibold">
                {acknowledged ? (
                  <span className="text-emerald-500 flex items-center gap-1">
                    <Check size={14} /> Acknowledged by Operator
                  </span>
                ) : (
                  <span className="text-amber-500">Unacknowledged Alert</span>
                )}
              </div>
            </div>

            <div className="h-px bg-gray-100 dark:bg-white/5 w-full mb-6"></div>

            {/* AI Incident Analysis Box */}
            <div className="bg-gray-50 dark:bg-zinc-950/60 border border-gray-200 dark:border-white/10 rounded-xl p-4 mb-6 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 font-bold text-sm text-gray-900 dark:text-zinc-100">
                  <ShieldAlert size={16} className={severityStyle.text} />
                  <span>AI Verification Assessment</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${severityStyle.text} bg-gray-100 dark:bg-white/5`}>
                  {alert.incident_info.severity}
                </span>
              </div>

              {alert.incident_type === 'WATCHLIST_MATCH' ? (
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-zinc-400">Subject Match</span>
                    <span className="font-bold text-gray-900 dark:text-white">{alert.metadata?.identity || 'Target Identity'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-zinc-400">Track ID</span>
                    <span className="font-mono text-gray-900 dark:text-white">#{alert.metadata?.trackId ?? alert.trackId ?? '—'}</span>
                  </div>
                  <div className="pt-2 border-t border-gray-200 dark:border-white/10">
                    {watchlistDecision ? (
                      <p className="text-center font-bold text-emerald-600 dark:text-emerald-400 py-1">
                        Decision recorded: {watchlistDecision.toUpperCase()}
                      </p>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setWatchlistDecision('confirmed')}
                          className="flex-1 py-1.5 px-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs transition-colors"
                        >
                          Confirm Match
                        </button>
                        <button
                          type="button"
                          onClick={() => setWatchlistDecision('dismissed')}
                          className="flex-1 py-1.5 px-3 bg-white dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 text-gray-700 dark:text-zinc-200 border border-gray-300 dark:border-white/15 font-bold rounded-lg text-xs transition-colors"
                        >
                          Dismiss Match
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  <p className="text-gray-600 dark:text-zinc-300 leading-relaxed">
                    Triggered under Pillar: <strong className="text-gray-900 dark:text-white">{alert.pillar}</strong>. High-confidence edge model verification passed consensus threshold.
                  </p>
                  <div className="pt-1 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setAcknowledged(true)}
                      disabled={acknowledged}
                      className={`w-full py-2 px-4 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2 ${
                        acknowledged
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 cursor-default'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md'
                      }`}
                    >
                      {acknowledged ? (
                        <>
                          <Check size={14} /> Incident Acknowledged
                        </>
                      ) : (
                        'Acknowledge Incident'
                      )}
                    </button>

                    {onDeleteAlert && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirmDelete) {
                              setConfirmDelete(true);
                              return;
                            }
                            setIsDeleting(true);
                            await onDeleteAlert(alert.id || alert._id);
                            setIsDeleting(false);
                            setConfirmDelete(false);
                          }}
                          disabled={isDeleting}
                          className={`w-full py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 border ${
                            confirmDelete
                              ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 shadow-md animate-pulse'
                              : 'bg-transparent hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                          }`}
                        >
                          {confirmDelete ? <AlertTriangle size={14} /> : <Trash2 size={14} />}
                          {isDeleting
                            ? 'Deleting Incident...'
                            : confirmDelete
                            ? 'Confirm: Delete Irrelevant Alert?'
                            : 'Delete Alert (Not Relevant)'}
                        </button>
                        {confirmDelete && (
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            className="w-full text-center text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300 py-0.5"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Tab 2: Metadata */}
        {activeTab === 'Metadata' && (
          <div className="space-y-4 text-xs animate-in fade-in duration-150">
            <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 bg-gray-50/50 dark:bg-zinc-950/50">
              <div className="flex items-center gap-2 font-bold text-gray-900 dark:text-white mb-3">
                <Cpu size={15} className="text-indigo-500" />
                <span>Detection Sensor Parameters</span>
              </div>
              <pre className="p-3 bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-white/5 font-mono text-[11px] text-gray-800 dark:text-zinc-200 overflow-x-auto">
                {JSON.stringify(
                  {
                    camera_id: alert.camera_id,
                    incident_type: alert.incident_type,
                    pillar: alert.pillar,
                    confidence: alert.confidence,
                    timestamp: alert.timestamp,
                    metadata: alert.metadata || {},
                    gps: alert.gps || null
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          </div>
        )}

        {/* Tab 3: Evidence */}
        {activeTab === 'Evidence' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {evidenceSrc ? (
              <div>
                <div className="rounded-xl overflow-hidden bg-black border border-gray-200 dark:border-white/10 shadow-lg relative group">
                  <img src={evidenceSrc} alt="Incident evidence snapshot" className="w-full object-contain max-h-[300px]" />
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-[10px] font-mono text-white font-bold">
                    EVIDENCE FRAME
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-2 text-center">
                  Tamper-evident frame snapshot captured at inference timestamp.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 dark:border-white/10 p-12 text-center text-gray-400 dark:text-zinc-500">
                <Camera size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-xs font-semibold">No visual evidence attached to this incident</p>
              </div>
            )}
          </div>
        )}

        {/* Persistent Evidence Preview on Overview tab */}
        {activeTab === 'Overview' && evidenceSrc && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-700 dark:text-zinc-300">Evidence Frame</span>
              <button
                type="button"
                onClick={() => setActiveTab('Evidence')}
                className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
              >
                <Eye size={12} /> Expand View
              </button>
            </div>
            <div className="rounded-xl overflow-hidden bg-black border border-gray-200 dark:border-white/10 shadow-sm relative">
              <img src={evidenceSrc} alt="Evidence snapshot" className="w-full object-cover max-h-48" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default DetailPanel;
