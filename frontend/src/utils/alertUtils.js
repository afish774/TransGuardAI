export const getEnrichedData = (alert) => {
  if (!alert) return null;

  const possibleIncidents = {
    'PASSENGER_FALL': { severity: 'CRITICAL', label: 'PASSENGER FALL' },
    'SPEED_LIMIT_EXCEEDED': { severity: 'HIGH', label: 'SPEED LIMIT EXCEEDED' },
    'UNATTENDED_BAG': { severity: 'HIGH', label: 'UNATTENDED BAG' },
    'UNATTENDED_BAGGAGE': { severity: 'HIGH', label: 'UNATTENDED BAGGAGE' },
    'CONGESTION': { severity: 'MEDIUM', label: 'CONGESTION' },
    'RESTRICTED_ZONE_INTRUSION': { severity: 'REVIEW', label: 'RESTRICTED ZONE INTRUSION' },
    'ZONE_INTRUSION': { severity: 'REVIEW', label: 'ZONE INTRUSION' },
    'WATCHLIST_MATCH': { severity: 'CRITICAL', label: 'WATCHLIST MATCH' }
  };

  const incidentObj = possibleIncidents[alert.incident_type] || { severity: 'HIGH', label: (alert.incident_type || 'UNKNOWN ALARM').replace(/_/g, ' ') };

  return {
    ...alert,
    bus_cam_id: alert.camera_id || 'Unknown Camera',
    driver: 'Unknown Driver',
    speed: alert.speed || '--',
    passengers: alert.passengers || '--',
    delay: null,
    incident_info: incidentObj
  };
};

export const getSeverityStyles = (severity) => {
  switch (severity) {
    case 'CRITICAL': return { text: 'text-red-600 dark:text-red-400', icon: 'text-red-500', bar: 'bg-red-500', dot: 'bg-red-500' };
    case 'HIGH': return { text: 'text-orange-600 dark:text-orange-400', icon: 'text-orange-500', bar: 'bg-orange-400', dot: 'bg-orange-500' };
    case 'MEDIUM': return { text: 'text-yellow-600 dark:text-yellow-400', icon: 'text-yellow-500', bar: 'bg-yellow-400', dot: 'bg-yellow-500' };
    case 'REVIEW': return { text: 'text-purple-600 dark:text-purple-400', icon: 'text-purple-500', bar: 'bg-purple-400', dot: 'bg-purple-500' };
    default: return { text: 'text-gray-600 dark:text-zinc-300', icon: 'text-gray-500 dark:text-zinc-400', bar: 'bg-gray-400', dot: 'bg-gray-400' };
  }
};
