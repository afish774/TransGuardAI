// ==========================================
// ALERT INGESTION & HISTORY ROUTES
// ==========================================
const { Router } = require('express');
const rateLimit = require('express-rate-limit');

const logger = require('../utils/logger');
const log = logger.forComponent('Alerts');
const { verifyEdgeNode, verifyDashboardUser } = require('../middleware/auth');
const { validate, acknowledgeSchema } = require('../middleware/validate');
const Incident = require('../models/Incident');

/**
 * Create the alerts router.
 *
 * @param {Object} deps
 * @param {import('../services/IncidentQueue').IncidentIngestionQueue} deps.incidentQueue
 * @param {import('socket.io').Server} deps.io
 * @param {boolean} deps.getMonitoringEnabled - getter for the monitoring toggle
 * @param {multer.Multer} deps.evidenceUpload - configured multer instance
 * @param {string} deps.uploadsDir - absolute path to the evidence uploads directory
 */
function createAlertsRouter({ incidentQueue, io, getMonitoringEnabled, evidenceUpload, uploadsDir }) {
  const router = Router();
  const fs = require('fs').promises;
  const path = require('path');
  const { buildIncidentJob } = require('../services/IncidentQueue');
  const { sendTelegramApprovalAlert } = require('../utils/telegram');
  const { recordOperatorFeedback, getFeedbackStats } = require('../utils/feedbackCollector');

  // Active command buffer for vehicle edge nodes (e.g. ESP32 on BUS_001)
  const pendingVehicleCommands = new Map();
  // Live NEO-6M GPS telemetry cache reported by vehicle ESP32 units
  const liveVehicleGps = new Map();
  const LIVE_GPS_TTL_MS = 30 * 1000;

  const alertRateLimiter = rateLimit({
    windowMs: 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 15,
    message: 'Too many alerts received. Rate limited.',
  });

  // POST /api/alerts — Ingest an incident from an edge node
  router.post(
    '/',
    verifyEdgeNode,
    alertRateLimiter,
    evidenceUpload.single('evidence'),
    (req, res) => {
      if (!req.is('multipart/form-data')) {
        return res.status(415).json({ error: 'Use multipart/form-data with an optional evidence file field.' });
      }
      if (!getMonitoringEnabled()) {
        return res.status(403).json({ error: 'Monitoring is currently disabled.' });
      }
      try {
        const job = buildIncidentJob(req);
        // Enrich Edge AI incidents with live ESP32 NEO-6M GPS when a fresh fix (< 30s) is available
        const vehicleId = job.metadata?.vehicle_id || 'BUS_001';
        const liveFix = liveVehicleGps.get(vehicleId);
        if (liveFix && liveFix.hasFix && (Date.now() - liveFix.updatedAt) <= LIVE_GPS_TTL_MS) {
          job.gps = { lat: liveFix.lat, lon: liveFix.lon };
          job.metadata = {
            ...(job.metadata || {}),
            gps_source: 'ESP32_LIVE',
            vehicle_speed_kmph: liveFix.speed,
            gps_satellites: liveFix.satellites,
          };
        }
        if (!incidentQueue.enqueue(job)) {
          return res.status(503).json({ error: 'Incident queue is full. Retry shortly.' });
        }
        return res.status(202).json({ success: true, id: job.incidentId, status: 'QUEUED' });
      } catch (error) {
        return res.status(400).json({ error: error.message || 'Invalid incident payload.' });
      }
    },
  );

  // POST /api/alerts/sos — Lightweight trigger from wireless ESP32 SOS button
  router.post('/sos', async (req, res) => {
    try {
      const { lat, lon, speed, camera_id } = req.body;
      const cameraId = camera_id || 'cam0';
      const incidentId = crypto.randomUUID();
      const latitude = Number(lat) || 10.5898;
      const longitude = Number(lon) || 76.0116;

      const incident = new Incident({
        id: incidentId,
        node_id: 'ESP32-SOS-001',
        camera_id: cameraId,
        incident_type: 'DRIVER_SOS_PANIC',
        gps: {
          lat: latitude,
          lon: longitude,
        },
        confidence: 100,
        metadata: {
          trigger: 'PHYSICAL_PANIC_BUTTON',
          speed: Number(speed) || 0,
          vehicle_id: 'BUS_001',
        },
        timestamp: new Date(),
      });

      await incident.save();
      io.to('authenticated_dashboard').emit('new_alert', incident.toObject());
      log.info('🚨 Driver SOS Triggered from ESP32 at (%s, %s)', latitude, longitude);

      return res.status(201).json({ success: true, id: incidentId, status: 'PROCESSED' });
    } catch (err) {
      log.error('SOS Ingestion error: %s', err.message);
      return res.status(500).json({ error: 'Failed to process SOS trigger' });
    }
  });

  // GET /api/alerts/history — Paginated incident history with validation summary counts
  router.get('/history', verifyDashboardUser, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const skip = (page - 1) * limit;

      const filter = {};
      if (['NEW', 'REVIEWED', 'DISMISSED'].includes(req.query.status)) {
        filter.status = req.query.status;
      }

      const [recentAlerts, total, acceptedCount, rejectedCount, pendingCount] = await Promise.all([
        Incident.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit),
        Incident.countDocuments(filter),
        Incident.countDocuments({ status: 'REVIEWED' }),
        Incident.countDocuments({ status: 'DISMISSED' }),
        Incident.countDocuments({ $or: [{ status: 'NEW' }, { status: { $exists: false } }] }),
      ]);

      res.json({
        data: recentAlerts,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary: {
          total: acceptedCount + rejectedCount + pendingCount,
          accepted: acceptedCount,
          rejected: rejectedCount,
          pending: pendingCount,
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch incident history.' });
    }
  });

  // GET /api/alerts/export — Export validation log table as Excel (.xls) or CSV (.csv)
  router.get('/export', verifyDashboardUser, async (req, res) => {
    try {
      const filter = {};
      if (['NEW', 'REVIEWED', 'DISMISSED'].includes(req.query.status)) {
        filter.status = req.query.status;
      }
      const format = (req.query.format || 'csv').toLowerCase();
      const incidents = await Incident.find(filter).sort({ timestamp: -1 }).limit(2000).lean();

      const statusLabel = (s) => {
        if (s === 'REVIEWED') return 'VALIDATOR ACCEPTED';
        if (s === 'DISMISSED') return 'VALIDATOR REJECTED';
        return 'PENDING REVIEW';
      };

      const rows = incidents.map((inc, idx) => {
        const confRaw = Number(inc.confidence);
        const confPct = Number.isFinite(confRaw)
          ? (confRaw <= 1 ? Math.round(confRaw * 100) : Math.round(confRaw))
          : '';
        const gpsStr = (Number.isFinite(inc.gps?.lat) && Number.isFinite(inc.gps?.lon))
          ? `${inc.gps.lat.toFixed(6)}, ${inc.gps.lon.toFixed(6)}`
          : '';
        return {
          rowNum: idx + 1,
          id: inc.id || String(inc._id || ''),
          timestamp: inc.timestamp ? new Date(inc.timestamp).toISOString() : '',
          camera_id: inc.camera_id || '',
          vehicle_id: inc.metadata?.vehicle_id || 'BUS_001',
          incident_type: inc.incident_type || '',
          confidence_pct: confPct,
          validation_status: statusLabel(inc.status),
          raw_status: inc.status || 'NEW',
          reviewed_by: inc.reviewed_by || (inc.status && inc.status !== 'NEW' ? 'Operator' : ''),
          reviewed_at: inc.reviewed_at ? new Date(inc.reviewed_at).toISOString() : '',
          gps: gpsStr,
          evidence_url: inc.evidence_image_url || '',
        };
      });

      if (format === 'xls' || format === 'excel') {
        const escXml = (v) => String(v ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

        const acceptedTotal = rows.filter((r) => r.raw_status === 'REVIEWED').length;
        const rejectedTotal = rows.filter((r) => r.raw_status === 'DISMISSED').length;
        const pendingTotal = rows.filter((r) => r.raw_status !== 'REVIEWED' && r.raw_status !== 'DISMISSED').length;

        const htmlRows = rows.map((r) => {
          const bg = r.raw_status === 'REVIEWED'
            ? '#dcfce7'
            : r.raw_status === 'DISMISSED'
            ? '#ffe4e6'
            : '#fef3c7';
          const fg = r.raw_status === 'REVIEWED'
            ? '#166534'
            : r.raw_status === 'DISMISSED'
            ? '#9f1239'
            : '#92400e';
          return `<tr>
            <td>${r.rowNum}</td>
            <td>${escXml(r.id)}</td>
            <td>${escXml(r.timestamp)}</td>
            <td>${escXml(r.camera_id)}</td>
            <td>${escXml(r.vehicle_id)}</td>
            <td>${escXml(r.incident_type)}</td>
            <td>${r.confidence_pct !== '' ? `${r.confidence_pct}%` : '—'}</td>
            <td style="background-color:${bg};color:${fg};font-weight:bold;">${escXml(r.validation_status)}</td>
            <td>${escXml(r.reviewed_by || '—')}</td>
            <td>${escXml(r.reviewed_at || '—')}</td>
            <td>${escXml(r.gps || '—')}</td>
            <td>${escXml(r.evidence_url || '—')}</td>
          </tr>`;
        }).join('\n');

        const xlsHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Validator Alert Log</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
<body>
  <table border="1" cellspacing="0" cellpadding="4">
    <thead>
      <tr style="background-color:#1e1b4b;color:#ffffff;font-weight:bold;">
        <th colspan="12" style="font-size:14pt;text-align:left;">TRANSGUARD AI — VALIDATOR ACCEPTED &amp; REJECTED ALERTS LOG</th>
      </tr>
      <tr style="background-color:#f3f4f6;font-weight:bold;">
        <td colspan="3">Total Alerts: ${rows.length}</td>
        <td colspan="3" style="background-color:#dcfce7;color:#166534;">Validator Accepted: ${acceptedTotal}</td>
        <td colspan="3" style="background-color:#ffe4e6;color:#9f1239;">Validator Rejected: ${rejectedTotal}</td>
        <td colspan="3" style="background-color:#fef3c7;color:#92400e;">Pending Review: ${pendingTotal}</td>
      </tr>
      <tr style="background-color:#312e81;color:#ffffff;font-weight:bold;">
        <th>#</th>
        <th>Alert ID</th>
        <th>Detected Timestamp</th>
        <th>Camera ID</th>
        <th>Vehicle ID</th>
        <th>Incident Type</th>
        <th>AI Confidence</th>
        <th>Validator Decision</th>
        <th>Validated By</th>
        <th>Validated Timestamp</th>
        <th>GPS Coordinates</th>
        <th>Evidence Image Path</th>
      </tr>
    </thead>
    <tbody>
      ${htmlRows}
    </tbody>
  </table>
</body></html>`;

        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="transguard_validator_alert_log.xls"');
        return res.status(200).send(xlsHtml);
      }

      const escCsv = (val) => {
        const str = String(val ?? '');
        const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
        if (/[",\n\r]/.test(safe)) {
          return `"${safe.replace(/"/g, '""')}"`;
        }
        return safe;
      };

      const headers = [
        'Row #',
        'Alert ID',
        'Detected Timestamp',
        'Camera ID',
        'Vehicle ID',
        'Incident Type',
        'AI Confidence (%)',
        'Validator Decision',
        'Validated By',
        'Validated Timestamp',
        'GPS Coordinates',
        'Evidence Image Path',
      ];
      const csvLines = [
        headers.join(','),
        ...rows.map((r) => [
          r.rowNum,
          r.id,
          r.timestamp,
          r.camera_id,
          r.vehicle_id,
          r.incident_type,
          r.confidence_pct,
          r.validation_status,
          r.reviewed_by,
          r.reviewed_at,
          r.gps,
          r.evidence_url,
        ].map(escCsv).join(',')),
      ];

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="transguard_validator_alert_log.csv"');
      return res.status(200).send('\uFEFF' + csvLines.join('\r\n'));
    } catch (error) {
      log.error('Export alerts error: %s', error.message);
      return res.status(500).json({ error: 'Failed to export validation log.' });
    }
  });

  // PATCH /api/alerts/:id/acknowledge — Mark incident as REVIEWED/DISMISSED
  router.patch('/:id/acknowledge', verifyDashboardUser, validate(acknowledgeSchema), async (req, res) => {
    try {
      const mongoose = require('mongoose');
      const query = mongoose.Types.ObjectId.isValid(req.params.id)
        ? { $or: [{ id: req.params.id }, { _id: req.params.id }] }
        : { id: req.params.id };

      const nextStatus = req.body.status || 'REVIEWED';
      const reviewedBy = req.user?.username || 'Operator';
      const reviewedAt = new Date();

      const incident = await Incident.findOneAndUpdate(
        query,
        {
          status: nextStatus,
          reviewed_by: reviewedBy,
          reviewed_at: reviewedAt,
        },
        { returnDocument: 'after' }
      );
      if (!incident) {
        return res.status(404).json({ error: 'Incident not found.' });
      }
      io.to('authenticated_dashboard').emit('alert_updated', incident.toObject());
      log.info('Incident %s acknowledged as %s by %s', req.params.id, nextStatus, reviewedBy);

      // Archive human-in-the-loop feedback (REVIEWED => true_positives, DISMISSED => false_positives)
      // so every false alarm becomes hard-negative fine-tuning data.
      recordOperatorFeedback(
        incident.toObject(),
        nextStatus,
        reviewedBy,
        uploadsDir,
      );

      // When incident is approved/reviewed by operator:
      // 1. Queue buzzer alarm for ESP32 on the vehicle
      // 2. Dispatch real-time Telegram alert
      if (nextStatus === 'REVIEWED') {
        const vehicleId = incident.metadata?.vehicle_id || 'BUS_001';
        pendingVehicleCommands.set(vehicleId, {
          trigger_alarm: true,
          reason: 'DISPATCH_APPROVED',
          incident_id: incident.id || incident._id,
          incident_type: incident.incident_type,
          timestamp: Date.now(),
        });
        log.info('Queued vehicle alarm for %s (Incident: %s)', vehicleId, incident.incident_type);

        // Send Telegram Notification with Evidence Photo
        sendTelegramApprovalAlert(incident.toObject(), reviewedBy, uploadsDir);
      }

      return res.json(incident);
    } catch (error) {
      log.error('Acknowledge error: %s', error.message);
      return res.status(500).json({ error: 'Failed to update incident.' });
    }
  });

  // GET /api/alerts/feedback/stats — Real-world precision stats from operator reviews
  router.get('/feedback/stats', verifyDashboardUser, async (_req, res) => {
    try {
      const stats = await getFeedbackStats(uploadsDir);
      return res.json(stats);
    } catch (error) {
      log.error('Feedback stats error: %s', error.message);
      return res.status(500).json({ error: 'Failed to compute feedback statistics.' });
    }
  });

  // GET /api/alerts/telemetry/:vehicleId — Inspect live ESP32 GPS & hardware telemetry for a vehicle
  router.get('/telemetry/:vehicleId', verifyDashboardUser, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const vehicleId = req.params.vehicleId || 'BUS_001';
    const fix = liveVehicleGps.get(vehicleId);
    const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
    if (!fix) {
      return res.json({
        vehicle_id: vehicleId,
        online: false,
        has_fix: false,
        telegram_configured: telegramConfigured,
      });
    }
    const ageMs = Date.now() - fix.updatedAt;
    const isOnline = ageMs <= LIVE_GPS_TTL_MS;
    return res.json({
      vehicle_id: vehicleId,
      online: isOnline,
      has_fix: Boolean(fix.hasFix) && isOnline,
      lat: fix.lat ?? null,
      lon: fix.lon ?? null,
      speed_kmph: fix.speed ?? 0,
      satellites: fix.satellites ?? 0,
      ip: fix.ip || null,
      wifi_rssi: fix.wifiRssi ?? null,
      age_ms: ageMs,
      telegram_configured: telegramConfigured,
    });
  });

  // POST /api/alerts/command — Trigger ESP32 5-second buzzer siren directly from Mission Control
  router.post('/command', verifyDashboardUser, (req, res) => {
    const vehicleId = req.query.vehicle_id || req.body?.vehicle_id || 'BUS_001';
    const reason = req.body?.reason || 'DISPATCH_SIREN_TRIGGERED';
    const incidentId = req.body?.incident_id || null;
    const incidentType = req.body?.incident_type || 'MANUAL_DISPATCH';

    pendingVehicleCommands.set(vehicleId, {
      trigger_alarm: true,
      reason,
      incident_id: incidentId,
      incident_type: incidentType,
      triggered_by: req.user?.username || 'Operator',
      timestamp: Date.now(),
    });

    log.info('Queued direct vehicle siren alarm for %s by %s', vehicleId, req.user?.username || 'Operator');
    return res.status(200).json({
      success: true,
      vehicle_id: vehicleId,
      trigger_alarm: true,
      duration_seconds: 5,
      reason,
      timestamp: Date.now(),
    });
  });

  // GET /api/alerts/command — Polled by ESP32 to receive dispatch commands & report live GPS
  router.get('/command', (req, res) => {
    const vehicleId = req.query.vehicle_id || 'BUS_001';
    const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '';
    const cleanIp = String(rawIp).split(',')[0].trim().replace(/^::ffff:/, '') || null;
    const wifiRssi = req.query.rssi !== undefined ? parseInt(req.query.rssi, 10) : null;

    // Capture live NEO-6M GPS piggybacked by the ESP32 poll (and always refresh online heartbeat)
    const prevFix = liveVehicleGps.get(vehicleId) || {};
    if (req.query.lat !== undefined && req.query.lon !== undefined) {
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      const speed = Number(req.query.speed) || 0;
      const satellites = parseInt(req.query.sats, 10) || 0;
      const hasFix = req.query.gps_fix === '1' || req.query.gps_fix === 'true';
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        liveVehicleGps.set(vehicleId, {
          lat: Number(lat.toFixed(6)),
          lon: Number(lon.toFixed(6)),
          speed: Number(speed.toFixed(1)),
          satellites,
          hasFix,
          ip: cleanIp || prevFix.ip || null,
          wifiRssi: Number.isFinite(wifiRssi) ? wifiRssi : prevFix.wifiRssi ?? null,
          updatedAt: Date.now(),
        });
      }
    } else {
      liveVehicleGps.set(vehicleId, {
        ...prevFix,
        hasFix: Boolean(prevFix.hasFix),
        ip: cleanIp || prevFix.ip || null,
        wifiRssi: Number.isFinite(wifiRssi) ? wifiRssi : prevFix.wifiRssi ?? null,
        updatedAt: Date.now(),
      });
    }

    const latestFix = liveVehicleGps.get(vehicleId);
    if (latestFix) {
      io.to('authenticated_dashboard').emit('vehicle_telemetry', {
        vehicle_id: vehicleId,
        online: true,
        has_fix: Boolean(latestFix.hasFix),
        lat: latestFix.lat ?? null,
        lon: latestFix.lon ?? null,
        speed_kmph: latestFix.speed ?? 0,
        satellites: latestFix.satellites ?? 0,
        ip: latestFix.ip || null,
        wifi_rssi: latestFix.wifiRssi ?? null,
        age_ms: 0,
        telegram_configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      });
    }

    const cmd = pendingVehicleCommands.get(vehicleId);
    if (cmd && cmd.trigger_alarm) {
      // Clear pending command so buzzer sounds only once per approval
      pendingVehicleCommands.delete(vehicleId);
      log.info('Delivered dispatch alarm command to vehicle %s', vehicleId);
      return res.json({
        trigger_alarm: true,
        incident_id: cmd.incident_id,
        incident_type: cmd.incident_type,
        reason: cmd.reason,
        timestamp: cmd.timestamp,
      });
    }
    return res.json({ trigger_alarm: false });
  });

  // DELETE /api/alerts/:id — Permanently remove an incident
  router.delete('/:id', verifyDashboardUser, async (req, res) => {
    try {
      const mongoose = require('mongoose');
      const query = mongoose.Types.ObjectId.isValid(req.params.id)
        ? { $or: [{ id: req.params.id }, { _id: req.params.id }] }
        : { id: req.params.id };

      const incident = await Incident.findOne(query);
      if (!incident) {
        return res.status(404).json({ error: 'Incident not found.' });
      }

      // Clean up local evidence file if it exists
      if (incident.evidence_image_url && incident.evidence_image_url.startsWith('/uploads/evidence/')) {
        const filename = path.basename(incident.evidence_image_url);
        const filePath = path.join(uploadsDir, filename);
        fs.unlink(filePath).catch((err) => {
          log.debug('Evidence cleanup note: %s', err.message);
        });
      }

      await Incident.deleteOne({ _id: incident._id });

      io.to('authenticated_dashboard').emit('alert_deleted', {
        id: incident.id,
        _id: incident._id,
      });

      log.info('Incident %s deleted by %s', incident.id, req.user.username);
      return res.json({
        success: true,
        id: incident.id,
        message: 'Incident deleted successfully.',
      });
    } catch (error) {
      log.error('Delete alert error: %s', error.message);
      return res.status(500).json({ error: 'Failed to delete incident.' });
    }
  });

  return router;
}

module.exports = createAlertsRouter;
