import React, { memo, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Camera, Check, Trash2, ExternalLink, MapPin } from 'lucide-react';
import { getEnrichedData } from '../utils/alertUtils';
import { API_BASE_URL } from '../config';
import {
  SPRING,
  StatusDot,
  SegmentedControl,
  TelemetryRow,
  PrimaryButton,
  SecondaryButton,
} from './ui/LuxuryPrimitives';

const DetailPanel = memo(({ alert: rawAlert, onClose, onDeleteAlert, onAcknowledgeAlert }) => {
  const [activeTab, setActiveTab] = useState('Overview');
  const [acknowledged, setAcknowledged] = useState(rawAlert?.status === 'REVIEWED');
  const [rejected, setRejected] = useState(rawAlert?.status === 'DISMISSED');
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
    setIsDeleting(false);
    setAcknowledged(rawAlert?.status === 'REVIEWED');
    setRejected(rawAlert?.status === 'DISMISSED');
    setIsAcknowledging(false);
  }, [rawAlert?.id, rawAlert?._id, rawAlert?.status]);

  // Allow closing the inspector via Escape key to return to full map view
  useEffect(() => {
    if (!rawAlert) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rawAlert, onClose]);

  const alert = rawAlert ? getEnrichedData(rawAlert) : null;
  const evidenceSrc = alert
    ? alert.evidence_image_url
      ? alert.evidence_image_url.startsWith('/')
        ? `${API_BASE_URL}${alert.evidence_image_url}`
        : alert.evidence_image_url
      : alert.evidence_image_base64
      ? `data:image/jpeg;base64,${alert.evidence_image_base64}`
      : null
    : null;

  const hasGps =
    alert &&
    Number.isFinite(Number(alert.gps?.lat)) &&
    Number.isFinite(Number(alert.gps?.lon));

  const mapsLink = hasGps
    ? `https://www.google.com/maps?q=${Number(alert.gps.lat).toFixed(6)},${Number(
        alert.gps.lon
      ).toFixed(6)}`
    : null;

  const handleDecision = async (status) => {
    if (!alert || isAcknowledging) return;
    setIsAcknowledging(true);
    try {
      const ok = onAcknowledgeAlert
        ? await onAcknowledgeAlert(alert.id || alert._id, status)
        : true;
      if (ok) {
        setAcknowledged(status === 'REVIEWED');
        setRejected(status === 'DISMISSED');
      }
    } finally {
      setIsAcknowledging(false);
    }
  };

  return (
    <AnimatePresence>
      {rawAlert && alert && (
        <motion.aside
          key={alert.id || alert._id}
          initial={{ opacity: 0, x: 24, scale: 0.99 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 24, scale: 0.99 }}
          transition={SPRING}
          aria-label="Incident Details"
          className="flex absolute inset-3 sm:inset-auto sm:top-3.5 sm:bottom-3.5 sm:right-3.5 sm:w-[386px] luxury-panel-glass rounded-2xl flex-col z-[1001] overflow-hidden"
        >
          {/* Top Bar */}
          <div className="px-4 py-3 border-b border-[var(--border-hairline)] flex items-center justify-between gap-2 shrink-0">
            <SegmentedControl
              layoutId="detail-inspector-tabs"
              value={activeTab}
              onChange={setActiveTab}
              options={[
                { value: 'Overview', label: 'Overview' },
                { value: 'Metadata', label: 'Details' },
                { value: 'Evidence', label: 'Frame' },
              ]}
            />
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              aria-label="Close incident details"
              title="Close inspector (Esc)"
            >
              <X size={15} strokeWidth={1.75} />
            </button>
          </div>

          <div className="p-5 overflow-y-auto flex-1 custom-scrollbar space-y-5">
            {/* Title Header */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  <StatusDot
                    variant={
                      acknowledged
                        ? 'live'
                        : rejected
                        ? 'muted'
                        : alert.incident_info.severity === 'CRITICAL'
                        ? 'alert'
                        : 'standby'
                    }
                  />
                  <span>{alert.incident_info.severity}</span>
                </span>
                <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                  {alert.timestamp
                    ? new Date(alert.timestamp).toLocaleTimeString([], { hour12: false })
                    : 'Live'}
                </span>
              </div>
              <h2 className="text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-primary)] leading-snug">
                {alert.incident_info.label}
              </h2>
              <div className="mt-1 flex items-center justify-between">
                <p className="font-mono text-[12px] text-[var(--text-secondary)]">
                  {alert.camera_id}
                </p>
                {mapsLink && (
                  <a
                    href={mapsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#0A84FF] hover:underline"
                  >
                    <MapPin size={11} strokeWidth={1.75} />
                    <span>Google Maps</span>
                    <ExternalLink size={10} strokeWidth={1.75} />
                  </a>
                )}
              </div>
            </div>

            {activeTab === 'Overview' && (
              <>
                {evidenceSrc && (
                  <div className="rounded-xl overflow-hidden bg-black border border-[var(--border-hairline)]">
                    <img
                      src={evidenceSrc}
                      alt="Incident snapshot"
                      className="w-full object-cover max-h-40 cursor-pointer hover:opacity-95 transition-opacity"
                      onClick={() => setActiveTab('Evidence')}
                    />
                  </div>
                )}

                <div className="rounded-xl bg-[var(--bg-surface)]/75 border border-[var(--border-hairline)] px-3.5">
                  <TelemetryRow label="Camera" value={alert.camera_id} />
                  <TelemetryRow
                    label="Confidence"
                    value={alert.confidence ? `${alert.confidence}%` : '—'}
                  />
                  <TelemetryRow
                    label="Coordinates"
                    value={
                      hasGps
                        ? `${Number(alert.gps.lat).toFixed(4)}, ${Number(alert.gps.lon).toFixed(4)}`
                        : 'Pending'
                    }
                  />
                  {alert.metadata?.identity && (
                    <TelemetryRow label="Subject" value={alert.metadata.identity} mono={false} />
                  )}
                  <TelemetryRow
                    label="Status"
                    value={
                      acknowledged
                        ? `Accepted${rawAlert?.reviewed_by ? ` · ${rawAlert.reviewed_by}` : ''}`
                        : rejected
                        ? `Dismissed${rawAlert?.reviewed_by ? ` · ${rawAlert.reviewed_by}` : ''}`
                        : 'Pending Review'
                    }
                    dot={acknowledged ? 'live' : rejected ? 'muted' : 'standby'}
                    accent={acknowledged ? 'live' : rejected ? 'default' : 'standby'}
                    mono={false}
                  />
                </div>

                <div className="pt-1 space-y-2">
                  <PrimaryButton
                    onClick={() => handleDecision('REVIEWED')}
                    disabled={acknowledged || isAcknowledging}
                    className="w-full h-10"
                  >
                    <Check size={14} strokeWidth={1.75} />
                    <span>
                      {acknowledged
                        ? 'Accepted & Dispatched'
                        : isAcknowledging
                        ? 'Updating…'
                        : 'Approve & Sound Siren'}
                    </span>
                  </PrimaryButton>

                  <SecondaryButton
                    onClick={() => handleDecision('DISMISSED')}
                    disabled={rejected || isAcknowledging}
                    className="w-full h-9 text-[12px]"
                  >
                    <X size={13} strokeWidth={1.75} />
                    <span>{rejected ? 'Marked as False Alarm' : 'Dismiss'}</span>
                  </SecondaryButton>

                  {onDeleteAlert && (
                    <div className="pt-1">
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
                        className={`w-full h-8 rounded-lg text-[12px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          confirmDelete
                            ? 'bg-[#FF453A] text-white font-medium'
                            : 'text-[var(--text-muted)] hover:text-[var(--status-alert)]'
                        }`}
                      >
                        <Trash2 size={12} strokeWidth={1.75} />
                        <span>
                          {isDeleting
                            ? 'Deleting…'
                            : confirmDelete
                            ? 'Confirm permanent delete'
                            : 'Delete record'}
                        </span>
                      </button>
                      {confirmDelete && (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          className="w-full text-center text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] mt-1 cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'Metadata' && (
              <pre className="p-4 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-hairline)] font-mono text-[11px] text-[var(--text-secondary)] overflow-x-auto leading-relaxed">
                {JSON.stringify(
                  {
                    id: alert.id || alert._id,
                    camera_id: alert.camera_id,
                    incident_type: alert.incident_type,
                    confidence: alert.confidence,
                    status: rawAlert?.status || 'NEW',
                    reviewed_by: rawAlert?.reviewed_by || null,
                    reviewed_at: rawAlert?.reviewed_at || null,
                    timestamp: alert.timestamp,
                    gps: alert.gps || null,
                    metadata: alert.metadata || {},
                  },
                  null,
                  2
                )}
              </pre>
            )}

            {activeTab === 'Evidence' &&
              (evidenceSrc ? (
                <div className="rounded-xl overflow-hidden bg-black border border-[var(--border-hairline)]">
                  <img
                    src={evidenceSrc}
                    alt="Full evidence frame"
                    className="w-full object-contain max-h-[340px]"
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)] p-12 text-center text-[var(--text-muted)]">
                  <Camera size={22} strokeWidth={1.5} className="mx-auto mb-2 opacity-60" />
                  <p className="text-[12px]">No snapshot attached</p>
                </div>
              ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
});

DetailPanel.displayName = 'DetailPanel';
export default DetailPanel;
