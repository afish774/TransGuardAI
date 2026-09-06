import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

const LoginView = ({ setToken, isDarkMode }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      const res = await fetch(`${backendUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      
      if (res.ok && data.token) {
        localStorage.setItem('tg_token', data.token);
        setToken(data.token);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch {
      setError('Network error connecting to backend');
    }
  };

  return (
    <div className={`w-screen h-screen flex items-center justify-center ${isDarkMode ? 'dark bg-zinc-950' : 'bg-[#e5e5e5]'}`}>
      <div className="w-[400px] bg-white dark:bg-zinc-900/95 dark:backdrop-blur-xl p-10 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.6)] dark:ring-1 dark:ring-white/10 border border-gray-200/50 dark:border-white/10">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-gray-900 dark:bg-white rounded-xl flex items-center justify-center">
            <ShieldCheck size={24} className="text-white dark:text-black" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-2">TransGuard AI</h2>
        <p className="text-center text-sm text-gray-500 dark:text-zinc-400 mb-8">Sign in to the operator dashboard</p>
        
        {error && <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm font-medium text-center">{error}</div>}
        
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-white/10 rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/20 transition-all"
              placeholder="operator"
              required
            />
          </div>
          <div className="mb-2">
            <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-white/10 rounded-lg px-4 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/20 transition-all"
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" className="w-full bg-gray-900 dark:bg-white text-white dark:text-black font-semibold py-2.5 rounded-lg shadow-sm hover:opacity-90 transition-opacity">
            Authenticate
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginView;
