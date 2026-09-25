import React, { memo, useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's default icon path in bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function createPulsingMarker(severity = 'MEDIUM') {
  const bg = severity === 'CRITICAL' ? '#ef4444' : severity === 'HIGH' ? '#f97316' : '#6366f1';
  return L.divIcon({
    className: 'custom-map-pin',
    html: `
      <div style="position: relative; width: 24px; height: 24px;">
        <span style="position: absolute; inset: 0; border-radius: 9999px; background-color: ${bg}; opacity: 0.75; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>
        <span style="position: relative; display: flex; width: 24px; height: 24px; border-radius: 9999px; background-color: ${bg}; border: 2.5px solid white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.4); align-items: center; justify-content: center;"></span>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

function IncidentMap({ alerts = [], isDarkMode = true }) {
  // Enterprise-grade Esri Canvas tiles: fast, reliable, zero watermarks, perfect for surveillance ops
  const tileUrl = isDarkMode
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';

  // Default coordinate (transit center)
  const defaultCenter = [10.5898, 76.0116];

  // Find first alert with valid GPS to focus on
  const activeGpsAlert = alerts.find((a) => a.gps && Number.isFinite(a.gps.lat) && Number.isFinite(a.gps.lon));
  const center = activeGpsAlert ? [activeGpsAlert.gps.lat, activeGpsAlert.gps.lon] : defaultCenter;

  return (
    <div className="absolute inset-0 z-0 bg-gray-100 dark:bg-zinc-950">
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%', minHeight: '400px' }}
        zoomControl={false}
      >
        <MapResizer />
        <ZoomControl position="bottomright" />
        <TileLayer
          url={tileUrl}
          attribution='Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
          maxZoom={16}
        />
        {alerts.map((alert, idx) => {
          const { lat, lon } = alert.gps || {};
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          const severity = alert.metadata?.severity || alert.severity || 'MEDIUM';
          const icon = createPulsingMarker(severity);

          return (
            <Marker key={alert.id || alert._id || idx} position={[lat, lon]} icon={icon}>
              <Popup>
                <div style={{ padding: '4px 2px', minWidth: '160px' }}>
                  <strong style={{ fontSize: '13px', color: '#111827' }}>
                    {(alert.incident_type || 'Unknown incident').replace(/_/g, ' ')}
                  </strong>
                  <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                    <strong>Camera:</strong> {alert.camera_id || 'cam0'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                    <strong>Time:</strong> {alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString() : 'Recent'}
                  </div>
                  {alert.confidence != null && (
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                      <strong>Confidence:</strong> {alert.confidence}%
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

export default memo(IncidentMap);
