import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, X, Volume2, VolumeX } from 'lucide-react';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

const SEVERITY_CONFIG = {
  CRITICAL: {
    bg: 'luxury-panel-glass',
    border: 'border-[#FF453A]/35',
    icon: AlertTriangle,
    iconBg: 'bg-[#FF453A]/15 text-[#FF453A]',
    textColor: 'text-[var(--text-primary)]',
    subtextColor: 'text-[var(--text-secondary)]',
    progressBg: 'bg-[var(--border-hairline)]',
    progressFill: 'bg-[#FF453A]',
    playAudio: true,
  },
  HIGH: {
    bg: 'luxury-panel-glass',
    border: 'border-[#FF9F0A]/35',
    icon: AlertTriangle,
    iconBg: 'bg-[#FF9F0A]/15 text-[#FF9F0A]',
    textColor: 'text-[var(--text-primary)]',
    subtextColor: 'text-[var(--text-secondary)]',
    progressBg: 'bg-[var(--border-hairline)]',
    progressFill: 'bg-[#FF9F0A]',
    playAudio: false,
  },
  MEDIUM: {
    bg: 'luxury-panel-glass',
    border: 'border-[var(--border-hover)]',
    icon: Info,
    iconBg: 'bg-[#0A84FF]/15 text-[#0A84FF]',
    textColor: 'text-[var(--text-primary)]',
    subtextColor: 'text-[var(--text-secondary)]',
    progressBg: 'bg-[var(--border-hairline)]',
    progressFill: 'bg-[#0A84FF]',
    playAudio: false,
  },
  SUCCESS: {
    bg: 'luxury-panel-glass',
    border: 'border-emerald-500/30',
    icon: CheckCircle,
    iconBg: 'bg-emerald-500/15 text-[#30D158]',
    textColor: 'text-[var(--text-primary)]',
    subtextColor: 'text-[var(--text-secondary)]',
    progressBg: 'bg-[var(--border-hairline)]',
    progressFill: 'bg-[#30D158]',
    playAudio: false,
  },
};

const DURATION_MS = 5000;
const MAX_TOASTS = 5;

// Generate a short alert beep using Web Audio API
function playAlertBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.2);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch {
    // Audio not available — silently degrade
  }
}

function Toast({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const config = SEVERITY_CONFIG[toast.severity] || SEVERITY_CONFIG.MEDIUM;
  const Icon = config.icon;

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    const timer = setTimeout(dismiss, DURATION_MS);
    return () => clearTimeout(timer);
  }, [dismiss]);

  return (
    <div
      role="alert"
      className={`relative overflow-hidden rounded-2xl border transition-all duration-300 ease-out w-[360px] max-w-[calc(100vw-1.5rem)] ${config.bg} ${config.border} ${
        exiting ? 'opacity-0 translate-x-6 scale-[0.98]' : 'opacity-100 translate-x-0 scale-100'
      }`}
      style={{ animation: 'toast-slide-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className={`shrink-0 w-7 h-7 rounded-xl flex items-center justify-center ${config.iconBg}`}>
          <Icon size={15} strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className={`text-[13px] font-medium tracking-[-0.01em] ${config.textColor} leading-snug`}>
            {toast.title}
          </p>
          {toast.message && (
            <p className={`text-[11.5px] ${config.subtextColor} mt-0.5 leading-relaxed line-clamp-2`}>
              {toast.message}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          aria-label="Dismiss notification"
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* Auto-dismiss hairline progress bar */}
      <div className={`absolute bottom-0 left-0 right-0 h-[2px] ${config.progressBg}`}>
        <div
          className={`h-full ${config.progressFill} rounded-r`}
          style={{
            animation: `toast-progress ${DURATION_MS}ms linear forwards`,
          }}
        />
      </div>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const idCounter = useRef(0);

  const addToast = useCallback(({ title, message, severity = 'MEDIUM' }) => {
    const id = ++idCounter.current;
    const config = SEVERITY_CONFIG[severity];
    if (config?.playAudio && audioEnabled) {
      playAlertBeep();
    }
    setToasts((prev) => {
      const next = [{ id, title, message, severity }, ...prev];
      return next.slice(0, MAX_TOASTS);
    });
    return id;
  }, [audioEnabled]);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleAudio = useCallback(() => {
    setAudioEnabled((prev) => !prev);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, dismissToast, audioEnabled, toggleAudio }}>
      {children}

      {/* Toast container */}
      <div
        className="fixed top-[60px] right-3 sm:right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
      >
        {/* Audio toggle */}
        {toasts.length > 0 && (
          <button
            type="button"
            onClick={toggleAudio}
            className="self-end pointer-events-auto p-1.5 rounded-lg luxury-panel-glass text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mb-0.5 cursor-pointer"
            title={audioEnabled ? 'Mute alerts' : 'Unmute alerts'}
            aria-label={audioEnabled ? 'Mute alert sounds' : 'Unmute alert sounds'}
          >
            {audioEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
        )}
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast toast={toast} onDismiss={dismissToast} />
          </div>
        ))}
      </div>

      <style>{`
        @keyframes toast-slide-in {
          0% { opacity: 0; transform: translateX(100%) scale(0.9); }
          100% { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes toast-progress {
          0% { width: 100%; }
          100% { width: 0%; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
