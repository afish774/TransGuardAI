import React, { useState } from 'react';
import { Bell, Mail } from 'lucide-react';

export const MyTeamView = () => {
  const username = (typeof window !== 'undefined' ? localStorage.getItem('tg_username') : null) || 'Operations Admin';
  const [criticalAlertsEnabled, setCriticalAlertsEnabled] = useState(true);
  const [watchlistSmsEnabled, setWatchlistSmsEnabled] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-zinc-950 p-6 md:p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="col-span-1 lg:col-span-2 bg-white dark:bg-zinc-900/80 border border-gray-200 dark:border-white/10 rounded-2xl p-6 md:p-8 shadow-sm">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 pb-6 border-b border-gray-100 dark:border-white/10">
              <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=4f46e5&color=fff&size=96`} className="w-20 h-20 rounded-2xl shadow-md shrink-0" alt={username} />
              <div>
                <h2 className="text-2xl font-black text-gray-900 dark:text-zinc-100 tracking-tight">{username}</h2>
                <p className="text-xs font-semibold text-emerald-500 mt-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Certified Operator · Surveillance Clearance
                </p>
                <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">Trans Guard AI Enterprise Node Controller</p>
              </div>
              <button type="button" disabled title="Profile management is managed via corporate SSO" className="sm:ml-auto px-3.5 py-1.5 border border-gray-200 dark:border-white/15 rounded-lg text-xs font-bold text-gray-400 dark:text-zinc-500 cursor-not-allowed opacity-60">Edit Profile</button>
            </div>
            <div className="space-y-4 pt-6">
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-100 uppercase tracking-wider mb-3">Operator Alert Subscriptions</h3>
              <div className="flex items-center justify-between p-4 bg-gray-50/70 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-500/10 text-red-500"><Bell size={18} /></div>
                  <div>
                    <div className="font-bold text-sm text-gray-900 dark:text-zinc-100">Critical Threat Push Alerts</div>
                    <div className="text-xs text-gray-500 dark:text-zinc-400">Instant browser notifications for Weapon, Violence, and Fall events.</div>
                  </div>
                </div>
                <button type="button" role="switch" aria-checked={criticalAlertsEnabled} onClick={() => setCriticalAlertsEnabled(!criticalAlertsEnabled)} aria-label="Toggle critical incident alerts" className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${criticalAlertsEnabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-zinc-700'}`}>
                  <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform ${criticalAlertsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50/70 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500"><Mail size={18} /></div>
                  <div>
                    <div className="font-bold text-sm text-gray-900 dark:text-zinc-100">Watchlist SMS Dispatch</div>
                    <div className="text-xs text-gray-500 dark:text-zinc-400">Dispatch immediate SMS text to on-duty security when a high-confidence match occurs.</div>
                  </div>
                </div>
                <button type="button" role="switch" aria-checked={watchlistSmsEnabled} onClick={() => setWatchlistSmsEnabled(!watchlistSmsEnabled)} aria-label="Toggle watchlist SMS dispatch" className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${watchlistSmsEnabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-zinc-700'}`}>
                  <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform ${watchlistSmsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>
          <div className="col-span-1 bg-white dark:bg-zinc-900/80 border border-gray-200 dark:border-white/10 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-100 uppercase tracking-wider mb-4">Active Roster</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50/80 dark:bg-white/5 border border-gray-100 dark:border-white/5">
                  <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=4f46e5&color=fff&size=64`} className="w-10 h-10 rounded-full" alt={username} />
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-gray-900 dark:text-zinc-100 truncate">{username}</div>
                    <div className="text-xs text-emerald-500 font-semibold">Active Session</div>
                  </div>
                </div>
              </div>
            </div>
            <button type="button" disabled title="Team invitations require Enterprise Administrator privileges" className="w-full mt-6 py-2 bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-zinc-500 border border-gray-200 dark:border-white/10 font-bold text-xs rounded-xl cursor-not-allowed opacity-60">+ Invite Team Member</button>
          </div>
        </div>
      </div>
    </div>
  );
};
