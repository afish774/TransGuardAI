import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { LoaderCircle, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { SPRING, StatusDot, PrimaryButton } from '../components/ui/LuxuryPrimitives';
import BrandLogo from '../components/BrandLogo';

/**
 * Automatically determines whether Login should use Dark Mode or Light Mode
 * based on local time of day:
 * - 06:00 to 17:59 (Daytime) -> Light Mode (false)
 * - 18:00 to 05:59 (Evening / Night) -> Dark Mode (true)
 */
export function isNightTimeByClock(date = new Date()) {
  const hour = date.getHours();
  return hour < 6 || hour >= 18;
}

const LoginView = ({ setToken }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [shake, setShake] = useState(false);
  const [autoDarkMode, setAutoDarkMode] = useState(() => isNightTimeByClock());

  // Automatically sync login theme with current local time
  useEffect(() => {
    const syncTimeTheme = () => {
      const night = isNightTimeByClock();
      setAutoDarkMode(night);
      if (night) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    syncTimeTheme();
    const interval = setInterval(syncTimeTheme, 60000);
    return () => clearInterval(interval);
  }, []);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 420);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();

      if (res.ok && data.token) {
        localStorage.setItem('tg_token', data.token);
        localStorage.setItem('tg_username', username.trim() || 'operator');
        setToken(data.token);
      } else {
        setError(data.error || 'Invalid credentials');
        triggerShake();
      }
    } catch {
      setError('Network error connecting to backend');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`${
        autoDarkMode ? 'dark' : ''
      } w-screen h-screen h-[100dvh] bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col items-center justify-center relative overflow-y-auto px-4 py-10 select-none`}
    >
      {/* Whisper-Soft Monochrome Studio Overhead Light */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background: autoDarkMode
            ? 'radial-gradient(ellipse 64% 52% at 50% 18%, rgba(255, 255, 255, 0.055) 0%, rgba(255, 255, 255, 0.012) 48%, transparent 78%)'
            : 'radial-gradient(ellipse 68% 55% at 50% 16%, rgba(255, 255, 255, 0.95) 0%, rgba(15, 23, 42, 0.025) 55%, transparent 82%)',
        }}
      />

      {/* Sculptural Centered Sign-In Stack */}
      <main className="relative z-10 w-full max-w-[404px] flex flex-col items-center">
        {/* Authentic Full Brand Lockup */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8 flex flex-col items-center"
        >
          <BrandLogo variant="full" className="h-[52px] sm:h-[60px]" alt="TransGuard AI" />
        </motion.div>

        {/* Apple-Grade Sign-In Surface */}
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={
            shake
              ? { x: [0, -6, 6, -4, 4, 0], opacity: 1, y: 0, scale: 1 }
              : { opacity: 1, y: 0, scale: 1 }
          }
          transition={shake ? { duration: 0.38 } : SPRING}
          className="w-full rounded-[26px] luxury-surface p-7 sm:p-9"
          style={{
            boxShadow: autoDarkMode
              ? 'inset 0 1px 0 0 rgba(255, 255, 255, 0.09), 0 24px 64px -20px rgba(0, 0, 0, 0.85)'
              : 'inset 0 1px 0 0 rgba(255, 255, 255, 0.95), 0 24px 60px -24px rgba(15, 23, 42, 0.14)',
          }}
        >
          <div className="text-center mb-7">
            <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[var(--text-primary)] leading-tight">
              Sign in
            </h1>
            <p className="text-[13px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
              Enter your operator credentials to access the command center.
            </p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="mb-5 px-3.5 py-2.5 rounded-xl bg-[#FF453A]/10 border border-[#FF453A]/25 text-[var(--status-alert)] text-[12px] flex items-center gap-2.5"
            >
              <StatusDot variant="alert" />
              <span>{error}</span>
            </motion.div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="login-username"
                className="block text-[11.5px] font-medium text-[var(--text-secondary)] mb-1.5 pl-0.5"
              >
                Username
              </label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-11 bg-[var(--bg-canvas)]/70 border border-[var(--border-hairline)] rounded-xl px-3.5 text-[13.5px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:bg-[var(--bg-input)] focus:border-[var(--border-hover)] focus:ring-4 focus:ring-black/[0.04] dark:focus:ring-white/[0.06] transition-all"
                placeholder="Enter your username"
                required
                autoFocus
                autoComplete="username"
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-[11.5px] font-medium text-[var(--text-secondary)] mb-1.5 pl-0.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 bg-[var(--bg-canvas)]/70 border border-[var(--border-hairline)] rounded-xl pl-3.5 pr-11 text-[13.5px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:bg-[var(--bg-input)] focus:border-[var(--border-hover)] focus:ring-4 focus:ring-black/[0.04] dark:focus:ring-white/[0.06] transition-all"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff size={15} strokeWidth={1.75} />
                  ) : (
                    <Eye size={15} strokeWidth={1.75} />
                  )}
                </button>
              </div>
            </div>

            <div className="pt-2">
              <PrimaryButton
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl text-[13.5px] font-medium"
              >
                {loading ? (
                  <>
                    <LoaderCircle size={15} strokeWidth={1.75} className="animate-spin" />
                    <span>Authenticating…</span>
                  </>
                ) : (
                  <>
                    <span>Sign in</span>
                    <ArrowRight size={15} strokeWidth={1.75} />
                  </>
                )}
              </PrimaryButton>
            </div>
          </form>
        </motion.div>
      </main>
    </div>
  );
};

export default LoginView;
