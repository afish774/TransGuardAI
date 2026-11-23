import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UploadCloud,
  User,
  X,
} from 'lucide-react';
import { API_BASE_URL } from '../config';
import {
  SPRING,
  StatusDot,
  SegmentedControl,
  PrimaryButton,
  SecondaryButton,
} from './ui/LuxuryPrimitives';

function apiHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export function getTargetImageUrl(target) {
  if (!target) return '';
  const path = target.reference_image_url || target.url;
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function getTargetImageUrls(target) {
  if (!target) return [];
  const rawList =
    Array.isArray(target.urls) && target.urls.length > 0
      ? target.urls
      : Array.isArray(target.reference_image_urls) && target.reference_image_urls.length > 0
      ? target.reference_image_urls
      : [target.reference_image_url || target.url];
  return rawList
    .filter(Boolean)
    .map((p) =>
      p.startsWith('http://') || p.startsWith('https://')
        ? p
        : `${API_BASE_URL}${p.startsWith('/') ? '' : '/'}${p}`
    );
}

function incidentValue(incident, key) {
  return incident?.metadata?.[key] ?? incident?.[key];
}

function formatPoint(value) {
  const point = Array.isArray(value) ? value : null;
  return point && point.length === 2
    ? `(${Number(point[0]).toFixed(0)}, ${Number(point[1]).toFixed(0)})`
    : 'Not recorded';
}

function evidenceUrl(incident) {
  if (incident?.evidence_image_url) {
    return incident.evidence_image_url.startsWith('/')
      ? `${API_BASE_URL}${incident.evidence_image_url}`
      : incident.evidence_image_url;
  }
  if (incident?.evidence_image_base64) {
    return `data:image/jpeg;base64,${incident.evidence_image_base64}`;
  }
  return null;
}

function num(value, digits = 1) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : null;
}

function list(value) {
  return Array.isArray(value) ? value.join(', ') : null;
}

const EVENT_SUMMARIES = {
  OVERCROWD_DETECTED: (get) => ({
    summary: `Crowd density exceeded threshold (${get('personCount') ?? '—'} people).`,
    chips: [
      ['Current', get('personCount')],
      ['Peak', get('peakCount')],
    ],
  }),
  UNATTENDED_BAGGAGE: (get) => ({
    summary: `Unattended ${get('objectClass') || 'bag'}${
      num(get('unattendedSeconds') ?? get('stationarySeconds'))
        ? ` for ${num(get('unattendedSeconds') ?? get('stationarySeconds'))}s`
        : ''
    }.`,
    chips: [['Object', get('objectClass')]],
  }),
  BAGGAGE_THEFT_SUSPECTED: (get) => ({
    summary: `${get('objectClass') || 'Bag'} moved by unauthorized person.`,
    chips: [['Object', get('objectClass')]],
  }),
  CAMERA_TAMPERING: (get) => ({
    summary: `Camera view obstructed (${(get('tamperType') || 'obscured').replace(/_/g, ' ')}).`,
    chips: [['Type', get('tamperType')]],
  }),
  PERIMETER_BREACH: (get) => ({
    summary: `Entry into restricted zone "${get('zoneName') || 'unnamed'}".`,
    chips: [['Point', formatPoint(get('detectionPoint'))]],
  }),
  SUSPICIOUS_LOITERING: (get) => ({
    summary: `Extended loitering detected (${
      num(get('dwellTimeSeconds') ?? get('durationSeconds')) ?? '—'
    }s).`,
    chips: [['Zone', get('zoneName')]],
  }),
  VIOLENCE_DETECTED: (get) => ({
    summary: 'Physical altercation detected.',
    chips: [['Tracks', list(get('involvedTracks'))]],
  }),
  FALL_DETECTED: (get) => ({
    summary: 'Possible passenger fall detected.',
    chips: [['People', get('persons')]],
  }),
  PASSENGER_FALL: (get) => ({
    summary: 'Possible passenger fall detected.',
    chips: [['People', get('persons')]],
  }),
  CRIME_WEAPON_DETECTED: (get) => ({
    summary: `Possible ${get('weapon') || 'weapon'} detected.`,
    chips: [['Item', get('weapon')]],
  }),
  CRIME_VIOLENCE_DETECTED: (get) => ({
    summary: 'Physical altercation detected.',
    chips: [['Tracks', list(get('trackIds'))]],
  }),
  ARMED_VIOLENCE: (get) => ({
    summary: 'Critical: Armed altercation detected.',
    chips: [['Item', get('weapon') || 'Weapon']],
  }),
  VIOLENT_ASSAULT_COLLAPSE: () => ({
    summary: 'Critical: Assault followed by passenger fall.',
    chips: [],
  }),
  DRIVER_SOS_PANIC: (get) => ({
    summary: `Physical SOS distress button pressed on ${get('vehicle_id') || 'BUS_001'}.`,
    chips: [['Vehicle', get('vehicle_id') || 'BUS_001']],
  }),
  WATCHLIST_MATCH: (get) => ({
    summary: `Watchlist match: ${get('subjectName') || get('identity') || 'Subject'}.`,
    chips: [['Subject', get('subjectName') || get('identity')]],
  }),
  ZONE_INTRUSION: (get) => ({
    summary: `Restricted zone entry at ${formatPoint(get('point'))}.`,
    chips: [],
  }),
};

