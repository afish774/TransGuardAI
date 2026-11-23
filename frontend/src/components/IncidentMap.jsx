import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Compass,
  ExternalLink,
  LocateFixed,
  Maximize2,
  Minus,
  Navigation,
  Plus,
  Radio,
} from 'lucide-react';
import { StatusDot } from './ui/LuxuryPrimitives';
import { getEnrichedData } from '../utils/alertUtils';

// Fix Leaflet's default icon path in bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DEFAULT_CENTER = [10.5898, 76.0116];

function createIncidentPin({ severity = 'MEDIUM', status = 'NEW', isSelected = false }) {
  const color =
    status === 'REVIEWED'
      ? '#30D158'
      : status === 'DISMISSED'
      ? '#8E8E93'
      : severity === 'CRITICAL'
      ? '#FF453A'
      : '#FF9F0A';

  const size = isSelected ? 32 : 24;
  const core = isSelected ? 16 : 12;
  const ringBorder = isSelected ? '3px solid #FFFFFF' : '2px solid #FFFFFF';
  const pulseHtml =
    status !== 'DISMISSED' && (severity === 'CRITICAL' || isSelected)
      ? `<span style="position:absolute;inset:0;border-radius:9999px;background:${color};opacity:0.42;animation:ping 1.8s cubic-bezier(0,0,0.2,1) infinite;"></span>`
      : '';

  return L.divIcon({
    className: 'custom-map-pin',
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
        ${pulseHtml}
        <span style="position:relative;display:flex;width:${core + 6}px;height:${core + 6}px;border-radius:9999px;background:${color};border:${ringBorder};box-shadow:0 6px 16px rgba(0,0,0,0.45),0 0 0 ${
          isSelected ? '4px rgba(255,255,255,0.22)' : '1px rgba(0,0,0,0.2)'
        };transition:transform 0.2s ease;"></span>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createVehicleBeaconIcon({ vehicleId = 'BUS_001', online = false, isDarkMode = true }) {
  const dotColor = online ? '#30D158' : '#FF9F0A';
  const pillBg = isDarkMode ? 'rgba(11, 11, 14, 0.88)' : 'rgba(255, 255, 255, 0.94)';
  const pillText = isDarkMode ? '#FFFFFF' : '#0F172A';
  const pillBorder = isDarkMode ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.14)';

  return L.divIcon({
    className: 'custom-vehicle-beacon',
    html: `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);pointer-events:auto;">
        <div style="display:flex;align-items:center;gap:5px;padding:3px 8px;border-radius:9999px;background:${pillBg};color:${pillText};border:1px solid ${pillBorder};box-shadow:0 8px 20px rgba(0,0,0,0.32);font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:600;white-space:nowrap;margin-bottom:5px;backdrop-filter:blur(12px);">
          <span style="width:6px;height:6px;border-radius:9999px;background:${dotColor};display:inline-block;"></span>
          <span>${vehicleId}</span>
        </div>
        <div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center;">
          <span style="position:absolute;inset:0;border-radius:9999px;background:#0A84FF;opacity:0.32;animation:ping 2.2s cubic-bezier(0,0,0.2,1) infinite;"></span>
          <span style="position:relative;width:14px;height:14px;border-radius:9999px;background:#0A84FF;border:2.5px solid #FFFFFF;box-shadow:0 4px 12px rgba(10,132,255,0.55);"></span>
        </div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function MapController({ selectedCoords, flyTrigger, fitPoints, onMapReady }) {
  const map = useMap();

  useEffect(() => {
    onMapReady?.(map);
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 180);
    return () => clearTimeout(timer);
  }, [map, onMapReady]);

  // Smooth flyTo whenever selected incident or explicit focus target changes
  useEffect(() => {
    if (!selectedCoords || !Number.isFinite(selectedCoords[0]) || !Number.isFinite(selectedCoords[1])) {
      return;
    }
    try {
      map.flyTo(selectedCoords, Math.max(map.getZoom(), 15), {
        animate: true,
        duration: 0.75,
      });
    } catch {
      map.setView(selectedCoords, 15);
    }
  }, [map, selectedCoords, flyTrigger]);

  // Fit bounds helper when triggered
  useEffect(() => {
    if (!fitPoints || fitPoints.length === 0) return;
    try {
      if (fitPoints.length === 1) {
        map.flyTo(fitPoints[0], 14, { animate: true, duration: 0.7 });
      } else {
        const bounds = L.latLngBounds(fitPoints);
        map.flyToBounds(bounds, { padding: [70, 70], maxZoom: 15, duration: 0.75 });
      }
    } catch {
      // ignore invalid bounds
    }
  }, [map, fitPoints]);

  return null;
}

function IncidentMap({
  alerts = [],
  isDarkMode = true,
  selectedAlert = null,
  onSelectAlert,
  selectedVehicle = 'BUS_001',
  esp32Telemetry = null,
}) {
  const [mapInstance, setMapInstance] = useState(null);
  const [flyTarget, setFlyTarget] = useState(null);
  const [flyTrigger, setFlyTrigger] = useState(0);
  const [fitPointsTrigger, setFitPointsTrigger] = useState(null);

  const tileUrl = isDarkMode
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';

  // Extract valid GPS alerts
  const gpsAlerts = useMemo(
    () =>
      alerts.filter(
        (a) => a?.gps && Number.isFinite(Number(a.gps.lat)) && Number.isFinite(Number(a.gps.lon))
      ),
    [alerts]
  );

  // Resolve live vehicle coordinates (from ESP32 telemetry, latest GPS alert, or transit hub fallback)
  const vehicleCoords = useMemo(() => {
    if (
      Number.isFinite(Number(esp32Telemetry?.lat)) &&
      Number.isFinite(Number(esp32Telemetry?.lon)) &&
      (Number(esp32Telemetry.lat) !== 0 || Number(esp32Telemetry.lon) !== 0)
    ) {
      return [Number(esp32Telemetry.lat), Number(esp32Telemetry.lon)];
    }
    if (gpsAlerts.length > 0) {
      return [Number(gpsAlerts[0].gps.lat), Number(gpsAlerts[0].gps.lon)];
    }
    return DEFAULT_CENTER;
  }, [esp32Telemetry?.lat, esp32Telemetry?.lon, gpsAlerts]);

  const hasLiveGpsFix = Boolean(
    esp32Telemetry?.has_fix &&
      Number.isFinite(Number(esp32Telemetry?.lat)) &&
      Number.isFinite(Number(esp32Telemetry?.lon))
  );
  const esp32Online = Boolean(esp32Telemetry?.online);
  const speedKmph = Number.isFinite(Number(esp32Telemetry?.speed_kmph))
    ? Number(esp32Telemetry.speed_kmph).toFixed(0)
    : '0';
  const satellites = Number.isFinite(Number(esp32Telemetry?.satellites))
    ? Number(esp32Telemetry.satellites)
    : 0;

  // Automatically fly to selected alert when chosen from feed
  useEffect(() => {
    const lat = Number(selectedAlert?.gps?.lat);
    const lon = Number(selectedAlert?.gps?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      setFlyTarget([lat, lon]);
      setFlyTrigger((n) => n + 1);
    }
  }, [selectedAlert]);

  const handleCenterOnBus = useCallback(() => {
    setFlyTarget(vehicleCoords);
    setFlyTrigger((n) => n + 1);
  }, [vehicleCoords]);

  const handleFitAll = useCallback(() => {
    const pts = [
      vehicleCoords,
      ...gpsAlerts.map((a) => [Number(a.gps.lat), Number(a.gps.lon)]),
    ];
    setFitPointsTrigger([...pts]);
  }, [vehicleCoords, gpsAlerts]);

  const handleZoomIn = useCallback(() => {
    mapInstance?.zoomIn();
  }, [mapInstance]);

  const handleZoomOut = useCallback(() => {
    mapInstance?.zoomOut();
  }, [mapInstance]);

  const activeCoords =
    selectedAlert?.gps &&
    Number.isFinite(Number(selectedAlert.gps.lat)) &&
    Number.isFinite(Number(selectedAlert.gps.lon))
      ? [Number(selectedAlert.gps.lat), Number(selectedAlert.gps.lon)]
      : vehicleCoords;

  const googleMapsUrl = `https://www.google.com/maps?q=${activeCoords[0].toFixed(
    6
  )},${activeCoords[1].toFixed(6)}`;

  const selectedId = selectedAlert ? selectedAlert.id || selectedAlert._id : null;

  const vehicleIcon = useMemo(
    () =>
      createVehicleBeaconIcon({
        vehicleId: selectedVehicle,
        online: esp32Online,
        isDarkMode,
      }),
    [selectedVehicle, esp32Online, isDarkMode]
  );

  return (
    <div className="absolute inset-0 z-0 bg-[var(--bg-canvas)] select-none">
      <MapContainer
        center={vehicleCoords}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
      >
        <MapController
          selectedCoords={flyTarget}
          flyTrigger={flyTrigger}
          fitPoints={fitPointsTrigger}
          onMapReady={setMapInstance}
        />

        <TileLayer url={tileUrl} maxZoom={16} />

        {/* Subtle Geofence Accuracy Halo around Active Bus */}
        <CircleMarker
          center={vehicleCoords}
          radius={34}
          pathOptions={{
            color: '#0A84FF',
            weight: 1,
            opacity: 0.25,
            fillColor: '#0A84FF',
            fillOpacity: 0.07,
          }}
        />

        {/* Live Bus Telemetry Beacon */}
        <Marker
          position={vehicleCoords}
          icon={vehicleIcon}
          eventHandlers={{
            click: handleCenterOnBus,
          }}
        />

        {/* Interactive Incident Pins */}
        {gpsAlerts.map((alert, idx) => {
          const id = alert.id || alert._id || idx;
          const lat = Number(alert.gps.lat);
          const lon = Number(alert.gps.lon);
          const enriched = getEnrichedData(alert);
          const severity = enriched.incident_info?.severity || alert.severity || 'MEDIUM';
          const status = alert.status || 'NEW';
          const isSelected = selectedId !== null && selectedId === (alert.id || alert._id);

          const icon = createIncidentPin({ severity, status, isSelected });

          return (
            <Marker
              key={id}
              position={[lat, lon]}
              icon={icon}
              eventHandlers={{
                click: () => {
                  onSelectAlert?.(alert);
                },
              }}
            />
          );
        })}
      </MapContainer>

      {/* =================================================================
          TOP-CENTER / TOP-RIGHT FLOATING SPATIAL TELEMETRY BAR (Apple Maps HUD)
          ================================================================= */}
      <div
        className={`pointer-events-none absolute top-3.5 left-3 right-3 md:left-auto z-[999] flex flex-wrap items-center justify-end gap-2 transition-all duration-300 ${
          selectedAlert ? 'lg:right-[412px]' : 'md:right-4'
        }`}
      >
        {/* Active Vehicle Live GPS Telemetry Pill */}
        <div className="pointer-events-auto luxury-panel-glass h-9 px-3.5 rounded-full hidden sm:flex items-center gap-3 text-[11.5px]">
          <span className="inline-flex items-center gap-1.5 font-mono font-medium text-[var(--text-primary)]">
            <StatusDot variant={esp32Online ? 'live' : 'standby'} />
            <span>{selectedVehicle}</span>
          </span>

          <span className="h-3 w-px bg-[var(--border-hairline)]" />

          <span className="font-mono tabular-nums text-[var(--text-secondary)]">
            {activeCoords[0].toFixed(4)}° N, {activeCoords[1].toFixed(4)}° E
          </span>

          <span className="hidden xl:inline-block h-3 w-px bg-[var(--border-hairline)]" />

          <span className="hidden xl:inline-flex items-center gap-1.5 font-mono tabular-nums text-[var(--text-secondary)]">
            <Navigation size={11} strokeWidth={1.75} className="text-[#0A84FF]" />
            <span>{speedKmph} km/h</span>
            <span className="text-[var(--text-muted)]">·</span>
            <span>{hasLiveGpsFix ? `${satellites} Sats` : 'Standby Fix'}</span>
          </span>

          <span className="h-3 w-px bg-[var(--border-hairline)]" />

          <span className="font-mono tabular-nums text-[var(--text-muted)]">
            {gpsAlerts.length} {gpsAlerts.length === 1 ? 'Pin' : 'Pins'}
          </span>
        </div>

        {/* Quick Locate Bus Button */}
        <button
          type="button"
          onClick={handleCenterOnBus}
          title={`Center map on ${selectedVehicle}`}
          className="pointer-events-auto luxury-panel-glass h-9 px-3 rounded-full inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--text-primary)] hover:border-[var(--border-hover)] transition-colors cursor-pointer"
        >
          <LocateFixed size={13} strokeWidth={1.75} className="text-[#0A84FF]" />
          <span className="hidden sm:inline">Locate Bus</span>
        </button>

        {/* Open Coordinates in Google Maps */}
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open coordinates in Google Maps"
          className="pointer-events-auto luxury-panel-glass h-9 w-9 rounded-full inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] transition-colors"
        >
          <ExternalLink size={13} strokeWidth={1.75} />
        </a>
      </div>

      {/* =================================================================
          BOTTOM-RIGHT APPLE MAPS FLOATING CAMERA CONTROLS
          ================================================================= */}
      <div
        className={`pointer-events-none absolute bottom-4 right-3.5 z-[999] hidden md:flex flex-col gap-2 transition-all duration-300 ${
          selectedAlert ? 'lg:right-[412px]' : 'md:right-4'
        }`}
      >
        <div className="pointer-events-auto luxury-panel-glass rounded-2xl overflow-hidden flex flex-col divide-y divide-[var(--border-hairline)]">
          <button
            type="button"
            onClick={handleZoomIn}
            title="Zoom in"
            aria-label="Zoom in"
            className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <Plus size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            title="Zoom out"
            aria-label="Zoom out"
            className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <Minus size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={handleFitAll}
            title="Fit all pins"
            aria-label="Fit all pins"
            className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <Maximize2 size={13.5} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={handleCenterOnBus}
            title={`Recenter on ${selectedVehicle}`}
            aria-label="Recenter on vehicle"
            className="w-9 h-9 flex items-center justify-center text-[#0A84FF] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <Compass size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(IncidentMap);
