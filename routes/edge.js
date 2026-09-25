// ==========================================
// EDGE NODE ROUTES
// ==========================================
const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const { spawn } = require('child_process');

const logger = require('../utils/logger');
const log = logger.forComponent('Edge');
const { verifyEdgeNode, verifyDashboardUser } = require('../middleware/auth');
const { validate, heartbeatSchema, provisionSchema } = require('../middleware/validate');
const EdgeNode = require('../models/EdgeNode');

/**
 * Create the edge node router.
 *
 * @param {Object} deps
 * @param {import('socket.io').Server} deps.io
 * @param {Map} deps.activeEdgeNodes - map of camera_id → spawned process
 * @param {Function} deps.getMonitoringEnabled - getter for monitoring state
 */
function createEdgeRouter({ io, activeEdgeNodes, getMonitoringEnabled }) {
  const router = Router();

  // POST /api/edge/heartbeat — Camera heartbeat with FPS/status
  router.post('/heartbeat', verifyEdgeNode, validate(heartbeatSchema), async (req, res) => {
    try {
      const { camera_id: cameraId, status, fps } = req.body;
      const node = req.edgeNode;

      const now = new Date();
      const cameraStatus = status || 'ONLINE';
      const cameraFps = Number(fps) || 0;
      const updateResult = await EdgeNode.updateOne(
        { _id: node._id, 'cameras.camera_id': cameraId },
        {
          $set: {
            'cameras.$.status': cameraStatus,
            'cameras.$.fps': cameraFps,
            'cameras.$.last_heartbeat': now,
            last_heartbeat: now,
          },
        },
      );

      if (updateResult.matchedCount === 0) {
        await EdgeNode.updateOne(
          { _id: node._id, 'cameras.camera_id': { $ne: cameraId } },
          {
            $push: {
              cameras: {
                camera_id: cameraId,
                status: cameraStatus,
                fps: cameraFps,
                last_heartbeat: now,
              },
            },
            $set: { last_heartbeat: now },
          },
        );
      }

      io.to('authenticated_dashboard').emit('camera_status', {
        camera_id: cameraId,
        node_id: node.node_id,
        status: cameraStatus,
        fps: cameraFps,
        last_heartbeat: now,
      });
      return res.json({ success: true });
    } catch (error) {
      log.error('Heartbeat error: %s', error.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // GET /api/edge/cameras — List all active cameras
  router.get('/cameras', verifyDashboardUser, async (req, res) => {
    try {
      const nodes = await EdgeNode.find({ status: 'ACTIVE' });
      const cameras = [];
      for (const node of nodes) {
        for (const camera of node.cameras || []) {
          cameras.push({
            camera_id: camera.camera_id,
            node_id: node.node_id,
            node_label: node.label,
            status: camera.status,
            fps: camera.fps,
            last_heartbeat: camera.last_heartbeat,
          });
        }
      }
      res.json(cameras);
    } catch (error) {
      log.error('Camera list error: %s', error.message);
      res.status(500).json({ error: 'Failed to fetch camera list.' });
    }
  });

  // GET /api/control/edge-status — Get monitoring state (for edge nodes)
  router.get('/control/edge-status', verifyEdgeNode, (req, res) => {
    res.json({ monitoring_enabled: getMonitoringEnabled() });
  });

  // POST /api/edge/provision — Spawn a Python engine for a camera
  router.post('/provision', verifyDashboardUser, validate(provisionSchema), (req, res) => {
    const { camera_id: cameraId, rtsp_url: rtspUrl } = req.body;

    if (activeEdgeNodes.has(cameraId)) {
      return res.status(409).json({ error: 'A Python engine is already running for this camera.' });
    }

    try {
      const rootDir = path.join(__dirname, '..');
      const venvPyWin = path.join(rootDir, 'transguard-env', 'Scripts', 'python.exe');
      const venvPyUnix = path.join(rootDir, 'transguard-env', 'bin', 'python');
      let pythonBin = process.env.PYTHON_PATH;
      if (!pythonBin) {
        if (fs.existsSync(venvPyWin)) pythonBin = venvPyWin;
        else if (fs.existsSync(venvPyUnix)) pythonBin = venvPyUnix;
        else pythonBin = 'python';
      }

      const pythonArgs = ['trans_guard_engine.py', '--camera', cameraId, '--url', rtspUrl, '--headless'];
      log.info('Spawning Python engine for %s with %s', cameraId, pythonBin);
      const pythonProcess = spawn(pythonBin, pythonArgs, {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      activeEdgeNodes.set(cameraId, pythonProcess);

      const engineLog = logger.forComponent(`Engine:${cameraId}`);
      pythonProcess.stdout.on('data', (data) => engineLog.info(data.toString().trim()));
      pythonProcess.stderr.on('data', (data) => engineLog.error(data.toString().trim()));
      pythonProcess.on('error', (error) => engineLog.error('Process error: %s', error.message));
      pythonProcess.on('close', (code) => {
        engineLog.info('Process exited with code %d', code);
        activeEdgeNodes.delete(cameraId);
      });
      return res.json({ success: true, pid: pythonProcess.pid, message: `Provisioning started for ${cameraId}` });
    } catch (error) {
      log.error('Provisioning error: %s', error.message);
      return res.status(500).json({ error: 'Failed to provision camera node.' });
    }
  });

  return router;
}

module.exports = createEdgeRouter;