function describeIncident(incident) {
  const get = (key) => incidentValue(incident, key);
  const view = EVENT_SUMMARIES[incident?.incident_type];
  if (!view) {
    return {
      summary: (incident?.incident_type || 'Incident').replace(/_/g, ' ').toLowerCase(),
      chips: [],
    };
  }
  const { summary, chips } = view(get);
  return {
    summary,
    chips: chips.filter(([, value]) => value !== undefined && value !== null && value !== ''),
  };
}

const MAX_WATCHLIST_PHOTOS = 10;

function getTargetPhotoEntries(target) {
  if (!target) return [];
  const relList =
    Array.isArray(target.reference_image_urls) && target.reference_image_urls.length > 0
      ? target.reference_image_urls.filter(Boolean)
      : target.reference_image_url
      ? [target.reference_image_url]
      : [];

  if (relList.length > 0) {
    return relList.map((relUrl, idx) => {
      const absCandidate = Array.isArray(target.urls) ? target.urls[idx] : null;
      const absUrl =
        absCandidate ||
        (relUrl.startsWith('http://') || relUrl.startsWith('https://')
          ? relUrl
          : `${API_BASE_URL}${relUrl.startsWith('/') ? '' : '/'}${relUrl}`);
      return { id: `existing-${idx}-${relUrl}`, relUrl, absUrl, isExisting: true };
    });
  }

  return getTargetImageUrls(target).map((absUrl, idx) => {
    const marker = absUrl.indexOf('/uploads/watchlist/');
    const relUrl = marker !== -1 ? absUrl.slice(marker) : absUrl;
    return { id: `existing-${idx}-${relUrl}`, relUrl, absUrl, isExisting: true };
  });
}

