import React from 'react';
import { motion } from 'framer-motion';

export const SPRING = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.8,
};

const DOT_STYLES = {
  live: {
    backgroundColor: 'var(--status-live)',
    boxShadow: '0 0 8px rgba(48, 209, 88, 0.45)',
  },
  standby: {
    backgroundColor: 'var(--status-standby)',
    boxShadow: 'none',
  },
  alert: {
    backgroundColor: 'var(--status-alert)',
    boxShadow: '0 0 8px rgba(255, 69, 58, 0.45)',
  },
  muted: {
    backgroundColor: 'var(--text-muted)',
    boxShadow: 'none',
  },
};

export function StatusDot({ variant = 'live', pulse = false, className = '' }) {
  const style = DOT_STYLES[variant] || DOT_STYLES.muted;
  return (
    <span className={`relative inline-flex h-1.5 w-1.5 shrink-0 ${className}`}>
      {pulse && (
        <span
          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
          style={{ backgroundColor: style.backgroundColor }}
        />
      )}
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={style} />
    </span>
  );
}

/**
 * Monochrome SegmentedControl — concentric border radii + adaptive Light/Dark mode.
 */
export function SegmentedControl({ options, value, onChange, layoutId, className = '' }) {
  return (
    <div
      className={`inline-flex items-center max-w-full overflow-x-auto custom-scrollbar rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] p-1 ${className}`}
      role="tablist"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.value)}
            className={`relative px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer select-none ${
              isActive
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                transition={SPRING}
                className="absolute inset-0 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-hairline)]"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5 whitespace-nowrap">
              {opt.dot && <StatusDot variant={opt.dot} />}
              <span>{opt.label}</span>
              {opt.count !== undefined && (
                <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                  {opt.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function TelemetryRow({ label, value, dot, mono = true, accent = 'default' }) {
  const valueTone =
    accent === 'live'
      ? 'text-[var(--status-live)]'
      : accent === 'standby'
      ? 'text-[var(--status-standby)]'
      : accent === 'alert'
      ? 'text-[var(--status-alert)]'
      : 'text-[var(--text-primary)]';

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border-hairline)] last:border-b-0 min-w-0">
      <span className="text-[12px] text-[var(--text-secondary)] shrink-0">{label}</span>
      <span
        className={`flex items-center justify-end gap-2 text-[12px] min-w-0 text-right ${
          mono ? 'font-mono tabular-nums' : 'font-medium'
        } ${valueTone}`}
      >
        {dot && <StatusDot variant={dot} className="shrink-0" />}
        <span className="truncate" title={typeof value === 'string' ? value : undefined}>
          {value}
        </span>
      </span>
    </div>
  );
}

export function PrimaryButton({
  children,
  className = '',
  disabled = false,
  onClick,
  type = 'button',
  ...rest
}) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.12 }}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[var(--btn-primary-fg)] font-medium text-[13px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function SecondaryButton({
  children,
  className = '',
  disabled = false,
  onClick,
  type = 'button',
  ...rest
}) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.12 }}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-transparent hover:bg-[var(--bg-hover)] border border-[var(--border-hairline)] hover:border-[var(--border-hover)] text-[var(--text-primary)] font-medium text-[13px] disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
