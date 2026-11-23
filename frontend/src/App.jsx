import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import { API_BASE_URL } from './config';

import Sidebar from './components/Sidebar';
import TopStatusBar from './components/TopStatusBar';
import TransGuardIntro from './components/TransGuardIntro';
import MissionControlDashboard from './components/MissionControlDashboard';
import EventsPanel from './components/EventsPanel';
import DetailPanel from './components/DetailPanel';
import PlaceholderView from './components/PlaceholderView';
import LoginView, { isNightTimeByClock } from './pages/LoginView';
import IncidentMap from './components/IncidentMap';
import { IncidentLogView, WatchlistView } from './components/LiveCameraOperations';
import { ToastProvider, useToast } from './components/ToastProvider';
import { getEnrichedData } from './utils/alertUtils';
import { CameraNodesView, InsightsView, MyTeamView, DocsView } from './views';

function deriveVehicleId(camera) {
  if (camera?.vehicle_id) return camera.vehicle_id;
  const match = String(camera?.camera_id || '').match(/(\d+)$/);
  if (!match) return 'BUS_001';
  const n = parseInt(match[1], 10);
  if (!Number.isFinite(n) || n <= 1) return 'BUS_001';
  return `BUS_${String(n).padStart(3, '0')}`;
}

function AppContent() {
  const [token, setToken] = useState(localStorage.getItem('tg_token') || null);
  const [alerts, setAlerts] = useState([]);
  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState('BUS_001');
  const [esp32Telemetry, setEsp32Telemetry] = useState(null);
  const [backendLatencyMs, setBackendLatencyMs] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('tg_dark_mode');
    return saved !== null ? saved === 'true' : isNightTimeByClock();
  });
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [activeCameras, setActiveCameras] = useState([]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const themeTimerRef = useRef(null);
  const toast = useToast();

  const handleIntroComplete = useCallback(() => {
    setShowIntro(false);
  }, []);

  // Persist theme preference cleanly on <html> (when authenticated; LoginView uses automatic time-based theme)
  useEffect(() => {
    if (!token) {
      const night = isNightTimeByClock();
      document.documentElement.classList.toggle('dark', night);
      return;
    }
    localStorage.setItem('tg_dark_mode', String(isDarkMode));
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode, token]);

  const toggleDarkMode = useCallback(() => {
    const root = document.documentElement;
    root.classList.add('theme-transitioning');
    if (themeTimerRef.current) clearTimeout(themeTimerRef.current);
    themeTimerRef.current = setTimeout(() => {
      root.classList.remove('theme-transitioning');
    }, 460);

    const applyToggle = () => {
      setIsDarkMode((prev) => {
        const next = !prev;
        localStorage.setItem('tg_dark_mode', String(next));
        root.classList.toggle('dark', next);
        return next;
      });
    };

    if (
      typeof document !== 'undefined' &&
      typeof document.startViewTransition === 'function' &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      try {
        document.startViewTransition(() => {
          applyToggle();
        });
        return;
      } catch {
        // Fallback to standard CSS transition
      }
    }
    applyToggle();
  }, []);

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    setMobileSidebarOpen(false);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('tg_token');
    localStorage.removeItem('tg_username');
    setAlerts([]);
    setSelectedAlertId(null);
    setActiveCameras([]);
    setEsp32Telemetry(null);
    setMobileSidebarOpen(false);
    setToken(null);
  }, []);

  // Normalize cameras with resolved vehicle_id (1:1 default or explicit multi-cam binding)
  const normalizedCameras = useMemo(
    () =>
      activeCameras.map((cam) => ({
        ...cam,
        vehicle_id: deriveVehicleId(cam),
      })),
    [activeCameras]
  );

  // Dynamically derive the real fleet list from connected cameras (no fake buses)
  const availableVehicles = useMemo(() => {
    const map = new Map();
    for (const cam of normalizedCameras) {
      const vid = cam.vehicle_id;
      const entry = map.get(vid) || { vehicle_id: vid, cameraCount: 0, cameras: [] };
      entry.cameraCount += 1;
      entry.cameras.push(cam);
      map.set(vid, entry);
    }
    if (map.size === 0) {
      return [{ vehicle_id: 'BUS_001', cameraCount: 0, cameras: [] }];
    }
    return Array.from(map.values()).sort((a, b) => a.vehicle_id.localeCompare(b.vehicle_id));
  }, [normalizedCameras]);

  // Keep selectedVehicle valid whenever the real fleet changes
  useEffect(() => {
    if (
      availableVehicles.length > 0 &&
      !availableVehicles.some((v) => v.vehicle_id === selectedVehicle)
    ) {
      setSelectedVehicle(availableVehicles[0].vehicle_id);
    }
  }, [availableVehicles, selectedVehicle]);

  const alertBuffer = useRef([]);

  const fetchCameras = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/edge/cameras`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          setActiveCameras(data);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch camera list:', err);
    }
  }, [token]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  const selectedVehicleRef = useRef(selectedVehicle);
  useEffect(() => {
    selectedVehicleRef.current = selectedVehicle;
  }, [selectedVehicle]);

  // Initial ESP32 telemetry fetch + low-frequency 15s health/latency check (paused when tab hidden)
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const pollTelemetry = async (force = false) => {
      if (!force && typeof document !== 'undefined' && document.hidden) return;
      const t0 = performance.now();
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/alerts/telemetry/${encodeURIComponent(selectedVehicle)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }
        );
        const rtt = Math.max(1, Math.round(performance.now() - t0));
        if (!cancelled) {
          if (res.ok) {
            const data = await res.json();
            setEsp32Telemetry(data);
            setBackendLatencyMs(rtt);
          } else {
            setBackendLatencyMs(null);
          }
        }
      } catch {
        if (!cancelled) setBackendLatencyMs(null);
      }
    };

    pollTelemetry(true);
    const timer = setInterval(() => pollTelemetry(false), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, selectedVehicle]);

  useEffect(() => {
    if (!token) return;

    const socket = io(API_BASE_URL, {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
      if (
        err.message &&
        (err.message.includes('Authentication error') ||
          err.message.includes('jwt') ||
          err.message.includes('token'))
      ) {
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
      if (data.cameras) {
        setActiveCameras(data.cameras);
      }
    });

    socket.on('new_alert', (alert) => {
      alertBuffer.current.push(alert);

      if (toast) {
        const enriched = getEnrichedData(alert);
        const severity = enriched?.incident_info?.severity || 'MEDIUM';
        toast.addToast({
          title: `${enriched?.incident_info?.label || 'New Incident'} — ${enriched?.camera_id || 'Unknown'}`,
          message: `Confidence: ${enriched?.confidence ?? '—'}%`,
          severity,
        });
      }
    });

    socket.on('camera_status', (cam) => {
      setActiveCameras((prev) => {
        const idx = prev.findIndex((c) => c.camera_id === cam.camera_id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...cam };
          return updated;
        }
        return [...prev, cam];
      });
    });

    socket.on('vehicle_telemetry', (payload) => {
      if (payload && payload.vehicle_id === selectedVehicleRef.current) {
        setEsp32Telemetry(payload);
      }
    });

    socket.on('alert_deleted', (payload) => {
      const deletedId = payload?.id || payload?._id;
      if (!deletedId) return;
      setAlerts((prev) => prev.filter((a) => (a.id || a._id) !== deletedId));
      setSelectedAlertId((current) => (current === deletedId ? null : current));
    });

    socket.on('alert_updated', (updatedAlert) => {
      const updatedId = updatedAlert?.id || updatedAlert?._id;
      if (!updatedId) return;
      setAlerts((prev) =>
        prev.map((a) => ((a.id || a._id) === updatedId ? { ...a, ...updatedAlert } : a))
      );
    });

    const flushInterval = setInterval(() => {
      if (alertBuffer.current.length > 0) {
        setAlerts((prev) => {
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

  const handleDeleteAlert = useCallback(
    async (alertId) => {
      if (!alertId) return false;
      try {
        const res = await fetch(`${API_BASE_URL}/api/alerts/${alertId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to delete alert');
        }
        setAlerts((prev) => prev.filter((a) => (a.id || a._id) !== alertId));
        if (selectedAlertId === alertId) {
          setSelectedAlertId(null);
        }
        if (toast) {
          toast.addToast({
            title: 'Alert Deleted',
            message: 'The record has been permanently removed.',
            severity: 'MEDIUM',
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
    },
    [token, selectedAlertId, toast]
  );

  const handleAcknowledgeAlert = useCallback(
    async (alertId, status = 'REVIEWED') => {
      if (!alertId) return false;
      try {
        const res = await fetch(`${API_BASE_URL}/api/alerts/${alertId}/acknowledge`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to acknowledge incident');
        }
        const updated = await res.json().catch(() => ({}));
        const reviewedBy = updated.reviewed_by || localStorage.getItem('tg_username') || 'admin';
        const reviewedAt = updated.reviewed_at || new Date().toISOString();
        setAlerts((prev) =>
          prev.map((a) =>
            (a.id || a._id) === alertId
              ? { ...a, status, reviewed_by: reviewedBy, reviewed_at: reviewedAt }
              : a
          )
        );
        if (toast) {
          toast.addToast({
            title:
              status === 'REVIEWED'
                ? 'Validator Accepted — Vehicle Siren Triggered'
                : 'Validator Rejected — Logged as False Alarm',
            message:
              status === 'REVIEWED'
                ? `5s cabin siren queued for ${selectedVehicle} & Telegram evidence sent.`
                : 'Recorded as Rejected in Incident Logs.',
            severity: status === 'REVIEWED' ? 'SUCCESS' : 'MEDIUM',
          });
        }
        return true;
      } catch (err) {
        if (toast) {
          toast.addToast({
            title: 'Validation Failed',
            message: err.message || 'Could not update incident validation status.',
            severity: 'HIGH',
          });
        }
        return false;
      }
    },
    [token, toast, selectedVehicle]
  );

  const selectedAlert = selectedAlertId
    ? alerts.find((alert) => (alert.id || alert._id) === selectedAlertId) ?? null
    : null;

  if (!token) {
    const loginDarkByTime = isNightTimeByClock();
    return (
      <>
        <TransGuardIntro
          visible={showIntro}
          isDarkMode={loginDarkByTime}
          onComplete={handleIntroComplete}
        />
        <LoginView setToken={setToken} />
      </>
    );
  }

  return (
    <>
      <TransGuardIntro
        visible={showIntro}
        isDarkMode={isDarkMode}
        onComplete={handleIntroComplete}
      />
      <div className="w-screen h-screen h-[100dvh] overflow-hidden bg-[var(--bg-canvas)] flex flex-col font-sans text-[var(--text-primary)]">
        {/* 1. TOP MINIMAL STATUS BAR (52px) */}
        <TopStatusBar
          activeTab={activeTab}
          activeCameras={normalizedCameras}
          esp32Telemetry={esp32Telemetry}
          backendLatencyMs={backendLatencyMs}
          isDarkMode={isDarkMode}
          toggleDarkMode={toggleDarkMode}
          onOpenMobileMenu={() => setMobileSidebarOpen(true)}
        />

      {/* 2. VIEWPORT-LOCKED WORKSPACE SHELL */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Mobile sidebar backdrop */}
        {mobileSidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Left Navigation Rail */}
        <div
          className={`
            fixed lg:relative inset-y-0 left-0 z-50 lg:z-auto
            transition-transform duration-200 ease-out
            ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
        >
          <Sidebar
            activeTab={activeTab}
            setActiveTab={handleTabChange}
            onLogout={handleLogout}
          />
        </div>

        {/* Active View Surface */}
        {activeTab === 'Dashboard' ? (
          <MissionControlDashboard
            cameras={normalizedCameras}
            alerts={alerts}
            token={token}
            selectedVehicle={selectedVehicle}
            onSelectVehicle={setSelectedVehicle}
            esp32Telemetry={esp32Telemetry}
            onAcknowledgeAlert={handleAcknowledgeAlert}
            isDarkMode={isDarkMode}
            toggleDarkMode={toggleDarkMode}
          />
        ) : activeTab === 'Spatial Map Tracking' ? (
          <div className="flex-1 relative bg-[var(--bg-canvas)] overflow-hidden animate-fade-in-up">
            <IncidentMap
              alerts={alerts}
              isDarkMode={isDarkMode}
              selectedAlert={selectedAlert}
              onSelectAlert={(a) => setSelectedAlertId(a ? a.id || a._id : null)}
              selectedVehicle={selectedVehicle}
              esp32Telemetry={esp32Telemetry}
            />
            <EventsPanel
              alerts={alerts}
              onSelectAlert={(a) => setSelectedAlertId(a.id || a._id)}
              selectedAlertId={selectedAlertId}
            />
            <DetailPanel
              alert={selectedAlert}
              onClose={() => setSelectedAlertId(null)}
              onDeleteAlert={handleDeleteAlert}
              onAcknowledgeAlert={handleAcknowledgeAlert}
            />
          </div>
        ) : activeTab === 'Incident Logs' ? (
          <IncidentLogView
            alerts={alerts}
            token={token}
            onAcknowledgeAlert={handleAcknowledgeAlert}
            onDeleteAlert={handleDeleteAlert}
          />
        ) : activeTab === 'Watchlist Queue' ? (
          <WatchlistView token={token} />
        ) : activeTab === 'Camera Nodes' ? (
          <CameraNodesView
            activeCameras={normalizedCameras}
            token={token}
            onRefreshCameras={fetchCameras}
            onFocusBus={(vid) => {
              setSelectedVehicle(vid);
              setActiveTab('Dashboard');
            }}
          />
        ) : activeTab === 'Insights' ? (
          <InsightsView alerts={alerts} activeCameras={normalizedCameras} />
        ) : activeTab === 'My team' ? (
          <MyTeamView isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
        ) : activeTab === 'Docs' ? (
          <DocsView />
        ) : (
          <PlaceholderView title={activeTab} />
        )}
      </div>
    </div>
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
