import React, { useEffect, useRef, useState } from 'react';

/**
 * TransGuard AI — Pure Minimal 0.5x Cinema Logo Intro (60/120 FPS Compositor-Only)
 *
 * Uses three pixel-aligned same-canvas layers extracted directly from the authentic
 * TransGuard AI artwork (zero alignment drift, zero decorative clutter, zero subtitles).
 * Runs on a single uninterrupted GPU compositor timeline with zero mid-animation React re-renders.
 */
export default function TransGuardIntro({ visible, isDarkMode = true, onComplete }) {
  const [ready, setReady] = useState(false);
  const completedRef = useRef(false);

  const mode = isDarkMode ? 'dark' : 'light';
  const markSrc = `/brand/intro-mark-${mode}.png`;
  const nameSrc = `/brand/intro-name-${mode}.png`;
  const aiSrc = `/brand/intro-ai-${mode}.png`;
  const markCenterOffset = isDarkMode ? '32.34%' : '30.9%';
  const markOriginX = isDarkMode ? '17.66%' : '19.1%';
  const aspectRatio = isDarkMode ? '909 / 339' : '885 / 340';

  useEffect(() => {
    if (!visible) return;
    completedRef.current = false;
    setReady(false);

    let cancelled = false;
    const sources = [markSrc, nameSrc, aiSrc];

    Promise.all(
      sources.map(
        (src) =>
          new Promise((resolve) => {
            const img = new Image();
            img.src = src;
            if (typeof img.decode === 'function') {
              img.decode().then(resolve).catch(resolve);
            } else {
              img.onload = resolve;
              img.onerror = resolve;
            }
          })
      )
    ).finally(() => {
      if (!cancelled) setReady(true);
    });

    const safety = setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(safety);
    };
  }, [visible, markSrc, nameSrc, aiSrc]);

  useEffect(() => {
    if (!visible || !ready) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const timer = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete?.();
      }
    }, reduced ? 1150 : 2800);

    return () => clearTimeout(timer);
  }, [visible, ready, onComplete]);

  if (!visible) return null;

  const markMaskStyle = {
    WebkitMaskImage: `url(${markSrc})`,
    maskImage: `url(${markSrc})`,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  };

  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={`tg-gpu-layer fixed inset-0 z-[10000] flex items-center justify-center overflow-hidden select-none pointer-events-none ${
        ready ? 'tg-anim-overlay' : ''
      }`}
      style={{
        backgroundColor: isDarkMode ? '#000000' : '#FFFFFF',
      }}
    >
      {/* Pixel-Exact Same-Canvas Logo Stage */}
      <div
        className="relative w-[min(460px,80vw)]"
        style={{
          aspectRatio,
          '--tg-mark-cx': markCenterOffset,
          opacity: ready ? 1 : 0,
        }}
      >
        {/* Layer 1: Hexagon Bus Emblem (Dead-center -> glides cleanly into lockup) */}
        <div
          className={`absolute inset-0 tg-gpu-layer ${ready ? 'tg-anim-mark' : 'opacity-0'}`}
          style={{ transformOrigin: `${markOriginX} 50%` }}
        >
          <img
            src={markSrc}
            alt="TransGuard"
            decoding="sync"
            loading="eager"
            draggable={false}
            className="w-full h-full object-contain"
          />

          {/* Subtle Alpha-Masked Specular Highlight Across Emblem Surface */}
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={markMaskStyle}
          >
            <div
              className={`absolute inset-y-0 w-[34%] tg-gpu-layer ${
                ready ? 'tg-anim-sheen' : 'opacity-0'
              }`}
              style={{
                background: isDarkMode
                  ? 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.22) 35%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0.22) 65%, transparent 100%)'
                  : 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.16) 35%, rgba(255,255,255,0.62) 50%, rgba(255,255,255,0.16) 65%, transparent 100%)',
              }}
            />
          </div>
        </div>

        {/* Layer 2: Authentic "TransGuard" Wordmark (Exact Pixel Coordinates) */}
        <div
          className={`absolute inset-0 tg-gpu-layer ${ready ? 'tg-anim-name' : 'opacity-0'}`}
        >
          <img
            src={nameSrc}
            alt=""
            decoding="sync"
            loading="eager"
            draggable={false}
            className="w-full h-full object-contain"
          />
        </div>

        {/* Layer 3: Authentic "AI" Submark (Exact Pixel Coordinates) */}
        <div
          className={`absolute inset-0 tg-gpu-layer ${ready ? 'tg-anim-ai' : 'opacity-0'}`}
        >
          <img
            src={aiSrc}
            alt=""
            decoding="sync"
            loading="eager"
            draggable={false}
            className="w-full h-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}
