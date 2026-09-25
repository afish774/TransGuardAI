// ==========================================
// CONTROL & ZONE ROUTES
// ==========================================
const { Router } = require('express');

const logger = require('../utils/logger');
const log = logger.forComponent('Control');
const { verifyDashboardUser, verifyEdgeNode } = require('../middleware/auth');
const { validate, zoneSchema } = require('../middleware/validate');
const Zone = require('../models/Zone');

/**
 * Create the control/zone router.
 *
 * @param {Object} deps
 * @param {import('socket.io').Server} deps.io
 * @param {Function} deps.getMonitoringEnabled - getter
 * @param {Function} deps.setMonitoringEnabled - setter
 */
function createControlRouter({ io, getMonitoringEnabled, setMonitoringEnabled }) {
  const router = Router();

  // GET /api/control/status — Get monitoring enabled/disabled state (dashboard user)
  router.get('/status', verifyDashboardUser, (req, res) => {
    res.json({ monitoring_enabled: getMonitoringEnabled() });
  });

  // GET /api/control/edge-status — Get monitoring enabled/disabled state (edge node)
  router.get('/edge-status', verifyEdgeNode, (req, res) => {
    res.json({ monitoring_enabled: getMonitoringEnabled() });
  });

  // POST /api/control/toggle — Toggle monitoring on/off
  router.post('/toggle', verifyDashboardUser, (req, res) => {
    const newState = !getMonitoringEnabled();
    setMonitoringEnabled(newState);
    io.to('authenticated_dashboard').emit('control_status', { monitoring_enabled: newState });
    log.info('Monitoring toggled to %s by %s', newState, req.user.username);
    res.json({ monitoring_enabled: newState });
  });

  // POST /api/edge/zone — Set geofence polygon for a camera (persisted to MongoDB)
  router.post('/zone', verifyDashboardUser, validate(zoneSchema), async (req, res) => {
    const { camera_id: cameraId, polygon } = req.body;
    try {
      await Zone.findOneAndUpdate(
        { camera_id: cameraId },
        { camera_id: cameraId, polygon, updated_at: new Date() },
        { upsert: true, returnDocument: 'after' },
      );
      return res.json({ success: true, camera_id: cameraId, polygon });
    } catch (error) {
      log.error('Zone save error: %s', error.message);
      return res.status(500).json({ error: 'Failed to save zone.' });
    }
  });

  // GET /api/edge/zone/:camera_id — Get zone polygon
  router.get('/zone/:camera_id', verifyEdgeNode, async (req, res) => {
    try {
      const zone = await Zone.findOne({ camera_id: req.params.camera_id });
      res.json({ camera_id: req.params.camera_id, polygon: zone?.polygon || [] });
    } catch (error) {
      log.error('Zone fetch error: %s', error.message);
      res.status(500).json({ error: 'Failed to fetch zone.' });
    }
  });

  return router;
}

module.exports = createControlRouter;
