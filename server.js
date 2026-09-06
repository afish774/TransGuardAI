// ==========================================
// TRANS GUARD AI — NODE.JS BACKEND
// ==========================================
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const multer = require('multer');

const { verifyEdgeNode, verifyDashboardUser, socketHandshakeAuth, generateDashboardToken } = require('./middleware/auth');
const initRetentionCron = require('./jobs/retentionCron');
const Incident = require('./models/Incident');
const EdgeNode = require('./models/EdgeNode');
const WatchlistTarget = require('./models/WatchlistTarget');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  transports: ['websocket'],
});

const activeEdgeNodes = new Map();
const activeZones = new Map();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/transguard';
const PORT = Number(process.env.PORT || 5000);
const MAX_EVIDENCE_BYTES = Number(process.env.MAX_EVIDENCE_BYTES || 5 * 1024 * 1024);
const MAX_PENDING_INCIDENTS = Number(process.env.MAX_PENDING_INCIDENTS || 32);
const INCIDENT_WORKER_CONCURRENCY = Number(process.env.INCIDENT_WORKER_CONCURRENCY || 2);
const uploadsDir = path.join(__dirname, 'uploads', 'evidence');
const watchlistUploadsDir = path.join(__dirname, 'uploads', 'watchlist');

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('[MongoDB] Connected');

    // Development convenience only. Production deployments must provision
    // edge identities through a controlled administrative workflow.
    const count = await EdgeNode.countDocuments();
    if (count === 0 && process.env.NODE_ENV !== 'production') {
      await EdgeNode.create({
        node_id: 'EDGE-DEFAULT-001',
        api_key: process.env.DEFAULT_EDGE_API_KEY || 'transguard-edge-secret-key-9042',
        label: 'Default Dev Node',
        location: 'Local Development',
        hardware: 'Development Machine',
        status: 'ACTIVE',
      });
      console.log('[MongoDB] Seeded development EdgeNode.');
    }
  })
  .catch((error) => console.error('[MongoDB] Connection error:', error));

Promise.all([
  fs.mkdir(uploadsDir, { recursive: true }),
  fs.mkdir(watchlistUploadsDir, { recursive: true }),
]).catch((error) => console.error('[Filesystem] Setup error:', error));

app.use(cors());
// JSON is retained for control, auth, and heartbeat APIs. Evidence is multipart,
// so large Base64 JSON bodies are deliberately no longer accepted.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/uploads/evidence', express.static(uploadsDir));
app.use('/uploads/watchlist', express.static(watchlistUploadsDir));
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

// ==========================================
// MULTER UPLOAD CONFIGURATION
// ==========================================
const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function imageFileFilter(req, file, callback) {
  if (!allowedImageMimeTypes.has(file.mimetype)) {
    return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
  callback(null, true);
}

// Evidence is held only long enough to enter the asynchronous in-process
// ingestion queue. Disk I/O and database writes happen outside the request path.
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_EVIDENCE_BYTES,
    files: 1,
    fields: 30,
    fieldSize: 100 * 1024,
  },
  fileFilter: imageFileFilter,
});

const watchlistStorage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, watchlistUploadsDir),
  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname) || '.jpg';
    const safeName = (req.body.name || 'unknown').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    callback(null, `${safeName}_${Date.now()}${extension}`);
  },
});

const watchlistUpload = multer({
  storage: watchlistStorage,
  limits: {
    fileSize: MAX_EVIDENCE_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 10 * 1024,
  },
  fileFilter: imageFileFilter,
});

// ==========================================
// ASYNCHRONOUS INCIDENT INGESTION
// ==========================================
class IncidentIngestionQueue {
  constructor({ concurrency, maxPending }) {
    this.concurrency = concurrency;
    this.maxPending = maxPending;
    this.pending = [];
    this.running = 0;
  }

  enqueue(job) {
    if (this.pending.length + this.running >= this.maxPending) {
      return false;
    }
    this.pending.push(job);
    setImmediate(() => this.drain());
    return true;
  }