export function WatchlistUploadModal({ token, target = null, onClose, onUploaded }) {
  const isEditMode = Boolean(target);
  const initialExisting = useMemo(() => getTargetPhotoEntries(target), [target]);

  const [name, setName] = useState(target?.name || '');
  const [existingPhotos, setExistingPhotos] = useState(initialExisting);
  const [newPhotos, setNewPhotos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const newPhotosRef = useRef(newPhotos);
  newPhotosRef.current = newPhotos;

  useEffect(() => {
    setName(target?.name || '');
    setExistingPhotos(initialExisting);
    setNewPhotos((prev) => {
      prev.forEach((item) => {
        if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    setError('');
  }, [target, initialExisting]);

  const totalCount = existingPhotos.length + newPhotos.length;
  const remainingSlots = Math.max(0, MAX_WATCHLIST_PHOTOS - totalCount);
  const removedExistingCount = Math.max(0, initialExisting.length - existingPhotos.length);

  const handleAddFiles = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = '';
    if (selectedFiles.length === 0) return;

    const available = MAX_WATCHLIST_PHOTOS - (existingPhotos.length + newPhotosRef.current.length);
    if (available <= 0) {
      setError(`Maximum of ${MAX_WATCHLIST_PHOTOS} reference photos reached.`);
      return;
    }

    const accepted = selectedFiles.slice(0, available);
    if (selectedFiles.length > available) {
      setError(`Only ${available} more photo${available === 1 ? '' : 's'} can be added (max ${MAX_WATCHLIST_PHOTOS}).`);
    } else {
      setError('');
    }

    const additions = accepted.map((file, idx) => ({
      id: `new-${Date.now()}-${idx}-${file.name}`,
      file,
      previewUrl: URL.createObjectURL(file),
      isExisting: false,
    }));

    setNewPhotos((prev) => [...prev, ...additions]);
  };

  const removeExistingPhoto = (photoId) => {
    setExistingPhotos((prev) => prev.filter((item) => item.id !== photoId));
    setError('');
  };

  const restoreExistingPhotos = () => {
    const availableForRestore = Math.max(0, MAX_WATCHLIST_PHOTOS - newPhotos.length);
    setExistingPhotos(initialExisting.slice(0, availableForRestore));
    setError('');
  };

  const removeNewPhoto = (photoId) => {
    setNewPhotos((prev) => {
      const targetItem = prev.find((item) => item.id === photoId);
      if (targetItem?.previewUrl) URL.revokeObjectURL(targetItem.previewUrl);
      return prev.filter((item) => item.id !== photoId);
    });
    setError('');
  };

  useEffect(() => {
    return () => {
      newPhotosRef.current.forEach((item) => {
        if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Identity name is required.');
      return;
    }
    if (totalCount === 0) {
      setError(
        isEditMode
          ? 'Keep or add at least one reference photo, or remove the target from the queue.'
          : 'Upload at least one reference photo.'
      );
      return;
    }

    setSaving(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('name', trimmedName);
      if (isEditMode) {
        formData.append(
          'keep_urls',
          JSON.stringify(existingPhotos.map((item) => item.relUrl))
        );
      }
      newPhotos.forEach((item) => {
        formData.append('images', item.file);
      });

      const targetId = target?._id || target?.id || target?.subject_id;
      const endpoint = isEditMode
        ? `${API_BASE_URL}/api/watchlist/${targetId}`
        : `${API_BASE_URL}/api/watchlist`;

      const response = await fetch(endpoint, {
        method: isEditMode ? 'PUT' : 'POST',
        headers: apiHeaders(token),
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.error || (isEditMode ? 'Unable to update target.' : 'Unable to register target.')
        );
      }

      newPhotos.forEach((item) => {
        if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      setNewPhotos([]);
      if (!isEditMode) setName('');
      onUploaded(data.target || { name: trimmedName, photo_count: totalCount });
      onClose();
    } catch (uploadError) {
      setError(uploadError?.message || (isEditMode ? 'Update failed. Please try again.' : 'Upload failed. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const combinedPhotos = [...existingPhotos, ...newPhotos];

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/65 backdrop-blur-md p-4 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="watchlist-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.form
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={SPRING}
        onSubmit={submit}
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto custom-scrollbar luxury-surface rounded-2xl"
      >
        <div className="px-6 py-4 flex items-center justify-between border-b border-[var(--border-hairline)]">
          <div>
            <h2
              id="watchlist-modal-title"
              className="text-[16px] font-medium tracking-[-0.025em] text-[var(--text-primary)]"
            >
              {isEditMode ? 'Modify Watchlist Target' : 'Add Watchlist Target'}
            </h2>
            <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
              {isEditMode
                ? 'Update the identity name, add new angles, or remove existing photos.'
                : 'One photo is enough. Select multiple angles for higher accuracy.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            aria-label={isEditMode ? 'Close modify watchlist modal' : 'Close watchlist upload'}
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-2">
              Identity Name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              className="w-full h-10 rounded-lg bg-[var(--bg-input)] border border-[var(--border-hairline)] px-3.5 text-[13px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)] transition-colors"
              placeholder="Full name"
            />
          </label>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <span className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Reference Photos ({totalCount} / {MAX_WATCHLIST_PHOTOS})
              </span>
              <span className="text-[11px] text-[var(--text-secondary)]">
                {totalCount >= 2
                  ? `${totalCount} photos ready`
                  : totalCount === 1
                  ? 'Ready to save'
                  : 'At least one required'}
              </span>
            </div>

            {isEditMode && removedExistingCount > 0 && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-hairline)] flex items-center justify-between gap-3 text-[11.5px] text-[var(--text-secondary)]">
                <span>
                  {removedExistingCount} existing photo{removedExistingCount === 1 ? '' : 's'} queued for removal
                </span>
                <button
                  type="button"
                  onClick={restoreExistingPhotos}
                  className="inline-flex items-center gap-1 text-[var(--text-primary)] hover:opacity-80 font-medium cursor-pointer shrink-0"
                >
                  <RotateCcw size={11} strokeWidth={1.75} />
                  <span>Restore</span>
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {combinedPhotos.map((item, idx) => (
                <div
                  key={item.id}
                  className="rounded-xl overflow-hidden border border-[var(--border-hairline)] bg-[var(--bg-elevated)] flex flex-col"
                >
                  {/* Clean Unobstructed 4:5 Portrait */}
                  <div className="aspect-[4/5] w-full bg-black overflow-hidden">
                    <img
                      src={item.isExisting ? item.absUrl : item.previewUrl}
                      alt={`${name || 'Target'} photo ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {/* Clean Metadata + Remove Strip Below Portrait */}
                  <div className="px-2.5 py-2 border-t border-[var(--border-hairline)] flex items-center justify-between gap-1.5">
                    <span className="text-[10.5px] text-[var(--text-secondary)] truncate">
                      {idx === 0
                        ? 'Primary'
                        : item.isExisting
                        ? `Photo ${idx + 1}`
                        : 'New photo'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        item.isExisting
                          ? removeExistingPhoto(item.id)
                          : removeNewPhoto(item.id)
                      }
                      className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--status-alert)] hover:bg-[#FF453A]/10 transition-colors cursor-pointer shrink-0"
                      title="Remove photo"
                      aria-label={`Remove photo ${idx + 1}`}
                    >
                      <Trash2 size={12} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              ))}

              {remainingSlots > 0 && (
                <label className="min-h-[168px] aspect-[4/5] border border-dashed border-[var(--border-hover)] rounded-xl p-3 flex flex-col items-center justify-center text-center gap-2 cursor-pointer bg-[var(--bg-elevated)]/60 hover:bg-[var(--bg-elevated)] transition-colors">
                  <ImagePlus size={18} strokeWidth={1.5} className="text-[var(--text-muted)]" />
                  <span className="text-[12px] font-medium text-[var(--text-primary)]">
                    Add Photos
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Select 1 or more ({remainingSlots} left)
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={handleAddFiles}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {error && (
            <p className="text-[12px] text-[var(--status-alert)] bg-[#FF453A]/10 border border-[#FF453A]/25 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <SecondaryButton type="button" onClick={onClose} className="h-10 px-4 text-[12px]">
              Cancel
            </SecondaryButton>
            <PrimaryButton
              type="submit"
              disabled={saving || !name.trim() || totalCount === 0}
              className="flex-1 sm:flex-none h-10 px-5"
            >
              {saving ? (
                <LoaderCircle size={15} strokeWidth={1.75} className="animate-spin" />
              ) : isEditMode ? (
                <Check size={15} strokeWidth={1.75} />
              ) : (
                <UploadCloud size={15} strokeWidth={1.75} />
              )}
              <span>
                {saving
                  ? isEditMode
                    ? 'Saving…'
                    : 'Registering…'
                  : isEditMode
                  ? `Save Changes (${totalCount} ${totalCount === 1 ? 'photo' : 'photos'})`
                  : `Register Target (${totalCount || 1} ${totalCount === 1 ? 'photo' : 'photos'})`}
              </span>
            </PrimaryButton>
          </div>
        </div>
      </motion.form>
    </div>
  );
}

/**
 * Editorial 4:5 Watchlist Queue — ZERO floating pills over portraits.
 */
export function WatchlistView({ token }) {
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const fetchTargets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/watchlist`, {
        headers: apiHeaders(token),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load watchlist (${response.status})`);
      }
      const data = await response.json();
      setTargets(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Could not load watchlist targets.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTargets();
  }, [fetchTargets]);

  const handleDelete = async (id) => {
    if (!id) return;
    setDeletingId(id);
    try {
      const response = await fetch(`${API_BASE_URL}/api/watchlist/${id}`, {
        method: 'DELETE',
        headers: apiHeaders(token),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete target.');
      }
      setTargets((prev) => prev.filter((t) => (t._id || t.id) !== id && t.subject_id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err.message || 'Delete failed.');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredTargets = targets.filter((target) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (target.name || '').toLowerCase().includes(q) ||
      (target.subject_id || '').toLowerCase().includes(q)
    );
  });

  return (
    <main className="flex-1 overflow-y-auto bg-[var(--bg-canvas)] p-4 sm:p-6 md:p-8 custom-scrollbar animate-fade-in-up">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="pb-5 border-b border-[var(--border-hairline)] flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[20px] font-medium tracking-[-0.025em] text-[var(--text-primary)]">
              Watchlist Queue
            </h1>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              Enrolled individuals synced automatically across active cameras.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <SecondaryButton onClick={fetchTargets} disabled={loading} className="h-9 px-3.5 text-[12px]">
              <RefreshCw size={13} strokeWidth={1.75} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </SecondaryButton>
            <PrimaryButton onClick={() => setOpen(true)} className="h-9 px-4 text-[12px]">
              <Plus size={14} strokeWidth={1.75} />
              <span>Add Target</span>
            </PrimaryButton>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative w-full sm:w-72">
            <Search
              size={13}
              strokeWidth={1.75}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name or ID"
              className="w-full h-9 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-input)] pl-9 pr-3 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)]"
            />
          </div>
          <div className="flex items-center gap-3 text-[12px] text-[var(--text-secondary)]">
            <span>
              Total{' '}
              <span className="font-mono tabular-nums text-[var(--text-primary)]">
                {targets.length}
              </span>
            </span>
            <span className="h-3 w-px bg-[var(--border-hairline)]" />
            <span className="inline-flex items-center gap-2 text-[var(--text-secondary)]">
              <StatusDot variant="live" />
              <span>Sync Active</span>
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-[#FF453A]/30 bg-[#FF453A]/10 px-4 py-3 text-[12px] text-[var(--status-alert)] flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={fetchTargets} className="underline cursor-pointer">
              Retry
            </button>
          </div>
        )}

        {loading && targets.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="luxury-surface rounded-2xl overflow-hidden animate-pulse">
                <div className="aspect-[4/5] w-full bg-[var(--bg-elevated)]" />
                <div className="p-4 space-y-2">
                  <div className="h-3.5 w-2/3 rounded bg-[var(--bg-elevated)]" />
                  <div className="h-3 w-1/2 rounded bg-[var(--bg-elevated)]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && targets.length === 0 && (
          <div className="luxury-surface rounded-2xl p-14 text-center">
            <User size={24} strokeWidth={1.5} className="mx-auto text-[var(--text-muted)] mb-3" />
            <h3 className="text-[15px] font-medium text-[var(--text-primary)]">
              No enrolled targets
            </h3>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)] max-w-sm mx-auto">
              Add a reference portrait to begin monitoring for watchlist matches.
            </p>
            <PrimaryButton onClick={() => setOpen(true)} className="mt-5 h-9 px-4 text-[12px]">
              <Plus size={14} strokeWidth={1.75} />
              <span>Add First Target</span>
            </PrimaryButton>
          </div>
        )}

        {!loading && filteredTargets.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {filteredTargets.map((target) => {
              const targetId = target._id || target.id;
              const photoUrl = getTargetImageUrl(target);
              const allPhotoUrls = getTargetImageUrls(target);
              const photoCount = allPhotoUrls.length || 1;
              const isDeleting = deletingId === targetId;
              const isConfirming = confirmDeleteId === targetId;

              return (
                <article
                  key={targetId}
                  className="group luxury-surface rounded-2xl overflow-hidden flex flex-col hover:border-[var(--border-hover)] transition-colors"
                >
                  {/* Pure Unobstructed 4:5 Portrait Frame */}
                  <div className="relative aspect-[4/5] w-full bg-[var(--bg-elevated)] overflow-hidden">
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={target.name}
                        className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fallback = e.currentTarget.parentElement?.querySelector('.fallback-avatar');
                          if (fallback) fallback.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div
                      className={`fallback-avatar absolute inset-0 ${
                        photoUrl ? 'hidden' : ''
                      } flex flex-col items-center justify-center bg-[var(--bg-elevated)] text-[var(--text-muted)]`}
                    >
                      <User size={34} strokeWidth={1.25} className="mb-2" />
                      <span className="text-[11px] uppercase tracking-[0.06em]">
                        {target.name}
                      </span>
                    </div>
                  </div>

                  {/* Clean Metadata Footer Below Portrait */}
                  <div className="p-4 border-t border-[var(--border-hairline)] flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        className="text-[14px] font-medium tracking-[-0.015em] text-[var(--text-primary)] truncate"
                        title={target.name}
                      >
                        {target.name}
                      </h3>
                      <StatusDot variant="live" />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
                      <span className="truncate" title={target.subject_id}>
                        {target.subject_id ? target.subject_id.slice(0, 8) : '—'}
                        {` · ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`}
                      </span>
                      <time>
                        {target.created_at
                          ? new Date(target.created_at).toLocaleDateString()
                          : 'Active'}
                      </time>
                    </div>

                    <div className="pt-2 border-t border-[var(--border-hairline)] flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          setEditingTarget(target);
                        }}
                        className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        aria-label={`Modify ${target.name}`}
                        title="Modify name and reference photos"
                      >
                        <Pencil size={12} strokeWidth={1.75} />
                        <span>Modify</span>
                      </button>

                      {isConfirming ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDelete(targetId)}
                            disabled={isDeleting}
                            className="px-2.5 py-1 rounded-md bg-[#FF453A] text-white text-[11px] font-medium cursor-pointer disabled:opacity-50"
                          >
                            {isDeleting ? 'Removing…' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(targetId)}
                          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--status-alert)] inline-flex items-center gap-1 transition-colors cursor-pointer"
                          aria-label={`Delete ${target.name}`}
                        >
                          <Trash2 size={12} strokeWidth={1.75} />
                          <span>Remove</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {(open || editingTarget) && (
        <WatchlistUploadModal
          token={token}
          target={editingTarget}
          onClose={() => {
            setOpen(false);
            setEditingTarget(null);
          }}
          onUploaded={() => {
            fetchTargets();
          }}
        />
      )}
    </main>
  );
}

/**
 * Incident Logs — Hairline KPI Strip, Sliding Segmented Filter, Single Export Dropdown, Spacious Table
 */
export function IncidentLogView({ alerts = [], token, onAcknowledgeAlert, onDeleteAlert }) {
  const [deletingId, setDeletingId] = useState(null);
  const [processingId, setProcessingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [historyAlerts, setHistoryAlerts] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [previewIncident, setPreviewIncident] = useState(null);
  const exportMenuRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const fetchFullHistory = useCallback(async () => {
    if (!token) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/alerts/history?limit=300`, {
        headers: apiHeaders(token),
      });
      if (res.ok) {
        const body = await res.json();
        const items = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
        setHistoryAlerts(items);
      }
    } catch {
      // Fallback to live alerts prop
    } finally {
      setLoadingHistory(false);
    }
  }, [token]);

  useEffect(() => {
    fetchFullHistory();
  }, [fetchFullHistory]);

  const mergedAlerts = useMemo(() => {
    const byId = new Map();
    for (const item of historyAlerts) {
      const id = item?.id || item?._id;
      if (id) byId.set(id, item);
    }
    for (const item of alerts) {
      const id = item?.id || item?._id;
      if (id) {
        const prev = byId.get(id) || {};
        byId.set(id, { ...prev, ...item });
      }
    }
    return Array.from(byId.values()).sort((a, b) => {
      const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tB - tA;
    });
  }, [alerts, historyAlerts]);

  const counts = useMemo(() => {
    let accepted = 0;
    let rejected = 0;
    let pending = 0;
    for (const inc of mergedAlerts) {
      if (inc.status === 'REVIEWED') accepted += 1;
      else if (inc.status === 'DISMISSED') rejected += 1;
      else pending += 1;
    }
    return { total: mergedAlerts.length, accepted, rejected, pending };
  }, [mergedAlerts]);

  const filteredAlerts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return mergedAlerts.filter((inc) => {
      const st = inc.status || 'NEW';
      if (statusFilter === 'REVIEWED' && st !== 'REVIEWED') return false;
      if (statusFilter === 'DISMISSED' && st !== 'DISMISSED') return false;
      if (statusFilter === 'NEW' && (st === 'REVIEWED' || st === 'DISMISSED')) return false;
      if (q) {
        const idStr = String(inc.id || inc._id || '').toLowerCase();
        const camStr = String(inc.camera_id || '').toLowerCase();
        const typeStr = String(inc.incident_type || '').toLowerCase();
        const valStr = String(inc.reviewed_by || '').toLowerCase();
        const { summary } = describeIncident(inc);
        if (
          !idStr.includes(q) &&
          !camStr.includes(q) &&
          !typeStr.includes(q) &&
          !valStr.includes(q) &&
          !String(summary || '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [mergedAlerts, statusFilter, searchQuery]);

  const handleDelete = async (id) => {
    if (!onDeleteAlert) return;
    setDeletingId(id);
    const ok = await onDeleteAlert(id);
    if (ok) {
      setHistoryAlerts((prev) => prev.filter((a) => (a.id || a._id) !== id));
    }
    setDeletingId(null);
  };

  const handleValidate = async (id, decision) => {
    if (!onAcknowledgeAlert || !id) return;
    setProcessingId(`${id}:${decision}`);
    const ok = await onAcknowledgeAlert(id, decision);
    if (ok) {
      const reviewer = localStorage.getItem('tg_username') || 'admin';
      const nowIso = new Date().toISOString();
      setHistoryAlerts((prev) =>
        prev.map((a) =>
          (a.id || a._id) === id
            ? { ...a, status: decision, reviewed_by: reviewer, reviewed_at: nowIso }
            : a
        )
      );
    }
    setProcessingId(null);
  };

  const formatConfidence = (inc) => {
    const raw = Number(inc?.confidence);
    if (!Number.isFinite(raw)) return '—';
    return `${raw <= 1 ? Math.round(raw * 100) : Math.round(raw)}%`;
  };

  const formatGps = (inc) => {
    const lat = Number(inc?.gps?.lat);
    const lon = Number(inc?.gps?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon)
      ? `${lat.toFixed(4)}, ${lon.toFixed(4)}`
      : '—';
  };

  const getDecisionLabel = (status) => {
    if (status === 'REVIEWED') return 'VALIDATOR ACCEPTED';
    if (status === 'DISMISSED') return 'VALIDATOR REJECTED';
    return 'PENDING REVIEW';
  };

  const handleExportExcel = () => {
    setExportMenuOpen(false);
    const escXml = (v) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const rowsHtml = filteredAlerts
      .map((inc, idx) => {
        const st = inc.status || 'NEW';
        const { summary } = describeIncident(inc);
        const bg = st === 'REVIEWED' ? '#dcfce7' : st === 'DISMISSED' ? '#ffe4e6' : '#fef3c7';
        const fg = st === 'REVIEWED' ? '#166534' : st === 'DISMISSED' ? '#9f1239' : '#92400e';
        const validatorName =
          inc.reviewed_by || (st !== 'NEW' ? localStorage.getItem('tg_username') || 'admin' : '—');
        const reviewedTime = inc.reviewed_at ? new Date(inc.reviewed_at).toLocaleString() : '—';

        return `<tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td style="font-family:Consolas,monospace;">${escXml(inc.id || inc._id || '')}</td>
          <td>${escXml(inc.timestamp ? new Date(inc.timestamp).toLocaleString() : '—')}</td>
          <td>${escXml(inc.camera_id || '—')}</td>
          <td>${escXml(inc.metadata?.vehicle_id || 'BUS_001')}</td>
          <td style="font-weight:bold;">${escXml(inc.incident_type || '—')}</td>
          <td>${escXml(summary || '—')}</td>
          <td style="text-align:center;">${escXml(formatConfidence(inc))}</td>
          <td style="background-color:${bg};color:${fg};font-weight:bold;text-align:center;">${escXml(
            getDecisionLabel(st)
          )}</td>
          <td>${escXml(validatorName)}</td>
          <td>${escXml(reviewedTime)}</td>
          <td>${escXml(formatGps(inc))}</td>
        </tr>`;
      })
      .join('\n');

    const xlsContent = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Validator Alert Log</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
<body>
  <table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;">
    <thead>
      <tr style="background-color:#111115;color:#ffffff;font-weight:bold;">
        <th colspan="12" style="font-size:13pt;text-align:left;padding:8px;">TRANSGUARD AI — VALIDATOR ACCEPTED &amp; REJECTED ALERTS LOG</th>
      </tr>
      <tr style="background-color:#f8fafc;font-weight:bold;">
        <td colspan="3">Total Alerts: ${counts.total}</td>
        <td colspan="3" style="background-color:#dcfce7;color:#166534;">Accepted: ${counts.accepted}</td>
        <td colspan="3" style="background-color:#ffe4e6;color:#9f1239;">Rejected: ${counts.rejected}</td>
        <td colspan="3" style="background-color:#fef3c7;color:#92400e;">Pending: ${counts.pending}</td>
      </tr>
      <tr style="background-color:#27272a;color:#ffffff;font-weight:bold;">
        <th>#</th><th>Alert ID</th><th>Detected Time</th><th>Camera</th><th>Vehicle</th><th>Event Type</th><th>Details</th><th>Confidence</th><th>Decision</th><th>Validated By</th><th>Validated At</th><th>GPS</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body></html>`;

    const blob = new Blob([xlsContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transguard_validation_log_${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    setExportMenuOpen(false);
    const escCsv = (val) => {
      const str = String(val ?? '');
      const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };

    const headers = [
      'Row',
      'Alert ID',
      'Detected Timestamp',
      'Camera ID',
      'Vehicle ID',
      'Incident Type',
      'Details',
      'Confidence',
      'Validator Decision',
      'Validated By',
      'Validated Timestamp',
      'GPS Coordinates',
    ];

    const lines = [
      headers.join(','),
      ...filteredAlerts.map((inc, idx) => {
        const st = inc.status || 'NEW';
        const { summary } = describeIncident(inc);
        const validatorName =
          inc.reviewed_by || (st !== 'NEW' ? localStorage.getItem('tg_username') || 'admin' : '');
        const reviewedTime = inc.reviewed_at ? new Date(inc.reviewed_at).toISOString() : '';
        return [
          idx + 1,
          inc.id || inc._id || '',
          inc.timestamp ? new Date(inc.timestamp).toISOString() : '',
          inc.camera_id || '',
          inc.metadata?.vehicle_id || 'BUS_001',
          inc.incident_type || '',
          summary || '',
          formatConfidence(inc),
          getDecisionLabel(st),
          validatorName,
          reviewedTime,
          formatGps(inc),
        ]
          .map(escCsv)
          .join(',');
      }),
    ];

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transguard_validation_log_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="flex-1 overflow-y-auto bg-[var(--bg-canvas)] p-4 sm:p-6 md:p-8 custom-scrollbar animate-fade-in-up">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="pb-5 border-b border-[var(--border-hairline)] flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[20px] font-medium tracking-[-0.025em] text-[var(--text-primary)]">
              Incident Logs
            </h1>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              Complete record of accepted, rejected, and pending dashboard alerts.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <SecondaryButton
              onClick={fetchFullHistory}
              disabled={loadingHistory}
              className="h-9 px-3.5 text-[12px]"
            >
              <RefreshCw
                size={13}
                strokeWidth={1.75}
                className={loadingHistory ? 'animate-spin' : ''}
              />
              <span>Refresh</span>
            </SecondaryButton>

            <div className="relative" ref={exportMenuRef}>
              <PrimaryButton
                onClick={() => setExportMenuOpen((v) => !v)}
                className="h-9 px-3.5 text-[12px]"
              >
                <Download size={13} strokeWidth={1.75} />
                <span>Export</span>
                <ChevronDown size={12} strokeWidth={1.75} />
              </PrimaryButton>

              <AnimatePresence>
                {exportMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.14 }}
                    className="absolute right-0 mt-1.5 w-44 rounded-xl luxury-surface p-1 z-30"
                  >
                    <button
                      type="button"
                      onClick={handleExportExcel}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    >
                      <FileSpreadsheet size={13} strokeWidth={1.75} />
                      <span>Excel (.xls)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    >
                      <Download size={13} strokeWidth={1.75} />
                      <span>CSV (.csv)</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* 4-Column KPI Strip Separated by Vertical Hairlines */}
        <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-[var(--border-hairline)] divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-hairline)]">
          {[
            { id: 'ALL', label: 'Total Alerts', value: counts.total, dot: null },
            { id: 'REVIEWED', label: 'Accepted', value: counts.accepted, dot: 'live' },
            { id: 'DISMISSED', label: 'Rejected', value: counts.rejected, dot: 'alert' },
            { id: 'NEW', label: 'Pending', value: counts.pending, dot: 'standby' },
          ].map((kpi) => (
            <button
              key={kpi.id}
              type="button"
              onClick={() => setStatusFilter(kpi.id)}
              className="text-left py-4 px-5 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                {kpi.dot && <StatusDot variant={kpi.dot} />}
                <span>{kpi.label}</span>
              </div>
              <div className="mt-2 font-mono tabular-nums text-[24px] font-medium text-[var(--text-primary)]">
                {kpi.value}
              </div>
            </button>
          ))}
        </div>

        {/* Segmented Filter Bar + Search */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <SegmentedControl
            layoutId="incident-log-filter"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'ALL', label: 'All', count: counts.total },
              { value: 'REVIEWED', label: 'Accepted', count: counts.accepted, dot: 'live' },
              { value: 'DISMISSED', label: 'Rejected', count: counts.rejected, dot: 'alert' },
              { value: 'NEW', label: 'Pending', count: counts.pending, dot: 'standby' },
            ]}
          />

          <div className="relative w-full md:w-72">
            <Search
              size={13}
              strokeWidth={1.75}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID, camera, validator"
              className="w-full h-9 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-input)] pl-9 pr-3 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)]"
            />
          </div>
        </div>

        {/* High-Contrast Audit Table */}
        <div className="luxury-surface rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  <th className="py-3.5 px-4 font-medium w-10">#</th>
                  <th className="py-3.5 px-4 font-medium">Timestamp</th>
                  <th className="py-3.5 px-4 font-medium">Camera</th>
                  <th className="py-3.5 px-4 font-medium">Event</th>
                  <th className="py-3.5 px-4 font-medium">Confidence</th>
                  <th className="py-3.5 px-4 font-medium">Decision</th>
                  <th className="py-3.5 px-4 font-medium">Validator</th>
                  <th className="py-3.5 px-4 font-medium">Frame</th>
                  <th className="py-3.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)] text-[13px]">
                {filteredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-14 text-center text-[13px] text-[var(--text-muted)]">
                      No incidents match this filter.
                    </td>
                  </tr>
                ) : (
                  filteredAlerts.map((incident, idx) => {
                    const incidentId = incident.id || incident._id;
                    const st = incident.status || 'NEW';
                    const image = evidenceUrl(incident);
                    const { summary } = describeIncident(incident);
                    const isAccepted = st === 'REVIEWED';
                    const isRejected = st === 'DISMISSED';

                    return (
                      <tr
                        key={incidentId || idx}
                        className="hover:bg-[var(--bg-hover)] transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                          {idx + 1}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-[12px] text-[var(--text-secondary)] whitespace-nowrap">
                          {incident.timestamp
                            ? new Date(incident.timestamp).toLocaleString()
                            : '—'}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-mono text-[12px] text-[var(--text-primary)]">
                            {incident.camera_id || '—'}
                          </div>
                          <div className="font-mono text-[10px] text-[var(--text-muted)]">
                            {incident.metadata?.vehicle_id || 'BUS_001'}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 max-w-xs">
                          <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                            {(incident.incident_type || 'Incident').replace(/_/g, ' ')}
                          </div>
                          <div
                            className="text-[12px] text-[var(--text-secondary)] truncate"
                            title={summary}
                          >
                            {summary}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-[12px] text-[var(--text-primary)]">
                          {formatConfidence(incident)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2 text-[12px] text-[var(--text-primary)]">
                            <StatusDot
                              variant={isAccepted ? 'live' : isRejected ? 'alert' : 'standby'}
                            />
                            <span>
                              {isAccepted ? 'Accepted' : isRejected ? 'Rejected' : 'Pending'}
                            </span>
                          </span>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="text-[12px] text-[var(--text-secondary)]">
                            {incident.reviewed_by || '—'}
                          </div>
                          {incident.reviewed_at && (
                            <div className="font-mono tabular-nums text-[10px] text-[var(--text-muted)]">
                              {new Date(incident.reviewed_at).toLocaleTimeString([], {
                                hour12: false,
                              })}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {image ? (
                            <button
                              type="button"
                              onClick={() => setPreviewIncident(incident)}
                              className="h-9 w-14 rounded-lg overflow-hidden border border-[var(--border-hairline)] bg-black cursor-pointer block"
                              title="Inspect frame"
                            >
                              <img src={image} alt="Frame" className="h-full w-full object-cover" />
                            </button>
                          ) : (
                            <span className="text-[11px] text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {onAcknowledgeAlert && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleValidate(incidentId, 'REVIEWED')}
                                  disabled={isAccepted || processingId !== null}
                                  className="h-7 px-2.5 rounded-md border border-[var(--border-hairline)] hover:border-[var(--border-hover)] bg-transparent hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-primary)] disabled:opacity-30 cursor-pointer transition-colors"
                                >
                                  Accept
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleValidate(incidentId, 'DISMISSED')}
                                  disabled={isRejected || processingId !== null}
                                  className="h-7 px-2.5 rounded-md border border-[var(--border-hairline)] hover:border-[var(--border-hover)] bg-transparent hover:bg-[var(--bg-hover)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer transition-colors"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {onDeleteAlert && (
                              <button
                                type="button"
                                onClick={() => handleDelete(incidentId)}
                                disabled={deletingId === incidentId}
                                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--status-alert)] transition-colors cursor-pointer disabled:opacity-30"
                                title="Delete record"
                                aria-label="Delete alert"
                              >
                                <Trash2 size={13} strokeWidth={1.75} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Evidence Lightbox */}
      {previewIncident && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
          onClick={() => setPreviewIncident(null)}
        >
          <div
            className="max-w-3xl w-full luxury-surface rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-3.5">
              <div>
                <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
                  {(previewIncident.incident_type || 'Incident').replace(/_/g, ' ')}
                </h3>
                <p className="font-mono text-[11px] text-[var(--text-muted)] mt-0.5">
                  {previewIncident.camera_id} ·{' '}
                  {previewIncident.timestamp
                    ? new Date(previewIncident.timestamp).toLocaleString()
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewIncident(null)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <div className="bg-black p-4 flex items-center justify-center">
              <img
                src={evidenceUrl(previewIncident)}
                alt="Incident frame"
                className="max-h-[70vh] w-auto rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
