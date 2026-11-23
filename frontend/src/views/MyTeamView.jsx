import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Sun, Moon, Volume2, VolumeX } from 'lucide-react';
import { StatusDot } from '../components/ui/LuxuryPrimitives';
import { useToast } from '../components/ToastProvider';

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
        checked
          ? 'bg-[var(--status-live)]'
          : 'bg-[var(--bg-elevated)] border border-[var(--border-hairline)]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export const MyTeamView = ({ isDarkMode = true, toggleDarkMode }) => {
  const toast = useToast();
  const username =
    (typeof window !== 'undefined' ? localStorage.getItem('tg_username') : null) ||
    'Operations Admin';
  const [criticalAlertsEnabled, setCriticalAlertsEnabled] = useState(true);
  const [watchlistDispatchEnabled, setWatchlistDispatchEnabled] = useState(false);

  const initials =
    username
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join('') || 'OP';

  const audioEnabled = toast ? toast.audioEnabled : true;

  return (
    <main className="flex-1 overflow-y-auto bg-[var(--bg-canvas)] p-4 sm:p-6 md:p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-3xl mx-auto space-y-9">
        {/* Header with Quick Appearance & Sound Controls */}
        <div className="pb-5 border-b border-[var(--border-hairline)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-medium tracking-[-0.025em] text-[var(--text-primary)]">
              My Team
            </h1>
            <p className="text-[13px] text-[var(--text-secondary)] mt-1">
              Operator profile, workspace appearance, acoustic alerts, and active session roster.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {toggleDarkMode && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={toggleDarkMode}
                className="h-8 px-3 rounded-lg luxury-surface hover:border-[var(--border-hover)] text-[12px] font-medium text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors cursor-pointer"
                aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {isDarkMode ? (
                  <>
                    <Sun size={13.5} strokeWidth={1.75} />
                    <span>Light Mode</span>
                  </>
                ) : (
                  <>
                    <Moon size={13.5} strokeWidth={1.75} />
                    <span>Dark Mode</span>
                  </>
                )}
              </motion.button>
            )}

            {toast && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={toast.toggleAudio}
                className={`h-8 px-3 rounded-lg border text-[12px] font-medium inline-flex items-center gap-2 transition-colors cursor-pointer ${
                  audioEnabled
                    ? 'luxury-surface hover:border-[var(--border-hover)] text-[var(--text-primary)]'
                    : 'bg-[var(--status-standby)]/12 border-[var(--status-standby)]/30 text-[var(--status-standby)]'
                }`}
                aria-label={audioEnabled ? 'Mute alert audio' : 'Unmute alert audio'}
              >
                {audioEnabled ? (
                  <>
                    <Volume2 size={13.5} strokeWidth={1.75} />
                    <span>Sound On</span>
                  </>
                ) : (
                  <>
                    <VolumeX size={13.5} strokeWidth={1.75} />
                    <span>Sound Muted</span>
                  </>
                )}
              </motion.button>
            )}
          </div>
        </div>

        {/* Operator Profile Card */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-8 border-b border-[var(--border-hairline)]">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] font-mono text-[14px] font-medium text-[var(--text-primary)] flex items-center justify-center shrink-0">
              {initials}
            </div>
            <div>
              <h2 className="text-[15px] font-medium text-[var(--text-primary)]">{username}</h2>
              <div className="flex items-center gap-2 mt-1 text-[12px] text-[var(--text-secondary)]">
                <StatusDot variant="live" />
                <span>Certified Operator · Control Room Access</span>
              </div>
            </div>
          </div>

          <span className="text-[12px] text-[var(--text-muted)]">SSO Managed</span>
        </section>

        {/* Structured Workspace Appearance & Sound Section */}
        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-3">
            Workspace Environment &amp; Audio
          </h3>

          <div className="divide-y divide-[var(--border-hairline)] border-y border-[var(--border-hairline)]">
            {toggleDarkMode && (
              <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-6">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Interface Appearance
                  </div>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                    Switch between Obsidian Dark mode for low-light control rooms and Porcelain Light mode.
                  </p>
                </div>

                <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-hairline)] shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (isDarkMode) toggleDarkMode();
                    }}
                    className={`h-7 px-3 rounded-md text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      !isDarkMode
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Sun size={12} strokeWidth={1.75} />
                    <span>Light</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isDarkMode) toggleDarkMode();
                    }}
                    className={`h-7 px-3 rounded-md text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      isDarkMode
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Moon size={12} strokeWidth={1.75} />
                    <span>Dark</span>
                  </button>
                </div>
              </div>
            )}

            {toast && (
              <div className="py-4 flex items-center justify-between gap-6">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Acoustic Alert Chimes
                  </div>
                  <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                    Play real-time audio notification chimes when critical incidents or SOS alerts arrive.
                  </p>
                </div>
                <ToggleSwitch
                  checked={audioEnabled}
                  onChange={() => toast.toggleAudio()}
                  label="Toggle acoustic alert chimes"
                />
              </div>
            )}
          </div>
        </section>

        {/* Alert Routing */}
        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-3">
            Alert Routing
          </h3>

          <div className="divide-y divide-[var(--border-hairline)] border-y border-[var(--border-hairline)]">
            <div className="py-4 flex items-center justify-between gap-6">
              <div>
                <div className="text-[13px] font-medium text-[var(--text-primary)]">
                  Critical Incident Notifications
                </div>
                <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                  Immediate desktop and acoustic alerts for physical SOS and high-priority detections.
                </p>
              </div>
              <ToggleSwitch
                checked={criticalAlertsEnabled}
                onChange={setCriticalAlertsEnabled}
                label="Toggle critical incident alerts"
              />
            </div>

            <div className="py-4 flex items-center justify-between gap-6">
              <div>
                <div className="text-[13px] font-medium text-[var(--text-primary)]">
                  Watchlist Telegram Escalation
                </div>
                <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                  Forward evidence snapshots to transit security when a match is approved.
                </p>
              </div>
              <ToggleSwitch
                checked={watchlistDispatchEnabled}
                onChange={setWatchlistDispatchEnabled}
                label="Toggle watchlist escalation"
              />
            </div>
          </div>
        </section>

        {/* Active Roster */}
        <section className="space-y-3">
          <h3 className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
            Active Roster
          </h3>
          <div className="divide-y divide-[var(--border-hairline)] border-y border-[var(--border-hairline)]">
            <div className="py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-hairline)] font-mono text-[11px] text-[var(--text-primary)] flex items-center justify-center">
                  {initials}
                </div>
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    {username}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">Primary Validator</div>
                </div>
              </div>
              <span className="inline-flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <StatusDot variant="live" />
                <span>Online</span>
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};
