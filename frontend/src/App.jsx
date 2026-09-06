import React, { useState, useEffect, useRef } from 'react';
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

// Import views
import {
  CameraNodesView, InsightsView, MyTeamView, DocsView
} from './DashboardViews';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('tg_token') || null);
  const [alerts, setAlerts] = useState([]);
  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState('Fleet GPS Tracking');
  const [activeCameras, setActiveCameras] = useState([]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const alertBuffer = useRef([]);

  useEffect(() => {
    if (!token) return; // Wait for login

    const socket = io(API_BASE_URL, {
      auth: { token },
      transports: ['websocket']
    });
    socket.on('connect_error', (err) => {
      console.error('Socket authentication error:', err.message);
      localStorage.removeItem('tg_token');
      setToken(null);
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
  }, [token]);

  const selectedAlert = selectedAlertId ? alerts.find((alert) => (alert.id || alert._id) === selectedAlertId) ?? null : null;

  if (!token) {
    return <LoginView setToken={setToken} isDarkMode={isDarkMode} />;
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-white dark:bg-zinc-950/80 dark:backdrop-blur-xl flex font-sans text-gray-900 dark:text-zinc-100">
      <Sidebar
        isDarkMode={isDarkMode}
        toggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {activeTab === 'Fleet GPS Tracking' ? (
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
          />
        </div>
      ) : activeTab === 'Incident Logs' ? (
        <IncidentLogView alerts={alerts} />
      ) : activeTab === 'Dashboard' ? (
        <DashboardOperationsView cameras={activeCameras} token={token} />
      ) : activeTab === 'Watchlist Queue' ? (
        <WatchlistView token={token} />
      ) : activeTab === 'Camera Nodes' ? (
        <CameraNodesView activeCameras={activeCameras} token={token} />
      ) : activeTab === 'Insights' ? (
        <InsightsView />
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
