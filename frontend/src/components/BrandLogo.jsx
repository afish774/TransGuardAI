import React, { memo } from 'react';

/**
 * Dual-theme retina-crisp TransGuard AI brand mark & lockup.
 * Uses explicit aspect ratio (never collapses in flexbox) and smooth opacity
 * cross-dissolve when transitioning between Light and Dark modes.
 */
const BrandLogo = memo(({ variant = 'mark', className = '', alt = 'TransGuard AI' }) => {
  const darkSrc = variant === 'full' ? '/brand/logo-full-dark.png' : '/brand/logo-mark-dark.png';
  const lightSrc = variant === 'full' ? '/brand/logo-full-light.png' : '/brand/logo-mark-light.png';
  const aspectRatio = variant === 'full' ? '800 / 290' : '1 / 1';

  return (
    <span
      className={`relative inline-block shrink-0 select-none ${className}`}
      style={{ aspectRatio }}
    >
      <img
        src={lightSrc}
        alt={alt}
        decoding="async"
        draggable={false}
        className="absolute inset-0 w-full h-full object-contain opacity-100 dark:opacity-0 transition-opacity duration-400 ease-out"
      />
      <img
        src={darkSrc}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable={false}
        className="absolute inset-0 w-full h-full object-contain opacity-0 dark:opacity-100 transition-opacity duration-400 ease-out"
      />
    </span>
  );
});

BrandLogo.displayName = 'BrandLogo';

export default BrandLogo;
