import React, { memo, useState, useMemo } from 'react';
import { AlertTriangle, Filter, Search, CheckCircle, Video, X } from 'lucide-react';
import { getEnrichedData, getSeverityStyles } from '../utils/alertUtils';

const EventRow = memo(({ rawAlert, onSelectAlert, isSelected }) => {
  if (!rawAlert) return null;

  const alert = getEnrichedData(rawAlert);
  const severityStyle = getSeverityStyles(alert?.incident_info?.severity);
  const timeString = alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString() : 'Just now';

  // Specific detail chip depending on pillar
  let detailSnippet = `Confidence: ${alert.confidence}%`;
  if (alert.metadata?.personCount !== undefined) {
    detailSnippet = `Density: ${alert.metadata.personCount} people`;
  } else if (alert.metadata?.unattendedSeconds !== undefined) {
    detailSnippet = `Unattended: ${alert.metadata.unattendedSeconds}s`;
  } else if (alert.metadata?.identity) {
    detailSnippet = `Match: ${alert.metadata.identity}`;
  } else if (alert.metadata?.weapon) {
    detailSnippet = `Target: ${alert.metadata.weapon}`;
  }

  return (
    <button
      type="button"
      onClick={() => onSelectAlert(rawAlert)}
      className={`w-full text-left px-5 py-3.5 border-b border-gray-100 dark:border-white/5 flex flex-col justify-center relative transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500/50 ${
        isSelected ? 'bg-indigo-50/40 dark:bg-indigo-500/15' : 'hover:bg-gray-50/80 dark:hover:bg-white/5'
      }`}
    >
      {isSelected && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-indigo-600 dark:bg-indigo-500"></div>}

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-zinc-300">
            <Video size={12} />
          </div>
          <span className="font-bold text-gray-900 dark:text-zinc-100 text-[14px] tracking-tight">{alert.camera_id}</span>
          <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded tracking-wide uppercase bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200/40 dark:border-indigo-500/20">
            {alert.pillar}
          </span>
        </div>
        <time className="text-[11px] font-medium text-gray-400 dark:text-zinc-500">{timeString}</time>
      </div>

      <div className="text-[12px] text-gray-600 dark:text-zinc-300 font-medium flex items-center justify-between mb-1">
        <div className={`flex items-center gap-1.5 text-[11px] font-bold tracking-wide ${severityStyle.text}`}>
          <AlertTriangle size={12} fill="currentColor" className={severityStyle.icon} />
          {alert.incident_info.label}
        </div>
        <span className="text-[11px] font-medium text-gray-500 dark:text-zinc-400">{detailSnippet}</span>
      </div>
    </button>
  );
});

const EventsPanel = memo(({ alerts = [], onSelectAlert, selectedAlertId }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPillar, setSelectedPillar] = useState('ALL');
  const [showFilters, setShowFilters] = useState(false);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((raw) => {
      const enriched = getEnrichedData(raw);
      if (selectedPillar !== 'ALL' && enriched.pillar !== selectedPillar) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const camMatch = (enriched.camera_id || '').toLowerCase().includes(q);
        const typeMatch = (enriched.incident_type || '').toLowerCase().includes(q);
        const pillarMatch = (enriched.pillar || '').toLowerCase().includes(q);
        if (!camMatch && !typeMatch && !pillarMatch) return false;
      }
      return true;
    });
  }, [alerts, selectedPillar, searchQuery]);

  return (
    <div className="absolute top-4 bottom-4 left-4 w-full md:w-[380px] bg-white/95 dark:bg-zinc-900/90 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.6)] dark:ring-1 dark:ring-white/10 border border-gray-200/50 dark:border-white/10 flex flex-col z-[1000] overflow-hidden animate-fade-in-up">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-white/5 bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl z-10 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-900 dark:text-zinc-100 text-[15px]">Live Surveillance Stream</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20">
              {alerts.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              aria-label="Toggle incident filters"
              className={`p-1.5 rounded-lg text-sm transition-colors ${
                showFilters || selectedPillar !== 'ALL'
                  ? 'bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-semibold'
                  : 'text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Filter size={15} />
            </button>
          </div>
        </div>

        {/* Search & Filter expansion */}
        <div className="mt-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 text-gray-400 dark:text-zinc-500" size={13} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter camera or incident..."
              aria-label="Filter incidents"
              className="w-full bg-gray-50 dark:bg-zinc-950/80 border border-gray-200 dark:border-white/10 rounded-lg pl-8 pr-7 py-1.5 text-xs text-gray-900 dark:text-zinc-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear incident search"
                className="absolute right-2 top-2 text-gray-400 hover:text-gray-600 dark:hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {showFilters && (
            <div className="flex flex-wrap gap-1 pt-1 animate-in fade-in duration-150">
              {['ALL', 'FALL', 'OVERCROWDING', 'LOST & FOUND', 'SECURITY THREAT', 'FACE MATCH'].map((pillar) => (
                <button
                  key={pillar}
                  type="button"
                  onClick={() => setSelectedPillar(pillar)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-colors ${
                    selectedPillar === pillar
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-white/10'
                  }`}
                >
                  {pillar}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl relative overflow-y-auto custom-scrollbar divide-y divide-gray-100 dark:divide-white/5">
        {filteredAlerts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-gray-400 dark:text-zinc-500">
            <CheckCircle size={32} className="mb-3 text-emerald-500/50" />
            <p className="text-sm font-semibold text-gray-700 dark:text-zinc-300">No matching incidents</p>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">
              {alerts.length === 0 ? 'Surveillance stream is active. Incidents appear here in real time.' : 'Try clearing your search or pillar filter.'}
            </p>
          </div>
        ) : (
          filteredAlerts.map((rawAlert, idx) => {
            const id = rawAlert.id || rawAlert._id || `alert-${idx}`;
            return (
              <EventRow
                key={id}
                rawAlert={rawAlert}
                onSelectAlert={onSelectAlert}
                isSelected={selectedAlertId === (rawAlert.id || rawAlert._id)}
              />
            );
          })
        )}
      </div>
    </div>
  );
});

export default EventsPanel;