  drain() {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      this.running += 1;
      this.process(job)
        .catch((error) => {
          console.error(`[IncidentQueue] Failed to persist ${job.incidentId}:`, error);
        })
        .finally(() => {
          this.running -= 1;
          if (this.pending.length > 0) {
            setImmediate(() => this.drain());
          }
        });
    }
  }

  async process(job) {
    const { incidentId, nodeId, cameraId, incidentType, gps, confidence, metadata, evidence } = job;
    let evidenceUrl = null;

    if (evidence) {
      const fileName = `${uuidv4()}${evidence.extension}`;
      const filePath = path.join(uploadsDir, fileName);
      await fs.writeFile(filePath, evidence.buffer);
      evidenceUrl = `/uploads/evidence/${fileName}`;
    }

    try {
      const incident = new Incident({
        id: incidentId,
        node_id: nodeId,
        camera_id: cameraId,
        incident_type: incidentType,
        gps,
        confidence,
        metadata,
        evidence_image_url: evidenceUrl,
        timestamp: new Date(),
      });
      await incident.save();
      io.to('authenticated_dashboard').emit('new_alert', incident.toObject());
      console.log(`[IncidentQueue] Persisted ${incidentId}`);
    } catch (error) {
      if (evidenceUrl) {
        const filePath = path.join(uploadsDir, path.basename(evidenceUrl));
        await fs.unlink(filePath).catch(() => {});
      }
      throw error;
    }
  }
}

const incidentQueue = new IncidentIngestionQueue({
  concurrency: INCIDENT_WORKER_CONCURRENCY,
  maxPending: MAX_PENDING_INCIDENTS,
});

function parseMultipartValue(value) {
  if (Array.isArray(value)) {
    return value.map(parseMultipartValue);
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) return Number(trimmed);
  return value;
}

function buildIncidentJob(req) {
  const fields = Object.fromEntries(
    Object.entries(req.body || {}).map(([key, value]) => [key, parseMultipartValue(value)]),
  );
  const { camera_id: cameraId, incident_type: incidentType, gps, confidence, ...metadata } = fields;

  if (!cameraId || typeof cameraId !== 'string') {
    throw new Error('camera_id is required.');
  }
  if (!incidentType || typeof incidentType !== 'string') {
    throw new Error('incident_type is required.');
  }

  const numericConfidence = confidence === undefined || confidence === ''
    ? undefined
    : Number(confidence);
  if (numericConfidence !== undefined && !Number.isFinite(numericConfidence)) {
    throw new Error('confidence must be numeric.');
  }

  const evidence = req.file
    ? {
      buffer: req.file.buffer,
      extension: req.file.mimetype === 'image/png'
        ? '.png'
        : req.file.mimetype === 'image/webp'
          ? '.webp'
          : '.jpg',
    }
    : null;

  return {
    incidentId: `EV-${Date.now()}-${uuidv4()}`,
    nodeId: req.edgeNode.node_id,
    cameraId,
    incidentType,
    gps: gps && typeof gps === 'object' ? gps : undefined,
    confidence: numericConfidence,
    metadata,
    evidence,
  };
}

// ==========================================
// SOCKET.IO
// ==========================================
io.use(socketHandshakeAuth);

io.on('connection', async (socket) => {
  console.log(`[Socket.io] Authenticated client connected: ${socket.id} (user: ${socket.user.id})`);
  socket.join('authenticated_dashboard');
  try {
    const initialAlerts = await Incident.find().sort({ timestamp: -1 }).limit(50);
    const nodes = await EdgeNode.find({ status: 'ACTIVE' });
    const activeCameras = [];
    for (const node of nodes) {
      for (const camera of node.cameras || []) {
        activeCameras.push({
          camera_id: camera.camera_id,
          node_id: node.node_id,
          status: camera.status,
          fps: camera.fps,
          last_heartbeat: camera.last_heartbeat,
        });
      }
    }
    socket.emit('initial_state', {
      alerts: initialAlerts,
      monitoring_enabled: monitoringEnabled,
      cameras: activeCameras,
    });
  } catch (error) {
    console.error('[Socket.io] Error fetching initial state:', error);
  }
  socket.on('disconnect', () => console.log(`[Socket.io] Client disconnected: ${socket.id}`));
});

