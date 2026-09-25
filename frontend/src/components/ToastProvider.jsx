import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, X, Volume2, VolumeX } from 'lucide-react';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

const SEVERITY_CONFIG = {
  CRITICAL: {
    bg: 'bg-red-600/95 dark:bg-red-600/90',
    border: 'border-red-500/30',
    icon: AlertTriangle,
    iconColor: 'text-white',
    textColor: 'text-white',
    subtextColor: 'text-red-100',
    progressBg: 'bg-red-400/40',
    progressFill: 'bg-white/80',
    playAudio: true,
  },
  HIGH: {
    bg: 'bg-orange-500/95 dark:bg-orange-600/90',
    border: 'border-orange-400/30',
    icon: AlertTriangle,
    iconColor: 'text-white',
    textColor: 'text-white',
    subtextColor: 'text-orange-100',
    progressBg: 'bg-orange-400/40',
    progressFill: 'bg-white/80',
    playAudio: false,
  },
  MEDIUM: {
    bg: 'bg-amber-500/95 dark:bg-amber-600/90',
    border: 'border-amber-400/30',
    icon: Info,
    iconColor: 'text-white',
    textColor: 'text-white',
    subtextColor: 'text-amber-100',
    progressBg: 'bg-amber-400/40',
    progressFill: 'bg-white/80',
    playAudio: false,
  },
  SUCCESS: {
    bg: 'bg-emerald-600/95 dark:bg-emerald-600/90',
    border: 'border-emerald-500/30',
    icon: CheckCircle,
    iconColor: 'text-white',
    textColor: 'text-white',
    subtextColor: 'text-emerald-100',
    progressBg: 'bg-emerald-400/40',
    progressFill: 'bg-white/80',
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
      className={`relative overflow-hidden rounded-xl border shadow-2xl backdrop-blur-sm transition-all duration-300 ease-out w-[380px] max-w-[calc(100vw-2rem)] ${config.bg} ${config.border} ${
        exiting ? 'opacity-0 translate-x-8 scale-95' : 'opacity-100 translate-x-0 scale-100'
      }`}
      style={{ animation: 'toast-slide-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className="flex items-start gap-3 p-4">
        <div className={`shrink-0 mt-0.5 ${config.iconColor}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold ${config.textColor} leading-tight`}>
            {toast.title}
          </p>
          {toast.message && (
            <p className={`text-xs ${config.subtextColor} mt-1 leading-relaxed line-clamp-2`}>
              {toast.message}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>

      {/* Auto-dismiss progress bar */}
      <div className={`absolute bottom-0 left-0 right-0 h-[3px] ${config.progressBg}`}>
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
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none"
        aria-live="polite"
      >
        {/* Audio toggle */}
        {toasts.length > 0 && (
          <button
            type="button"
            onClick={toggleAudio}
            className="self-end pointer-events-auto p-1.5 rounded-lg bg-black/40 backdrop-blur-sm text-white/60 hover:text-white hover:bg-black/60 transition-colors mb-1"
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
