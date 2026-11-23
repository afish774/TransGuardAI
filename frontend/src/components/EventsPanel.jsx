import React, { memo, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Filter,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { getEnrichedData } from '../utils/alertUtils';
import { SPRING, StatusDot } from './ui/LuxuryPrimitives';

const EventRow = memo(({ rawAlert, onSelectAlert, isSelected }) => {
  if (!rawAlert) return null;

  const alert = getEnrichedData(rawAlert);
  const timeString = alert.timestamp
    ? new Date(alert.timestamp).toLocaleTimeString([], { hour12: false })
    : 'Live';

  const hasGps =
    Number.isFinite(Number(rawAlert.gps?.lat)) && Number.isFinite(Number(rawAlert.gps?.lon));

  let detailSnippet = alert.confidence ? `${alert.confidence}%` : '—';
  if (alert.metadata?.personCount !== undefined) {
    detailSnippet = `${alert.metadata.personCount} people`;
  } else if (alert.metadata?.unattendedSeconds !== undefined) {
    detailSnippet = `${alert.metadata.unattendedSeconds}s`;
  } else if (alert.metadata?.identity) {
    detailSnippet = `${alert.metadata.identity}`;
  } else if (alert.metadata?.weapon) {
    detailSnippet = `${alert.metadata.weapon}`;
  }

  const status = rawAlert.status || 'NEW';
  const dotVariant =
    status === 'REVIEWED'
      ? 'live'
      : status === 'DISMISSED'
      ? 'muted'
      : alert.incident_info.severity === 'CRITICAL'
      ? 'alert'
      : 'standby';

  return (
    <button
      type="button"
      onClick={() => onSelectAlert(rawAlert)}
      className={`w-full text-left px-4 py-3 border-b border-[var(--border-hairline)] flex flex-col justify-center relative transition-colors focus:outline-none cursor-pointer ${
        isSelected ? 'bg-[var(--bg-elevated)]' : 'hover:bg-[var(--bg-hover)]'
      }`}
    >
      {isSelected && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2.5 bottom-2.5 w-[2.5px] rounded-r-full bg-[#0A84FF]"
        />
      )}

      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot variant={dotVariant} />
          <span className="font-mono text-[12px] font-medium text-[var(--text-primary)] truncate">
            {alert.camera_id}
          </span>
          {hasGps && (
            <MapPin
              size={11}
              strokeWidth={1.75}
              className="text-[#0A84FF] shrink-0"
              title="Pinned on spatial map"
            />
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {status === 'REVIEWED' && (
            <span className="text-[10px] font-medium text-[var(--status-live)]">Accepted</span>
          )}
          {status === 'DISMISSED' && (
            <span className="text-[10px] text-[var(--text-muted)]">Dismissed</span>
          )}
          <time className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
            {timeString}
          </time>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pl-3.5">
        <span className="text-[12px] text-[var(--text-secondary)] truncate">
          {alert.incident_info.label}
        </span>
        <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)] shrink-0">
          {detailSnippet}
        </span>
      </div>
    </button>
  );
});

const EventsPanel = memo(({ alerts = [], onSelectAlert, selectedAlertId }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showFilters, setShowFilters] = useState(false);
  // Mobile minimize state + desktop collapsible dock state
  const [mobileMinimized, setMobileMinimized] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

  const counts = useMemo(() => {
    let pending = 0;
    let reviewed = 0;
    for (const a of alerts) {
      if (a.status === 'REVIEWED') reviewed += 1;
      else if (a.status !== 'DISMISSED') pending += 1;
    }
    return { all: alerts.length, pending, reviewed };
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((raw) => {
      const status = raw.status || 'NEW';
      if (statusFilter === 'PENDING' && (status === 'REVIEWED' || status === 'DISMISSED')) {
        return false;
      }
      if (statusFilter === 'REVIEWED' && status !== 'REVIEWED') {
        return false;
      }

      const enriched = getEnrichedData(raw);
      if (selectedCategory !== 'ALL' && enriched.pillar !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const camMatch = (enriched.camera_id || '').toLowerCase().includes(q);
        const typeMatch = (enriched.incident_type || '').toLowerCase().includes(q);
        const catMatch = (enriched.pillar || '').toLowerCase().includes(q);
        if (!camMatch && !typeMatch && !catMatch) return false;
      }
      return true;
    });
  }, [alerts, statusFilter, selectedCategory, searchQuery]);

  // Desktop collapsed pill (gives operator 100% unobstructed full-screen map on demand)
  if (desktopCollapsed) {
    return (
      <div className="hidden md:flex absolute top-3.5 left-4 z-[1000]">
        <button
          type="button"
          onClick={() => setDesktopCollapsed(false)}
          className="luxury-panel-glass h-9 px-3.5 rounded-full inline-flex items-center gap-2.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--border-hover)] transition-colors cursor-pointer"
          title="Expand Live Feed"
        >
          <StatusDot variant={counts.pending > 0 ? 'alert' : alerts.length > 0 ? 'live' : 'muted'} />
          <span>Live Feed</span>
          <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
            {alerts.length}
          </span>
          <PanelLeftOpen size={13} strokeWidth={1.75} className="text-[var(--text-secondary)] ml-0.5" />
        </button>
      </div>
    );
  }

  return (
    <motion.section
      layout
      transition={SPRING}
      aria-label="Live Surveillance Stream"
      className={`absolute z-[1000] luxury-panel-glass rounded-2xl flex flex-col overflow-hidden left-3 right-3 bottom-3 md:left-3.5 md:right-auto md:top-3.5 md:bottom-3.5 md:w-[332px] md:h-auto ${
        mobileMinimized ? 'h-auto' : 'h-[54vh]'
      }`}
    >
      {/* Header */}
      <div
        className={`px-4 py-3 shrink-0 ${
          mobileMinimized
            ? 'md:border-b md:border-[var(--border-hairline)]'
            : 'border-b border-[var(--border-hairline)]'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setMobileMinimized((v) => !v)}
            className="flex items-center gap-2 text-left md:pointer-events-none cursor-pointer"
          >
            <StatusDot variant={counts.pending > 0 ? 'alert' : alerts.length > 0 ? 'live' : 'muted'} />
            <span className="text-[13.5px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              Live Feed
            </span>
            <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
              {filteredAlerts.length}
            </span>
          </button>

          <div className="flex items-center gap-1">
            {/* Category Filter Toggle */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              transition={{ duration: 0.12 }}
              onClick={() => setShowFilters(!showFilters)}
              aria-label="Toggle incident filters"
              title="Filter by category"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                mobileMinimized ? 'hidden md:flex' : 'flex'
              } ${
                showFilters || selectedCategory !== 'ALL'
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <Filter size={13} strokeWidth={1.75} />
            </motion.button>

            {/* Desktop Collapse Dock Button */}
            <button
              type="button"
              onClick={() => setDesktopCollapsed(true)}
              title="Collapse feed to full-screen map"
              aria-label="Collapse live feed"
              className="hidden md:flex p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              <PanelLeftClose size={13.5} strokeWidth={1.75} />
            </button>

            {/* Mobile-ONLY Minimize / Expand Toggle */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              transition={{ duration: 0.12 }}
              onClick={() => setMobileMinimized((v) => !v)}
              aria-label={mobileMinimized ? 'Expand live feed' : 'Minimize live feed'}
              title={mobileMinimized ? 'Expand live feed' : 'Minimize live feed'}
              className="md:hidden h-7 px-2 rounded-lg flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-hairline)] cursor-pointer transition-colors"
            >
              <span>{mobileMinimized ? 'Show' : 'Hide'}</span>
              {mobileMinimized ? (
                <ChevronUp size={13} strokeWidth={1.75} />
              ) : (
                <ChevronDown size={13} strokeWidth={1.75} />
              )}
            </motion.button>
          </div>
        </div>

        {/* Status Quick-Pills + Search (hidden on mobile when minimized) */}
        <div className={`${mobileMinimized ? 'hidden md:block' : 'block'} mt-2.5 space-y-2`}>
          {/* 3-Tab Quick Status Strip */}
          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-hairline)]">
            {[
              { id: 'ALL', label: 'All', count: counts.all },
              { id: 'PENDING', label: 'Pending', count: counts.pending },
              { id: 'REVIEWED', label: 'Accepted', count: counts.reviewed },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`h-6 rounded-md text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="font-mono tabular-nums text-[10px] text-[var(--text-muted)]">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              size={12}
              strokeWidth={1.75}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter camera or event"
              aria-label="Filter incidents"
              className="w-full h-8 bg-[var(--bg-input)] border border-[var(--border-hairline)] rounded-lg pl-7 pr-7 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear incident search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X size={12} strokeWidth={1.75} />
              </button>
            )}
          </div>

          {showFilters && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {[
                { id: 'ALL', label: 'All' },
                { id: 'FALL', label: 'Fall' },
                { id: 'OVERCROWDING', label: 'Overcrowding' },
                { id: 'LOST & FOUND', label: 'Baggage' },
                { id: 'SECURITY THREAT', label: 'Security' },
                { id: 'FACE MATCH', label: 'Watchlist' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`text-[10.5px] font-medium px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                    selectedCategory === cat.id
                      ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable Incident List */}
      <div
        className={`${
          mobileMinimized ? 'hidden md:block' : 'block'
        } flex-1 relative overflow-y-auto custom-scrollbar`}
      >
        {filteredAlerts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center">
            <StatusDot variant="live" className="mb-3" />
            <p className="text-[13px] font-medium text-[var(--text-primary)]">No matching events</p>
            <p className="text-[12px] text-[var(--text-muted)] mt-1 max-w-[210px]">
              {alerts.length === 0
                ? 'Incoming incidents appear here in real time.'
                : 'Clear your active filter to view all events.'}
            </p>
          </div>
        ) : (
          filteredAlerts.map((rawAlert, idx) => {
            const id = rawAlert.id || rawAlert._id || `alert-${idx}`;
            return (
              <EventRow
                key={id}
                rawAlert={rawAlert}
                onSelectAlert={(a) => {
                  onSelectAlert(a);
                  setMobileMinimized(true);
                }}
                isSelected={selectedAlertId === (rawAlert.id || rawAlert._id)}
              />
            );
          })
        )}
      </div>
    </motion.section>
  );
});

EventsPanel.displayName = 'EventsPanel';
export default EventsPanel;
