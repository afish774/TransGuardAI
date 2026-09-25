import React from 'react';

function Shimmer({ className = '', style = {} }) {
  return (
    <div
      className={`relative overflow-hidden rounded bg-gray-200/60 dark:bg-white/5 ${className}`}
      style={style}
    >
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)',
          animation: 'shimmer 1.8s infinite',
        }}
      />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-zinc-900/80 border border-gray-200 dark:border-white/10 rounded-xl p-5 shadow-sm">
      <Shimmer className="h-3 w-24 mb-3" />
      <Shimmer className="h-8 w-20 mb-4" />
      <Shimmer className="h-3 w-32" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 py-3">
      <Shimmer className="w-8 h-8 rounded-lg shrink-0" />
      <div className="flex-1">
        <Shimmer className="h-3.5 w-40 mb-2" />
        <Shimmer className="h-2.5 w-24" />
      </div>
      <Shimmer className="h-3 w-16" />
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="flex items-end gap-2 h-24">
      {[40, 65, 35, 80, 55, 70, 45].map((h, i) => (
        <Shimmer
          key={i}
          className="flex-1 rounded-t"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonVideo() {
  return (
    <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-gray-200 dark:border-white/10">
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <Shimmer className="w-12 h-12 rounded-full mb-3" />
        <Shimmer className="h-2.5 w-20" />
      </div>
    </div>
  );
}

export { Shimmer };

// Inject shimmer keyframes once
const styleId = 'skeleton-shimmer-style';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
  `;
  document.head.appendChild(style);
}
