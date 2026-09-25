import React, { useState, useEffect, useRef } from 'react';

// =====================================
// ANIMATED COUNT-UP COMPONENT
// =====================================
export function CountUp({ value, duration = 800 }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const start = ref.current ?? 0;
    const end = typeof value === 'number' ? value : 0;
    if (start === end) {
      setDisplay(end);
      return;
    }
    const startTime = performance.now();
    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) requestAnimationFrame(tick);
      else ref.current = end;
    }
    requestAnimationFrame(tick);
    return () => { ref.current = end; };
  }, [value, duration]);

  return <>{display}</>;
}

// =====================================
// SVG MINI BAR CHART COMPONENT
// =====================================
export function MiniBarChart({ data, height = 100, barColor = '#6366f1' }) {
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const barWidth = 100 / data.length;
  const padding = barWidth * 0.15;

  return (
    <svg viewBox={"0 0 100 " + height} className="w-full h-full" preserveAspectRatio="none">
      {data.map((d, i) => {
        const barH = (d.value / maxValue) * (height - 10);
        const x = i * barWidth + padding;
        const w = barWidth - padding * 2;
        return (
          <g key={i}>
            <rect
              x={x}
              y={height - barH}
              width={w}
              height={barH}
              rx={2}
              fill={barColor}
              opacity={0.85}
            >
              <animate
                attributeName="height"
                from="0"
                to={barH}
                dur="0.6s"
                begin={`${i * 0.05}s`}
                fill="freeze"
              />
              <animate
                attributeName="y"
                from={height}
                to={height - barH}
                dur="0.6s"
                begin={`${i * 0.05}s`}
                fill="freeze"
              />
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

// =====================================
// SPARKLINE COMPONENT
// =====================================
export function Sparkline({ values, color = '#6366f1', width = 60, height = 20 }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={"0 0 " + width + " " + height} className="inline-block ml-2 opacity-70" style={{ width: width, height: height }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// =====================================
// CSV EXPORT UTILITY
// =====================================
export function exportIncidentsCSV(alerts, getEnrichedData) {
  const headers = ['Timestamp', 'Camera', 'Incident Type', 'Pillar', 'Confidence', 'Severity'];
  const rows = alerts.map((raw) => {
    const e = getEnrichedData(raw);
    return [
      e.timestamp ? new Date(e.timestamp).toISOString() : '',
      e.camera_id || '',
      e.incident_type || '',
      e.pillar || '',
      e.confidence ?? '',
      e.incident_info?.severity || '',
    ];
  });

  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transguard_incidents_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
