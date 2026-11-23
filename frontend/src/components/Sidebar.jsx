import React, { memo, useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  LayoutDashboard,
  MapPin,
  FileSpreadsheet,
  BarChart3,
  FileText,
  Video,
  Eye,
  Users,
  LogOut,
} from 'lucide-react';
import { SPRING, StatusDot } from './ui/LuxuryPrimitives';
import BrandLogo from './BrandLogo';

const NavItem = ({ label, activeTab, setActiveTab, icon: Icon, searchQuery = '' }) => {
  const isActive = activeTab === label;
  if (searchQuery.trim() && !label.toLowerCase().includes(searchQuery.trim().toLowerCase())) {
    return null;
  }

  return (
    <motion.button
      type="button"
      aria-current={isActive ? 'page' : undefined}
      onClick={() => setActiveTab(label)}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.12 }}
      className={`group w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-lg text-[13px] relative transition-colors cursor-pointer ${isActive
        ? 'text-[var(--text-primary)] font-medium'
        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
    >
      {isActive && (
        <motion.div
          layoutId="nav-active-pill"
          transition={SPRING}
          className="absolute inset-0 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-hairline)]"
        />
      )}

      {Icon && (
        <Icon
          size={15}
          strokeWidth={1.75}
          className={`relative z-10 shrink-0 transition-colors ${isActive
            ? 'text-[var(--text-primary)]'
            : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'
            }`}
        />
      )}
      <span className="relative z-10 truncate">{label}</span>
    </motion.button>
  );
};

const Sidebar = memo(({ activeTab, setActiveTab, onLogout }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [username, setUsername] = useState(
    () => localStorage.getItem('tg_username') || 'Operations Admin'
  );
  const searchInputRef = useRef(null);

  useEffect(() => {
    const updateUsername = () =>
      setUsername(localStorage.getItem('tg_username') || 'Operations Admin');
    window.addEventListener('storage', updateUsername);

    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('storage', updateUsername);
    };
  }, []);

  const initials =
    username
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join('') || 'OP';

  return (
    <aside className="flex w-[220px] h-full bg-[var(--bg-rail)] flex-col border-r border-[var(--border-hairline)] z-10 shrink-0 select-none">
      {/* Prominent Brand Lockup Header */}
      <div className="px-4 pt-5 pb-4 border-b border-[var(--border-hairline)] flex items-center">
        <BrandLogo variant="full" className="w-[156px] h-[44px]" alt="TransGuard AI" />
      </div>

      {/* Quick Jump */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            size={13}
            strokeWidth={1.75}
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search navigation"
            className="w-full h-8 bg-[var(--bg-input)] border border-[var(--border-hairline)] rounded-lg pl-8 pr-9 text-[12px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)] transition-colors"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] text-[var(--text-muted)] pointer-events-none">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-2 space-y-6 custom-scrollbar">
        <div>
          <div className="px-2.5 mb-1.5 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-[0.06em]">
            Command
          </div>
          <div className="space-y-0.5">
            <NavItem
              label="Dashboard"
              icon={LayoutDashboard}
              searchQuery={searchQuery}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
            <NavItem
              label="Spatial Map Tracking"
              icon={MapPin}
              searchQuery={searchQuery}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          </div>
        </div>

        <div>
          <div className="px-2.5 mb-1.5 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-[0.06em]">
            Operations
          </div>
          <div className="space-y-0.5">
            <NavItem
              label="Incident Logs"
              icon={FileSpreadsheet}
              searchQuery={searchQuery}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
            <NavItem
              label="Insights"
              icon={BarChart3}
              searchQuery={searchQuery}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
            <NavItem
              label="Watchlist Queue"
              icon={Eye}
              searchQuery={searchQuery}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
            <NavItem
              label="Camera Nodes"
              icon={Video}
              searchQuery={searchQuery}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          </div>
        </div>

        <div>
          <div className="px-2.5 mb-1.5 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-[0.06em]">
            System
          </div>
          <div className="space-y-0.5">
            <NavItem
              label="My team"
              icon={Users}
              searchQuery={searchQuery}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
            <NavItem
              label="Docs"
              icon={FileText}
              searchQuery={searchQuery}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />
          </div>
        </div>
      </nav>

      {/* Operator Footer + Sign Out Action */}
      <div className="mt-auto px-3.5 py-3 border-t border-[var(--border-hairline)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-hairline)] text-[var(--text-primary)] font-mono text-[11px] font-medium flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <span className="text-[12px] font-medium text-[var(--text-primary)] block truncate">
              {username}
            </span>
            <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <StatusDot variant="live" />
              <span>On Duty</span>
            </span>
          </div>
        </div>

        {onLogout && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={{ duration: 0.12 }}
            onClick={onLogout}
            className="w-8 h-8 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--status-alert)] hover:border-[#FF453A]/30 hover:bg-[#FF453A]/[0.06] flex items-center justify-center cursor-pointer transition-colors shrink-0"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={14} strokeWidth={1.75} />
          </motion.button>
        )}
      </div>
    </aside>
  );
});

Sidebar.displayName = 'Sidebar';
export default Sidebar;