const alertRateLimiter = rateLimit({
  windowMs: 1000,
  max: 15,
  message: 'Too many alerts received. Rate limited.',
});

let monitoringEnabled = true;

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin') {
    const token = generateDashboardToken({ id: 'admin123', role: 'admin', username: 'admin' });
    return res.json({ token, user: { username: 'admin', role: 'admin' } });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

// ==========================================
// ALERT INGESTION PIPELINE
// ==========================================
// Multipart field contract:
//   evidence: JPEG/PNG/WebP file (optional)
//   camera_id, incident_type, confidence, gps: JSON string (optional)
//   all remaining fields: incident metadata, including point, stationarySeconds,
//   objectClass, identity, and zone information.
app.post(
  '/api/alerts',
  verifyEdgeNode,
  alertRateLimiter,
  evidenceUpload.single('evidence'),
  (req, res) => {
    if (!req.is('multipart/form-data')) {
      return res.status(415).json({ error: 'Use multipart/form-data with an optional evidence file field.' });
    }
    if (!monitoringEnabled) {
      return res.status(403).json({ error: 'Monitoring is currently disabled.' });
    }
    try {
      const job = buildIncidentJob(req);
      if (!incidentQueue.enqueue(job)) {
        return res.status(503).json({ error: 'Incident queue is full. Retry shortly.' });
      }
      return res.status(202).json({ success: true, id: job.incidentId, status: 'QUEUED' });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Invalid incident payload.' });
    }
  },
);

// ==========================================
// DASHBOARD ROUTES
// ==========================================
app.get('/api/control/status', verifyDashboardUser, (req, res) => {
  res.json({ monitoring_enabled: monitoringEnabled });
});

app.post('/api/control/toggle', verifyDashboardUser, (req, res) => {
  monitoringEnabled = !monitoringEnabled;
  io.to('authenticated_dashboard').emit('control_status', { monitoring_enabled: monitoringEnabled });
  res.json({ monitoring_enabled: monitoringEnabled });
});

app.get('/api/alerts/history', verifyDashboardUser, async (req, res) => {
  try {
    const recentAlerts = await Incident.find().sort({ timestamp: -1 }).limit(100);
    res.json(recentAlerts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch incident history.' });
  }
});

app.get('/api/watchlist', verifyEdgeNode, async (req, res) => {
  try {
    const targets = await WatchlistTarget.find({ status: 'ACTIVE' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json(targets.map((target) => ({
      name: target.name,
      url: target.reference_image_url.startsWith('http')
        ? target.reference_image_url
        : `${baseUrl}${target.reference_image_url}`,
    })));
  } catch (error) {
    console.error('[API] Watchlist fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch watchlist.' });
  }
});

app.post('/api/watchlist', verifyDashboardUser, watchlistUpload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.body.name) {
      return res.status(400).json({ error: 'Image file and name are required.' });
    }
    const target = new WatchlistTarget({
      subject_id: uuidv4(),
      name: req.body.name,
      reference_image_url: `/uploads/watchlist/${req.file.filename}`,
    });
    await target.save();
    return res.status(201).json({ success: true, target });
  } catch (error) {
    console.error('[API] Watchlist upload error:', error);
    return res.status(500).json({ error: 'Failed to upload watchlist target.' });
  }
});

app.post('/api/edge/zone', verifyDashboardUser, (req, res) => {
  const { camera_id: cameraId, polygon } = req.body;
  if (!cameraId || !Array.isArray(polygon)) {
    return res.status(400).json({ error: 'camera_id and polygon array are required' });
  }
  activeZones.set(cameraId, polygon);
  return res.json({ success: true, camera_id: cameraId, polygon });
});

