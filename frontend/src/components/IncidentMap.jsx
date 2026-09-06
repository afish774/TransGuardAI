import { memo } from 'react';
import { MapContainer, Marker, Popup, TileLayer, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function IncidentMap({ alerts, isDarkMode }) {
  const baseMap = isDarkMode ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base';
  const referenceMap = isDarkMode ? 'World_Dark_Gray_Reference' : 'World_Light_Gray_Reference';

  return (
    <div className="absolute inset-0 z-0 bg-[#e5e5e5] dark:bg-zinc-950">
      <MapContainer center={[10.5898, 76.0116]} zoom={12} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <ZoomControl position="bottomright" />
        <TileLayer url={`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${baseMap}/MapServer/tile/{z}/{y}/{x}`} attribution="Tiles &copy; Esri" />
        <TileLayer url={`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${referenceMap}/MapServer/tile/{z}/{y}/{x}`} />
        {alerts.map((alert, idx) => {
          const { lat, lon } = alert.gps || {};
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          return <Marker key={alert.id || alert._id || idx} position={[lat, lon]}><Popup><strong>{(alert.incident_type || 'Unknown alarm').replace(/_/g, ' ')}</strong><br />Cam: {alert.camera_id || 'Unknown'}<br />{alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString() : 'Time unavailable'}</Popup></Marker>;
        })}
      </MapContainer>
    </div>
  );
}

export default memo(IncidentMap);
