import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { Volume2, VolumeX, Menu, Sun, Moon } from 'lucide-react';
import { useToast } from './ToastProvider';
import BrandLogo from './BrandLogo';

const TopStatusBar = memo(({ isDarkMode, toggleDarkMode, onOpenMobileMenu }) => {
  const toast = useToast();

  const capsuleStyle = {
    boxShadow: isDarkMode
      ? 'inset 0 1px 0 0 rgba(255, 255, 255, 0.07), 0 2px 8px -2px rgba(0, 0, 0, 0.45)'
      : 'inset 0 1px 0 0 rgba(255, 255, 255, 0.9), 0 1px 3px rgba(15, 23, 42, 0.05)',
  };

  return (
    <header
      className="lg:hidden relative h-[52px] shrink-0 w-full bg-[var(--bg-surface)]/85 backdrop-blur-2xl backdrop-saturate-180 border-b border-[var(--border-hairline)] px-3 sm:px-5 flex items-center justify-between select-none z-30"
      style={{
        boxShadow: isDarkMode
          ? 'inset 0 -1px 0 0 rgba(255,255,255,0.03)'
          : 'inset 0 -1px 0 0 rgba(15,23,42,0.03)',
      }}
    >
      {/* Left: Mobile drawer menu button only (empty on desktop) */}
      <div className="flex items-center">
        {onOpenMobileMenu && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={{ duration: 0.12 }}
            onClick={onOpenMobileMenu}
            className="lg:hidden h-8 w-8 rounded-full bg-[var(--bg-elevated)]/80 border border-[var(--border-hairline)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            aria-label="Open navigation menu"
          >
            <Menu size={15} strokeWidth={1.75} />
          </motion.button>
        )}
      </div>

      {/* Center: TransGuard AI Brand Logo */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-none">
        <BrandLogo
          variant="full"
          className="h-[26px] sm:h-[28px]"
          alt="TransGuard AI"
        />
      </div>

      {/* Right: Only Light/Dark Toggle & Sound Toggle */}
      <div
        className="ml-auto h-[32px] p-0.5 rounded-full bg-[var(--bg-elevated)]/75 border border-[var(--border-hairline)] flex items-center gap-0.5"
        style={capsuleStyle}
      >
        {toggleDarkMode && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.12 }}
            onClick={toggleDarkMode}
            className="h-7 w-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDarkMode ? (
              <Sun size={13.5} strokeWidth={1.75} />
            ) : (
              <Moon size={13.5} strokeWidth={1.75} />
            )}
          </motion.button>
        )}

        {toast && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.12 }}
            onClick={toast.toggleAudio}
            className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              toast.audioEnabled
                ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                : 'text-[var(--status-standby)] bg-[var(--status-standby)]/15'
            }`}
            title={toast.audioEnabled ? 'Mute alert audio' : 'Unmute alert audio'}
            aria-label={toast.audioEnabled ? 'Mute alert audio' : 'Unmute alert audio'}
          >
            {toast.audioEnabled ? (
              <Volume2 size={13.5} strokeWidth={1.75} />
            ) : (
              <VolumeX size={13.5} strokeWidth={1.75} />
            )}
          </motion.button>
        )}
      </div>
    </header>
  );
});

TopStatusBar.displayName = 'TopStatusBar';
export default TopStatusBar;
