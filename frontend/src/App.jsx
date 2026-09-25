import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { API_BASE_URL } from './config';

// Import refactored modular components
import Sidebar from './components/Sidebar';
import EventsPanel from './components/EventsPanel';
import DetailPanel from './components/DetailPanel';
import PlaceholderView from './components/PlaceholderView';
import LoginView from './pages/LoginView';
import IncidentMap from './components/IncidentMap';
import { DashboardOperationsView, IncidentLogView, WatchlistView } from './components/LiveCameraOperations';
import { ToastProvider, useToast } from './components/ToastProvider';
import { getEnrichedData } from './utils/alertUtils';

// Import views (decomposed from monolithic DashboardViews.jsx)
import {
  CameraNodesView, InsightsView, MyTeamView, DocsView
} from './views';

function AppContent() {
  const [token, setToken] = useState(localStorage.getItem('tg_token') || null);
  const [alerts, setAlerts] = useState([]);
  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('tg_dark_mode');
    return saved !== null ? saved === 'true' : true;
  });
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [activeCameras, setActiveCameras] = useState([]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const toast = useToast();

  // Persist dark mode preference
  useEffect(() => {
    localStorage.setItem('tg_dark_mode', isDarkMode);
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Close mobile sidebar on navigation
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    setMobileSidebarOpen(false);
  }, []);

  const alertBuffer = useRef([]);

  useEffect(() => {
    if (!token) return; // Wait for login

    const socket = io(API_BASE_URL, {
      auth: { token },
      transports: ['websocket']
    });
    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      if (err.message && (err.message.includes('Authentication error') || err.message.includes('jwt') || err.message.includes('token'))) {
        localStorage.removeItem('tg_token');
        setToken(null);
      }
    });

    socket.on('initial_state', (data) => {
      const initialAlerts = Array.isArray(data.alerts) ? data.alerts : [];
      setAlerts(initialAlerts);
      if (initialAlerts.length > 0) {
        setSelectedAlertId((current) => current ?? (initialAlerts[0].id || initialAlerts[0]._id));
      }
      // MULTI-CAM: Initialize camera list from backend
      if (data.cameras) {
        setActiveCameras(data.cameras);
      }
    });

    socket.on('new_alert', (alert) => {
      alertBuffer.current.push(alert);

      // Fire toast notification for new incidents
      if (toast) {
        const enriched = getEnrichedData(alert);
        const severity = enriched?.incident_info?.severity || 'MEDIUM';
        toast.addToast({
          title: `${enriched?.incident_info?.label || 'New Incident'} — ${enriched?.camera_id || 'Unknown'}`,
          message: `Pillar: ${enriched?.pillar || 'ANOMALY'} · Confidence: ${enriched?.confidence ?? '—'}%`,
          severity,
        });
      }
    });

    // MULTI-CAM: Real-time camera status updates
    socket.on('camera_status', (cam) => {
      setActiveCameras(prev => {
        const idx = prev.findIndex(c => c.camera_id === cam.camera_id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...cam };
          return updated;
        }
        return [...prev, cam];
      });
    });

    // Real-time alert deletion sync across all operator dashboards
    socket.on('alert_deleted', (payload) => {
      const deletedId = payload?.id || payload?._id;
      if (!deletedId) return;
      setAlerts(prev => prev.filter(a => (a.id || a._id) !== deletedId));
      setSelectedAlertId(current => (current === deletedId ? null : current));
    });

    const flushInterval = setInterval(() => {
      if (alertBuffer.current.length > 0) {
        setAlerts(prev => {
          const queuedAlerts = alertBuffer.current.splice(0).reverse();
          const updated = [...queuedAlerts, ...prev];
          alertBuffer.current = [];

          setSelectedAlertId((current) => current ?? (updated[0]?.id || updated[0]?._id) ?? null);

          return updated.slice(0, 200);
        });
      }
    }, 300);

    return () => {
      clearInterval(flushInterval);
      socket.disconnect();
    };
  }, [token, toast]);

  const handleDeleteAlert = useCallback(async (alertId) => {
    if (!alertId) return false;
    try {
      const res = await fetch(`${API_BASE_URL}/api/alerts/${alertId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete alert');
      }
      setAlerts(prev => prev.filter(a => (a.id || a._id) !== alertId));
      if (selectedAlertId === alertId) {
        setSelectedAlertId(null);
      }
      if (toast) {
        toast.addToast({
          title: 'Alert Deleted',
          message: 'The irrelevant alert has been permanently removed.',
          severity: 'LOW',
        });
      }
      return true;
    } catch (err) {
      if (toast) {
        toast.addToast({
          title: 'Delete Failed',
          message: err.message || 'Could not delete the alert.',
          severity: 'HIGH',
        });
      }
      return false;
    }
  }, [token, selectedAlertId, toast]);

  const selectedAlert = selectedAlertId ? alerts.find((alert) => (alert.id || alert._id) === selectedAlertId) ?? null : null;

  if (!token) {
    return <LoginView setToken={setToken} isDarkMode={isDarkMode} />;
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl flex font-sans text-gray-900 dark:text-zinc-100">
      {/* Mobile menu button */}
      <button
        type="button"
        onClick={() => setMobileSidebarOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm border border-gray-200 dark:border-white/10 shadow-lg"
        aria-label="Open navigation menu"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 4.5h12M3 9h12M3 13.5h12" />
        </svg>
      </button>

      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — always visible on lg+, slide-in on mobile */}
      <div className={`
        fixed lg:relative z-50 lg:z-auto
        transition-transform duration-300 ease-out
        ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar
          isDarkMode={isDarkMode}
          toggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          activeTab={activeTab}
          setActiveTab={handleTabChange}
        />
      </div>

      {activeTab === 'Spatial Map Tracking' ? (
        <div className="flex-1 relative bg-gray-50 dark:bg-zinc-950 animate-fade-in-up">
          <IncidentMap alerts={alerts} isDarkMode={isDarkMode} />

          <EventsPanel
            alerts={alerts}
            onSelectAlert={(a) => setSelectedAlertId(a.id || a._id)}
            selectedAlertId={selectedAlertId}
          />

          <DetailPanel
            alert={selectedAlert}
            onClose={() => setSelectedAlertId(null)}
            onDeleteAlert={handleDeleteAlert}
          />
        </div>
      ) : activeTab === 'Incident Logs' ? (
        <IncidentLogView alerts={alerts} onDeleteAlert={handleDeleteAlert} />
      ) : activeTab === 'Dashboard' ? (
        <DashboardOperationsView cameras={activeCameras} token={token} />
      ) : activeTab === 'Watchlist Queue' ? (
        <WatchlistView token={token} />
      ) : activeTab === 'Camera Nodes' ? (
        <CameraNodesView activeCameras={activeCameras} token={token} />
      ) : activeTab === 'Insights' ? (
        <InsightsView alerts={alerts} activeCameras={activeCameras} />
      ) : activeTab === 'My team' ? (
        <MyTeamView />
      ) : activeTab === 'Docs' ? (
        <DocsView />
      ) : (
        <PlaceholderView title={activeTab} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
