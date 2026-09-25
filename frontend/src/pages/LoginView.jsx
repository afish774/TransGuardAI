import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, LoaderCircle, Eye, EyeOff } from 'lucide-react';
import { API_BASE_URL } from '../config';

const LoginView = ({ setToken, isDarkMode }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [shake, setShake] = useState(false);
  const [mounted, setMounted] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
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
    <div className={`w-screen h-screen flex items-center justify-center relative overflow-hidden ${isDarkMode ? 'dark bg-zinc-950' : 'bg-gray-100'}`}>
      {/* Animated mesh gradient background */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute w-[600px] h-[600px] rounded-full opacity-30 animate-blob-1"
          style={{
            background: 'radial-gradient(circle, rgba(99,102,241,0.5) 0%, transparent 70%)',
            top: '-10%',
            left: '-10%',
          }}
        />
        <div
          className="absolute w-[500px] h-[500px] rounded-full opacity-25 animate-blob-2"
          style={{
            background: 'radial-gradient(circle, rgba(168,85,247,0.5) 0%, transparent 70%)',
            top: '40%',
            right: '-5%',
          }}
        />
        <div
          className="absolute w-[400px] h-[400px] rounded-full opacity-20 animate-blob-3"
          style={{
            background: 'radial-gradient(circle, rgba(59,130,246,0.4) 0%, transparent 70%)',
            bottom: '-5%',
            left: '30%',
          }}
        />
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Floating security particles */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-indigo-400/30"
            style={{
              top: `${15 + i * 15}%`,
              left: `${10 + i * 14}%`,
              animation: `float-particle ${4 + i * 0.7}s ease-in-out infinite alternate`,
              animationDelay: `${i * 0.5}s`,
            }}
          />
        ))}
      </div>

      {/* Card */}
      <div
        ref={formRef}
        className={`relative z-10 w-[420px] max-w-[calc(100vw-2rem)] transition-all duration-700 ease-out ${
          mounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'
        } ${shake ? 'animate-shake' : ''}`}
      >
        <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-2xl p-10 rounded-3xl shadow-[0_20px_60px_rgb(0,0,0,0.12)] dark:shadow-[0_20px_60px_rgb(0,0,0,0.7)] ring-1 ring-white/20 dark:ring-white/10 border border-white/30 dark:border-white/10">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500/20 rounded-2xl blur-xl animate-pulse" />
              <div className="relative w-14 h-14 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <ShieldCheck size={28} className="text-white" />
              </div>
            </div>
          </div>

          {/* Title with typing effect */}
          <h1 className="text-2xl font-black text-center text-gray-900 dark:text-white tracking-tight mb-1">
            TransGuard AI
          </h1>
          <p className="text-center text-sm text-gray-500 dark:text-zinc-400 mb-8 font-medium">
            Secure operator dashboard access
          </p>

          {/* Error message */}
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200/60 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm font-semibold text-center flex items-center justify-center gap-2 animate-fade-in-up">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 4.5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div>
              <label className="block text-xs font-bold text-gray-600 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/60 dark:bg-zinc-950/60 border border-gray-200/80 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all placeholder-gray-400 dark:placeholder-zinc-600"
                placeholder="Enter your username"
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/60 dark:bg-zinc-950/60 border border-gray-200/80 dark:border-white/10 rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all placeholder-gray-400 dark:placeholder-zinc-600"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2 text-sm mt-1"
            >
              {loading ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                'Sign in to Dashboard'
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 pt-5 border-t border-gray-200/50 dark:border-white/5 flex items-center justify-center gap-2 text-[11px] text-gray-400 dark:text-zinc-600">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/60 animate-pulse" />
            <span>Encrypted connection · Edge-secured</span>
          </div>
        </div>
      </div>

      {/* Inline keyframes for particles and shake */}
      <style>{`
        @keyframes float-particle {
          0% { transform: translateY(0px) translateX(0px); opacity: 0.3; }
          100% { transform: translateY(-20px) translateX(10px); opacity: 0.6; }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.6s ease-in-out; }
      `}</style>
    </div>
  );
};

export default LoginView;