app.get('/api/edge/zone/:camera_id', verifyEdgeNode, (req, res) => {
  const polygon = activeZones.get(req.params.camera_id) || [];
  res.json({ camera_id: req.params.camera_id, polygon });
});

// ==========================================
// EDGE NODE ROUTES
// ==========================================
app.post('/api/edge/heartbeat', verifyEdgeNode, async (req, res) => {
  try {
    const { camera_id: cameraId, status, fps } = req.body;
    const node = req.edgeNode;
    if (!cameraId) {
      return res.status(400).json({ error: 'camera_id is required.' });
    }

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
    console.error('[API] Heartbeat error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.get('/api/edge/cameras', verifyDashboardUser, async (req, res) => {
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
    console.error('[API] Camera list error:', error);
    res.status(500).json({ error: 'Failed to fetch camera list.' });
  }
});

app.get('/api/control/edge-status', verifyEdgeNode, (req, res) => {
  res.json({ monitoring_enabled: monitoringEnabled });
});

app.post('/api/edge/provision', verifyDashboardUser, (req, res) => {
  const { camera_id: cameraId, rtsp_url: rtspUrl } = req.body;
  if (!cameraId || !rtspUrl) {
    return res.status(400).json({ error: 'camera_id and rtsp_url are required.' });
  }
  if (activeEdgeNodes.has(cameraId)) {
    return res.status(409).json({ error: 'A Python engine is already running for this camera.' });
  }

  try {
    const pythonArgs = ['trans_guard_engine.py', '--camera', cameraId, '--url', rtspUrl, '--headless'];
    console.log(`[Provisioning] Spawning Python engine for ${cameraId}`);
    const pythonProcess = spawn('python', pythonArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    activeEdgeNodes.set(cameraId, pythonProcess);
    pythonProcess.stdout.on('data', (data) => console.log(`[Python ${cameraId}] ${data.toString().trim()}`));
    pythonProcess.stderr.on('data', (data) => console.error(`[Python ${cameraId} ERROR] ${data.toString().trim()}`));
    pythonProcess.on('error', (error) => console.error(`[Python ${cameraId}] Process error:`, error));
    pythonProcess.on('close', (code) => {
      console.log(`[Python ${cameraId}] Process exited with code ${code}`);
      activeEdgeNodes.delete(cameraId);
    });
    return res.json({ success: true, pid: pythonProcess.pid, message: `Provisioning started for ${cameraId}` });
  } catch (error) {
    console.error('[Provisioning] Error spawning Python process:', error);
    return res.status(500).json({ error: 'Failed to provision camera node.' });
  }
});

// ==========================================
// CAMERA OFFLINE DETECTION
// ==========================================
const CAMERA_STALE_THRESHOLD_MS = 30000;
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - CAMERA_STALE_THRESHOLD_MS);
    const nodes = await EdgeNode.find({ status: 'ACTIVE', 'cameras.0': { $exists: true } });
    for (const node of nodes) {
      let changed = false;
      for (const camera of node.cameras) {
        if (camera.status === 'ONLINE' && camera.last_heartbeat && camera.last_heartbeat < cutoff) {
          camera.status = 'OFFLINE';
          camera.fps = 0;
          changed = true;
          console.log(`[Camera] Marked ${camera.camera_id} on ${node.node_id} as OFFLINE (stale heartbeat)`);
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
    console.error('[Camera] Offline detection error:', error);
  }
}, CAMERA_STALE_THRESHOLD_MS);

const spaFallback = (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
};

app.use(spaFallback);

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Evidence image must not exceed ${Math.floor(MAX_EVIDENCE_BYTES / 1024 / 1024)} MB.`
      : 'Invalid multipart upload.';
    return res.status(400).json({ error: message });
  }
  if (error) {
    console.error('[API] Unhandled request error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
  return next();
});

initRetentionCron();

server.listen(PORT, () => {
  console.log(`[Server] Trans Guard AI backend running on port ${PORT}`);
});
