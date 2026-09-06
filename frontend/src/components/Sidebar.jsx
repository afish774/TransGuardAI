import React, { memo } from 'react';
import { Search, LayoutDashboard, ShieldCheck, Settings, Play, Inbox, FileText, ChevronUp, Video, Eye } from 'lucide-react';

const NavItem = ({ label, activeTab, setActiveTab, icon: Icon, badge, indent = false }) => {
  const isActive = activeTab === label;

  return (
    <button
      onClick={() => setActiveTab(label)}
      className={`w-full flex items-center justify-between text-left py-1.5 text-sm relative transition-colors ${indent ? 'px-3' : 'px-2'} ${isActive
          ? 'text-gray-900 dark:text-zinc-100 font-semibold'
          : 'text-gray-500 dark:text-zinc-500 hover:text-gray-900 dark:hover:text-white font-medium'
        }`}
    >
      {isActive && (
        <div className={`absolute ${indent ? 'left-[-24px]' : 'left-[-16px]'} w-[2px] h-4 bg-gray-900 dark:bg-indigo-500 rounded-r`}></div>
      )}

      <div className="flex items-center gap-2.5">
        {Icon && <Icon size={indent ? 16 : 14} className={isActive ? "text-gray-900 dark:text-zinc-100" : "text-gray-400 dark:text-zinc-500"} />}
        {label}
      </div>

      {badge && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive
            ? 'bg-gray-200 dark:bg-white/10 text-gray-800 dark:text-zinc-200'
            : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-zinc-400'
          }`}>
          {badge}
        </span>
      )}
    </button>
  );
};

const Sidebar = memo(({ isDarkMode, toggleDarkMode, activeTab, setActiveTab }) => {
  return (
    <div className="hidden lg:flex w-[260px] h-full bg-[#fcfcfc] dark:bg-zinc-900/95 dark:backdrop-blur-xl flex-col border-r border-gray-200 dark:border-white/10 z-10 shrink-0 shadow-sm relative">
      <div className="px-5 py-5 flex items-center gap-2 mb-2">
        <div className="w-7 h-7 bg-black dark:bg-[#222] rounded-md flex items-center justify-center">
          <Play size={12} className="text-white ml-0.5" fill="currentColor" />
        </div>
        <span className="font-bold text-gray-900 dark:text-zinc-100 text-lg tracking-tight">TRANS GUARD AI</span>
      </div>

      <div className="px-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-gray-400 dark:text-zinc-500" size={14} />
          <input
            type="text"
            placeholder="Search"
            className="w-full bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-300 text-gray-700 dark:text-zinc-200 shadow-sm"
          />
          <span className="absolute right-2 top-2.5 text-[10px] text-gray-400 dark:text-zinc-500 font-bold bg-gray-100 dark:bg-white/5 rounded px-1.5 py-0.5 border border-gray-200 dark:border-white/10">⌘K</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 custom-scrollbar">
        <div className="mb-6">
          <div className="px-3 mb-1.5 flex items-center gap-2.5 text-gray-900 dark:text-zinc-100">
            <LayoutDashboard size={16} className="text-gray-500 dark:text-zinc-500" />
            <span className="text-sm font-semibold">Live Dashboard</span>
          </div>
          <div className="flex flex-col ml-8">
            <NavItem label="Dashboard" activeTab={activeTab} setActiveTab={setActiveTab} />
            <NavItem label="Fleet GPS Tracking" activeTab={activeTab} setActiveTab={setActiveTab} />
          </div>
        </div>

        <div className="mb-6">
          <div className="px-3 mb-1.5 flex items-center gap-2.5 text-gray-900 dark:text-zinc-100">
            <ShieldCheck size={16} className="text-gray-500 dark:text-zinc-500" />
            <span className="text-sm font-semibold">Safety</span>
          </div>
          <div className="flex flex-col ml-8">
            <NavItem label="Incident Logs" activeTab={activeTab} setActiveTab={setActiveTab} />
            <NavItem label="Insights" activeTab={activeTab} setActiveTab={setActiveTab} />
            <NavItem label="Watchlist Queue" icon={Eye} activeTab={activeTab} setActiveTab={setActiveTab} />
          </div>
        </div>

        <div className="mb-6">
          <div className="px-3 mb-3 text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-widest">Systems</div>
          <div className="flex flex-col gap-0.5">
            <NavItem label="Camera Nodes" icon={Video} indent={true} activeTab={activeTab} setActiveTab={setActiveTab} />
          </div>
        </div>

        <div className="mb-6">
          <div className="px-3 mb-2 flex items-center justify-between text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-widest">
            Personal
            <ChevronUp size={14} className="text-gray-400 dark:text-zinc-500" />
          </div>
          <div className="flex flex-col gap-0.5">
            <NavItem label="My team" icon={Inbox} indent={true} activeTab={activeTab} setActiveTab={setActiveTab} />
            <NavItem label="Docs" icon={FileText} indent={true} activeTab={activeTab} setActiveTab={setActiveTab} />
          </div>
        </div>
      </div>

      <div className="mt-auto p-4 border-t border-gray-100 dark:border-white/5 flex items-center justify-between bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <img src="https://ui-avatars.com/api/?name=Jaylon+Philips&background=random" className="w-8 h-8 rounded-full shadow-sm" alt="User" />
          <span className="text-sm font-bold text-gray-900 dark:text-zinc-100">Jaylon Philips</span>
        </div>
        <div className="flex items-center gap-2 text-gray-400 dark:text-zinc-500">
          <Settings size={16} className="hover:text-gray-900 dark:hover:text-white dark:text-zinc-100 cursor-pointer transition-colors" />
          <button
            type="button"
            onClick={toggleDarkMode}
            className="w-6 h-6 bg-gray-100 dark:bg-white/5 rounded flex items-center justify-center hover:bg-gray-200 dark:hover:bg-white/10 cursor-pointer transition-colors"
            title="Toggle Dark Mode"
          >
            {isDarkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

export default Sidebar;
