// ==========================================
// CAMERA OFFLINE DETECTION SERVICE
// ==========================================
const EdgeNode = require('../models/EdgeNode');
const logger = require('../utils/logger');
const log = logger.forComponent('OfflineDetector');

const CAMERA_STALE_THRESHOLD_MS = 30000;

/**
 * Start a periodic check that marks cameras as OFFLINE
 * when their heartbeat becomes stale (> 30 seconds).
 *
 * @param {import('socket.io').Server} io - Socket.IO server instance
 * @returns {NodeJS.Timer} interval handle (call clearInterval to stop)
 */
function startOfflineDetector(io) {
  const interval = setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - CAMERA_STALE_THRESHOLD_MS);
      const nodes = await EdgeNode.find({ status: 'ACTIVE', 'cameras.0': { $exists: true } });
      for (const node of nodes) {
        let changed = false;
        for (const camera of node.cameras) {
          if (camera.status === 'ONLINE' && (!camera.last_heartbeat || camera.last_heartbeat < cutoff)) {
            camera.status = 'OFFLINE';
            camera.fps = 0;
            changed = true;
            log.info('Marked %s on %s as OFFLINE (stale heartbeat)', camera.camera_id, node.node_id);
            io.to('authenticated_dashboard').emit('camera_status', {
              camera_id: camera.camera_id,
              node_id: node.node_id,
              status: 'OFFLINE',
              fps: 0,
              last_heartbeat: camera.last_heartbeat,
            });
          }
        }
        if (changed) {
          await node.save();
        }
      }
    } catch (error) {
      log.error('Offline detection error: %s', error.message);
    }
  }, CAMERA_STALE_THRESHOLD_MS);

  if (interval.unref) interval.unref();
  return interval;
}

module.exports = { startOfflineDetector, CAMERA_STALE_THRESHOLD_MS };
