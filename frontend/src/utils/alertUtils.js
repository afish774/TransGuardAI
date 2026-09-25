export const getEnrichedData = (alert) => {
  if (!alert) return null;

  const possibleIncidents = {
    'PASSENGER_FALL': { severity: 'CRITICAL', label: 'PASSENGER FALL' },
    'UNATTENDED_BAGGAGE': { severity: 'HIGH', label: 'UNATTENDED BAGGAGE' },
    'CONGESTION': { severity: 'MEDIUM', label: 'CONGESTION' },
    'WATCHLIST_MATCH': { severity: 'CRITICAL', label: 'WATCHLIST MATCH' },
    'FALL_DETECTED': { severity: 'CRITICAL', label: 'FALL DETECTED' },
    'CRIME_WEAPON_DETECTED': { severity: 'CRITICAL', label: 'WEAPON DETECTED' },
    'CRIME_VIOLENCE_DETECTED': { severity: 'CRITICAL', label: 'VIOLENCE DETECTED' },
    'ARMED_VIOLENCE': { severity: 'CRITICAL', label: 'ARMED VIOLENCE (P1)' },
    'VIOLENT_ASSAULT_COLLAPSE': { severity: 'CRITICAL', label: 'ASSAULT & COLLAPSE (P2)' },
    'OVERCROWD_DETECTED': { severity: 'HIGH', label: 'OVERCROWDING' }
  };

  const incidentObj = possibleIncidents[alert.incident_type] || {
    severity: 'HIGH',
    label: (alert.incident_type || 'UNKNOWN ALARM').replace(/_/g, ' ')
  };

  // Map 6 surveillance pillars
  let pillar = 'ANOMALY';
  if (['FALL_DETECTED', 'PASSENGER_FALL'].includes(alert.incident_type)) pillar = 'FALL';
  else if (['OVERCROWD_DETECTED', 'CONGESTION'].includes(alert.incident_type)) pillar = 'OVERCROWDING';
  else if (alert.incident_type === 'UNATTENDED_BAGGAGE') pillar = 'LOST & FOUND';
  else if (alert.incident_type === 'WATCHLIST_MATCH') pillar = 'FACE MATCH';
  else if (['CRIME_WEAPON_DETECTED', 'CRIME_VIOLENCE_DETECTED', 'ARMED_VIOLENCE', 'VIOLENT_ASSAULT_COLLAPSE'].includes(alert.incident_type)) pillar = 'SECURITY THREAT';

  // The edge contract reports confidence on a 0-100 scale, not a probability.
  const confidence = getConfidence(alert);
  const severity = ['CRITICAL', 'HIGH', 'MEDIUM', 'REVIEW'].includes(alert.severity)
    ? alert.severity : incidentObj.severity;
  return {
    ...alert,
    camera_id: alert.camera_id || 'Unknown camera',
    pillar,
    confidence: confidence === null ? null : confidence.toFixed(1),
    metadata: alert.metadata || {},
    incident_info: { ...incidentObj, severity }
  };
};

export const getConfidence = (alert) => {
  const value = alert?.metadata?.confidence ?? alert?.confidence;
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
};

export const getAlertId = (alert) => alert?.id ?? alert?._id
  ?? `${alert?.camera_id}:${alert?.incident_type}:${alert?.timestamp}`;

export const formatTimestamp = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export const getEvidenceSrc = (alert, baseUrl) => {
  const source = alert?.evidence_url || alert?.evidence_image_url;
  if (source) {
    try {
      const url = new URL(source, `${baseUrl.replace(/\/$/, '')}/`);
      if (['http:', 'https:'].includes(url.protocol)) return url.href;
    } catch {
      // Fall back to the embedded snapshot if the evidence URL is malformed.
    }
  }
  return alert?.evidence_image_base64
    ? `data:image/jpeg;base64,${alert.evidence_image_base64}` : null;
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
