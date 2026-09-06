import React, { memo } from 'react';
import { AlertTriangle, ChevronDown, Filter, Search, CheckCircle } from 'lucide-react';
import { getEnrichedData, getSeverityStyles } from '../utils/alertUtils';

const EventRow = memo(({ rawAlert, onSelectAlert, isSelected }) => {
  if (!rawAlert) return null;

  const alert = getEnrichedData(rawAlert);
  const severityStyle = getSeverityStyles(alert?.incident_info?.severity);

  return (
    <div
      onClick={() => onSelectAlert(rawAlert)}
      className={`px-5 py-4 border-b border-gray-100 dark:border-white/5 cursor-pointer flex flex-col justify-center relative transition-colors ${
        isSelected ? 'bg-blue-50/20 dark:bg-indigo-500/20' : 'hover:bg-gray-50 dark:hover:bg-white/10 dark:bg-[#1e1e1e]'
      }`}
    >
      {isSelected && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gray-900 dark:bg-indigo-500"></div>}

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-900 dark:text-zinc-100 text-[15px] tracking-tight">{alert.bus_cam_id}</span>
          <span className="text-[9px] font-bold bg-green-500 text-white px-1.5 py-0.5 rounded tracking-wider uppercase">Driving</span>
          <div className="flex items-end gap-[1.5px] h-[14px]">
            <div className="w-[2px] h-1.5 bg-gray-900 dark:bg-indigo-500"></div>
            <div className="w-[2px] h-2 bg-gray-900 dark:bg-indigo-500"></div>
            <div className="w-[2px] h-2.5 bg-gray-900 dark:bg-indigo-500"></div>
            <div className="w-[2px] h-3.5 bg-gray-300"></div>
          </div>
        </div>
      </div>

      <div className="text-[13px] text-gray-900 dark:text-zinc-100 font-medium flex items-center gap-2 mb-2">
        <span className="text-gray-500 dark:text-zinc-400">Speed:</span> {alert.speed} km/h
        <span className="text-gray-300 dark:text-zinc-500 text-[10px] mx-0.5">●</span>
        <span className="text-gray-500 dark:text-zinc-400">Passengers:</span> {alert.passengers}/40
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold text-gray-900 dark:text-zinc-100">
          {alert.driver}
        </div>
        {!alert.delay && (
          <div className="text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">
            On schedule
          </div>
        )}
      </div>

      {alert.incident_info && (
        <div className="mt-3 flex items-start justify-between">
          <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${severityStyle.text}`}>
            <AlertTriangle size={12} fill="currentColor" className={severityStyle.icon} />
            {alert.incident_info.label}
          </div>
          {alert.delay && (
            <div className={`text-[10px] font-bold uppercase flex items-center gap-1.5 ${severityStyle.text}`}>
              <div className={`w-[2px] h-[10px] ${severityStyle.bar}`}></div>
              {alert.delay}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const EventsPanel = memo(({ alerts = [], onSelectAlert, selectedAlertId }) => {
  return (
    <div className="absolute top-4 bottom-4 left-4 w-full md:w-[380px] bg-white/95 dark:bg-zinc-900/90 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.6)] dark:ring-1 dark:ring-white/10 border border-gray-200/50 dark:border-white/10 flex flex-col z-[1000] overflow-hidden animate-fade-in-up">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5 bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl z-10 shrink-0">
        <div className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-zinc-100 text-[15px]">
          Live Incident Stream <ChevronDown size={14} className="text-gray-500 dark:text-zinc-400 mt-0.5" />
        </div>
        <div className="flex items-center gap-4 text-gray-500 dark:text-zinc-400 text-sm">
          <div className="flex items-center gap-1.5 cursor-pointer hover:text-gray-900 dark:hover:text-white dark:text-zinc-100">
            <Filter size={14} /> <span className="font-medium text-[13px]">Filters</span>
          </div>
          <Search size={16} className="cursor-pointer hover:text-gray-900 dark:hover:text-white dark:text-zinc-100" />
        </div>
      </div>

      <div className="flex-1 bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl relative overflow-y-auto custom-scrollbar">
        {alerts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-zinc-500">
            <CheckCircle size={32} className="mb-3 text-green-400/50" />
            <p className="text-sm font-medium">No recent events</p>
          </div>
        ) : (
          alerts.map((rawAlert, idx) => {
            const id = rawAlert.id || rawAlert._id || idx;
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
