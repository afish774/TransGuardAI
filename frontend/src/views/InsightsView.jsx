import React, { useState, useMemo } from 'react';
import { Download } from 'lucide-react';
import { exportIncidentsCSV } from '../components/charts';
import { getEnrichedData } from '../utils/alertUtils';
import { SegmentedControl, StatusDot, SecondaryButton } from '../components/ui/LuxuryPrimitives';

function LuxuryAreaChart({ data = [] }) {
  const width = 800;
  const height = 160;
  const padX = 8;
  const padY = 14;
  const maxVal = Math.max(1, ...data.map((d) => d.value));

  const points = data.map((d, i) => {
    const x =
      data.length > 1
        ? padX + (i / (data.length - 1)) * (width - padX * 2)
        : width / 2;
    const y = height - padY - (d.value / maxVal) * (height - padY * 2);
    return { x, y, ...d };
  });

  const linePath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${height - padY} L ${points[0].x.toFixed(1)} ${height - padY} Z`
      : '';

  return (
    <div className="w-full text-[var(--chart-stroke)]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-[160px] overflow-visible"
        aria-label="Incident volume area chart"
      >
        <defs>
          <linearGradient id="luxuryAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.00" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padY + (1 - frac) * (height - padY * 2);
          return (
            <line
              key={frac}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke="var(--border-hairline)"
              strokeWidth="1"
            />
          );
        })}

        {areaPath && <path d={areaPath} fill="url(#luxuryAreaFill)" />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}

export const InsightsView = ({ alerts = [], activeCameras = [] }) => {
  const [timeRange, setTimeRange] = useState('24h');

  const filteredAlerts = useMemo(() => {
    const now = Date.now();
    const cutoff =
      timeRange === '24h' ? now - 24 * 60 * 60 * 1000 : now - 7 * 24 * 60 * 60 * 1000;
    return alerts.filter((raw) => {
      const ts = raw.timestamp ? new Date(raw.timestamp).getTime() : now;
      return ts >= cutoff;
    });
  }, [alerts, timeRange]);

  const stats = useMemo(() => {
    let falls = 0,
      overcrowd = 0,
      baggage = 0,
      security = 0,
      watchlist = 0,
      accepted = 0,
      rejected = 0;

    filteredAlerts.forEach((raw) => {
      const enriched = getEnrichedData(raw);
      if (enriched.pillar === 'FALL') falls++;
      else if (enriched.pillar === 'OVERCROWDING') overcrowd++;
      else if (enriched.pillar === 'LOST & FOUND') baggage++;
      else if (enriched.pillar === 'SECURITY THREAT') security++;
      else if (enriched.pillar === 'FACE MATCH') watchlist++;

      if (raw.status === 'REVIEWED') accepted++;
      else if (raw.status === 'DISMISSED') rejected++;
    });

    const onlineNodes = activeCameras.filter((c) => c.status === 'ONLINE').length;
    return {
      total: filteredAlerts.length,
      falls,
      overcrowd,
      baggage,
      security,
      watchlist,
      accepted,
      rejected,
      onlineNodes,
    };
  }, [filteredAlerts, activeCameras]);

  const timelineData = useMemo(() => {
    const now = Date.now();
    if (timeRange === '24h') {
      const buckets = Array.from({ length: 24 }, (_, i) => ({
        label: `${String(new Date(now - (23 - i) * 3600000).getHours()).padStart(2, '0')}:00`,
        value: 0,
      }));
      filteredAlerts.forEach((raw) => {
        const ts = raw.timestamp ? new Date(raw.timestamp).getTime() : now;
        const hoursAgo = Math.floor((now - ts) / 3600000);
        buckets[23 - Math.min(Math.max(hoursAgo, 0), 23)].value++;
      });
      return buckets;
    }
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now - (6 - i) * 86400000);
      return { label: date.toLocaleDateString('en', { weekday: 'short' }), value: 0 };
    });
    filteredAlerts.forEach((raw) => {
      const ts = raw.timestamp ? new Date(raw.timestamp).getTime() : now;
      const daysAgo = Math.floor((now - ts) / 86400000);
      buckets[6 - Math.min(Math.max(daysAgo, 0), 6)].value++;
    });
    return buckets;
  }, [filteredAlerts, timeRange]);

  const categories = [
    { label: 'Security & Threats', count: stats.security },
    { label: 'Fall Detection', count: stats.falls },
    { label: 'Overcrowding', count: stats.overcrowd },
    { label: 'Unattended Baggage', count: stats.baggage },
    { label: 'Watchlist', count: stats.watchlist },
  ];

  const maxCategoryCount = Math.max(1, ...categories.map((c) => c.count));

  return (
    <main className="flex-1 overflow-y-auto bg-[var(--bg-canvas)] p-4 sm:p-6 md:p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
        <div className="pb-5 border-b border-[var(--border-hairline)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-medium tracking-[-0.025em] text-[var(--text-primary)]">
              Insights
            </h1>
            <p className="text-[13px] text-[var(--text-secondary)] mt-1">
              Operational activity and category distribution across active vehicles.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <SegmentedControl
              layoutId="insights-time-range"
              value={timeRange}
              onChange={setTimeRange}
              options={[
                { value: '24h', label: '24 Hours' },
                { value: '7d', label: '7 Days' },
              ]}
            />
            <SecondaryButton
              onClick={() => exportIncidentsCSV(filteredAlerts, getEnrichedData)}
              className="h-9 px-3.5 text-[12px]"
            >
              <Download size={13} strokeWidth={1.75} />
              <span>Export</span>
            </SecondaryButton>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-[var(--border-hairline)] divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-hairline)]">
          <div className="py-4 px-3.5 sm:py-5 sm:px-5">
            <div className="text-[10.5px] sm:text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Total Incidents
            </div>
            <div className="mt-2 font-mono tabular-nums text-[22px] sm:text-[26px] font-medium text-[var(--text-primary)]">
              {stats.total}
            </div>
          </div>

          <div className="py-4 px-3.5 sm:py-5 sm:px-5">
            <div className="text-[10.5px] sm:text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Active Cameras
            </div>
            <div className="mt-2 font-mono tabular-nums text-[22px] sm:text-[26px] font-medium text-[var(--text-primary)]">
              {stats.onlineNodes}
              <span className="text-[14px] sm:text-[15px] text-[var(--text-muted)]">
                {' '}
                / {activeCameras.length}
              </span>
            </div>
          </div>

          <div className="py-4 px-3.5 sm:py-5 sm:px-5">
            <div className="text-[10.5px] sm:text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Validator Decisions
            </div>
            <div className="mt-2 font-mono tabular-nums text-[22px] sm:text-[26px] font-medium text-[var(--text-primary)]">
              {stats.accepted}
              <span className="text-[13px] sm:text-[14px] text-[var(--text-muted)]"> / {stats.rejected}</span>
            </div>
          </div>

          <div className="py-4 px-3.5 sm:py-5 sm:px-5">
            <div className="text-[10.5px] sm:text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Fleet Status
            </div>
            <div className="mt-2 flex items-center gap-2 text-[16px] sm:text-[18px] font-medium text-[var(--text-primary)]">
              <StatusDot variant={stats.security > 0 ? 'alert' : 'live'} />
              <span>{stats.security > 0 ? 'Elevated' : 'Clear'}</span>
            </div>
          </div>
        </div>

        <section className="luxury-surface rounded-2xl p-4 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[14px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">
              Incident Volume
            </h2>
            <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
              {filteredAlerts.length} events
            </span>
          </div>

          <LuxuryAreaChart data={timelineData} />

          <div className="flex justify-between mt-2 px-1">
            {timelineData
              .filter((_, i) => i % (timeRange === '24h' ? 4 : 1) === 0)
              .map((d, i) => (
                <span key={i} className="font-mono tabular-nums text-[10px] text-[var(--text-muted)]">
                  {d.label}
                </span>
              ))}
          </div>
        </section>

        <section className="luxury-surface rounded-2xl p-6">
          <h2 className="text-[14px] font-medium tracking-[-0.02em] text-[var(--text-primary)] mb-5">
            Category Distribution
          </h2>
          <div className="space-y-4">
            {categories.map((cat) => {
              const pct = stats.total > 0 ? (cat.count / maxCategoryCount) * 100 : 0;
              return (
                <div key={cat.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-[var(--text-secondary)]">{cat.label}</span>
                    <span className="font-mono tabular-nums text-[12px] text-[var(--text-primary)]">
                      {cat.count}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--btn-primary-bg)] transition-all duration-500"
                      style={{ width: `${cat.count > 0 ? Math.max(pct, 4) : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="pt-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Recent Activity
            </h3>
            <span className="text-[11px] text-[var(--text-muted)]">Live</span>
          </div>
          {filteredAlerts.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-[var(--text-muted)] border-t border-[var(--border-hairline)]">
              No incidents recorded in this window.
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-hairline)] border-t border-[var(--border-hairline)]">
              {filteredAlerts.slice(0, 6).map((rawAlert) => {
                const enriched = getEnrichedData(rawAlert);
                return (
                  <div
                    key={rawAlert.id || rawAlert._id}
                    className="py-3.5 flex items-center justify-between gap-4 text-[13px]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <StatusDot
                        variant={
                          rawAlert.status === 'REVIEWED'
                            ? 'live'
                            : rawAlert.status === 'DISMISSED'
                            ? 'muted'
                            : 'standby'
                        }
                      />
                      <span className="text-[var(--text-primary)] truncate">
                        {enriched.incident_info.label}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--text-muted)] shrink-0">
                        {enriched.camera_id}
                      </span>
                    </div>
                    <time className="font-mono tabular-nums text-[11px] text-[var(--text-muted)] shrink-0">
                      {rawAlert.timestamp
                        ? new Date(rawAlert.timestamp).toLocaleTimeString([], { hour12: false })
                        : 'Live'}
                    </time>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
};
