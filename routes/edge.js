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
 * Derive a clean 1:1 default bus ID from a camera ID when no explicit vehicle_id is provided.
 * e.g. CAM_01 / cam0 / cam1 -> BUS_001, CAM_02 -> BUS_002.
 */
function deriveDefaultVehicleId(cameraId) {
  const match = String(cameraId || '').match(/(\d+)$/);
  if (!match) return 'BUS_001';
  const num = parseInt(match[1], 10);
  if (!Number.isFinite(num) || num <= 1) return 'BUS_001';
  return `BUS_${String(num).padStart(3, '0')}`;
}

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
  // In-memory assignment map so freshly provisioned cameras keep their bus binding on first heartbeat
  const cameraBusBindings = new Map();

  // POST /api/edge/heartbeat — Camera heartbeat with FPS/status/bus binding
  router.post('/heartbeat', verifyEdgeNode, validate(heartbeatSchema), async (req, res) => {
    try {
      const {
        camera_id: cameraId,
        status,
        fps,
        vehicle_id: reqVehicleId,
        camera_position: reqCameraPos,
      } = req.body;
      const node = req.edgeNode;

      const existingCam = (node.cameras || []).find((c) => c.camera_id === cameraId);
      const cachedBinding = cameraBusBindings.get(cameraId);
      const resolvedVehicleId =
        reqVehicleId ||
        existingCam?.vehicle_id ||
        cachedBinding?.vehicle_id ||
        deriveDefaultVehicleId(cameraId);
      const resolvedPosition =
        reqCameraPos !== undefined
          ? reqCameraPos
          : existingCam?.camera_position || cachedBinding?.camera_position || '';

      const now = new Date();
      const cameraStatus = status || 'ONLINE';
      const cameraFps = Number(fps) || 0;
      const updateResult = await EdgeNode.updateOne(
        { _id: node._id, 'cameras.camera_id': cameraId },
        {
          $set: {
            'cameras.$.status': cameraStatus,
            'cameras.$.fps': cameraFps,
            'cameras.$.vehicle_id': resolvedVehicleId,
            'cameras.$.camera_position': resolvedPosition,
            'cameras.$.last_heartbeat': now,
            last_heartbeat: now,
          },
        }
      );

      if (updateResult.matchedCount === 0) {
        await EdgeNode.updateOne(
          { _id: node._id, 'cameras.camera_id': { $ne: cameraId } },
          {
            $push: {
              cameras: {
                camera_id: cameraId,
                vehicle_id: resolvedVehicleId,
                camera_position: resolvedPosition,
                status: cameraStatus,
                fps: cameraFps,
                last_heartbeat: now,
              },
            },
            $set: { last_heartbeat: now },
          }
        );
      }

      io.to('authenticated_dashboard').emit('camera_status', {
        camera_id: cameraId,
        vehicle_id: resolvedVehicleId,
        camera_position: resolvedPosition,
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

  // GET /api/edge/cameras — List all active cameras with their assigned vehicle/bus ID
  router.get('/cameras', verifyDashboardUser, async (_req, res) => {
    try {
      const nodes = await EdgeNode.find({ status: 'ACTIVE' });
      const cameras = [];
      for (const node of nodes) {
        for (const camera of node.cameras || []) {
          const cached = cameraBusBindings.get(camera.camera_id);
          cameras.push({
            camera_id: camera.camera_id,
            vehicle_id:
              camera.vehicle_id ||
              cached?.vehicle_id ||
              deriveDefaultVehicleId(camera.camera_id),
            camera_position: camera.camera_position || cached?.camera_position || '',
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

  // PATCH /api/edge/cameras/:cameraId/vehicle — Bind or move a camera onto a specific bus
  router.patch('/cameras/:cameraId/vehicle', verifyDashboardUser, async (req, res) => {
    try {
      const cameraId = req.params.cameraId;
      const vehicleId = String(req.body?.vehicle_id || '').trim();
      const cameraPosition = String(req.body?.camera_position || '').trim();
      if (!vehicleId || !/^[A-Za-z0-9_-]{1,64}$/.test(vehicleId)) {
        return res.status(400).json({ error: 'Valid vehicle_id is required (e.g. BUS_001).' });
      }

      cameraBusBindings.set(cameraId, { vehicle_id: vehicleId, camera_position: cameraPosition });

      await EdgeNode.updateMany(
        { 'cameras.camera_id': cameraId },
        {
          $set: {
            'cameras.$.vehicle_id': vehicleId,
            'cameras.$.camera_position': cameraPosition,
          },
        }
      );

      io.to('authenticated_dashboard').emit('camera_status', {
        camera_id: cameraId,
        vehicle_id: vehicleId,
        camera_position: cameraPosition,
      });

      return res.json({
        success: true,
        camera_id: cameraId,
        vehicle_id: vehicleId,
        camera_position: cameraPosition,
      });
    } catch (error) {
      log.error('Vehicle assignment error: %s', error.message);
      return res.status(500).json({ error: 'Failed to update camera vehicle binding.' });
    }
  });

  // GET /api/control/edge-status — Get monitoring state (for edge nodes)
  router.get('/control/edge-status', verifyEdgeNode, (_req, res) => {
    res.json({ monitoring_enabled: getMonitoringEnabled() });
  });

  // POST /api/edge/provision — Spawn a Python engine for a camera bound to a bus
  router.post('/provision', verifyDashboardUser, validate(provisionSchema), (req, res) => {
    const {
      camera_id: cameraId,
      rtsp_url: rtspUrl,
      vehicle_id: reqVehicleId,
      camera_position: reqPosition,
    } = req.body;

    if (activeEdgeNodes.has(cameraId)) {
      return res.status(409).json({ error: 'A Python engine is already running for this camera.' });
    }

    const assignedVehicleId = reqVehicleId || deriveDefaultVehicleId(cameraId);
    const assignedPosition = reqPosition || '';
    cameraBusBindings.set(cameraId, {
      vehicle_id: assignedVehicleId,
      camera_position: assignedPosition,
    });

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
      log.info('Spawning Python engine for %s (Bus: %s) with %s', cameraId, assignedVehicleId, pythonBin);
      const pythonProcess = spawn(pythonBin, pythonArgs, {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env, VEHICLE_ID: assignedVehicleId },
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
      return res.json({
        success: true,
        pid: pythonProcess.pid,
        vehicle_id: assignedVehicleId,
        camera_position: assignedPosition,
        message: `Provisioning started for ${cameraId}`,
      });
    } catch (error) {
      log.error('Provisioning error: %s', error.message);
      return res.status(500).json({ error: 'Failed to provision camera node.' });
    }
  });

  return router;
}

module.exports = createEdgeRouter;
