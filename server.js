// ==========================================
// TRANS GUARD AI — NODE.JS BACKEND
// Slim orchestrator: middleware, routes, Socket.IO, and lifecycle.
// ==========================================
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');

const logger = require('./utils/logger');
const log = logger.forComponent('Server');
const { socketHandshakeAuth } = require('./middleware/auth');
const requestLogger = require('./middleware/requestLogger');
const initRetentionCron = require('./jobs/retentionCron');

// Models (needed for seeding and Socket.IO initial state)
const Incident = require('./models/Incident');
const EdgeNode = require('./models/EdgeNode');
const User = require('./models/User');

// Services
const { IncidentIngestionQueue } = require('./services/IncidentQueue');
const { startOfflineDetector } = require('./services/offlineDetector');

// Route factories
const createAlertsRouter = require('./routes/alerts');
const createEdgeRouter = require('./routes/edge');
const createWatchlistRouter = require('./routes/watchlist');
const createControlRouter = require('./routes/control');
const authRouter = require('./routes/auth');

// ==========================================
// APP + SERVER SETUP
// ==========================================
const app = express();
const server = http.createServer(app);

const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : null;

const corsOptions = {
  origin: CORS_ORIGINS && CORS_ORIGINS.length > 0 ? CORS_ORIGINS : '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-edge-api-key', 'x-edge-signature', 'x-edge-timestamp'],
  credentials: true,
};

const io = new Server(server, { cors: corsOptions, pingTimeout: 60000, transports: ['websocket'] });

// ==========================================
// CONFIGURATION
// ==========================================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/transguard';
const PORT = Number(process.env.PORT || 5000);
const MAX_EVIDENCE_BYTES = Number(process.env.MAX_EVIDENCE_BYTES || 5 * 1024 * 1024);
const MAX_PENDING_INCIDENTS = Number(process.env.MAX_PENDING_INCIDENTS || 32);
const INCIDENT_WORKER_CONCURRENCY = Number(process.env.INCIDENT_WORKER_CONCURRENCY || 2);
const startTime = Date.now();

const uploadsDir = path.join(__dirname, 'uploads', 'evidence');
const watchlistUploadsDir = path.join(__dirname, 'uploads', 'watchlist');

// ==========================================
// APPLICATION STATE
// ==========================================
let monitoringEnabled = true;
const activeEdgeNodes = new Map();

// ==========================================
// DATABASE + SEEDING
// ==========================================
mongoose.connect(MONGO_URI)
  .then(async () => {
    log.info('MongoDB connected');
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'TransGuard@2026!';
      await User.createUser({ username: 'admin', password: defaultPassword, role: 'admin' });
      log.info('Seeded default admin user (username: admin). Change the password in production!');
    }
    const nodeCount = await EdgeNode.countDocuments();
    if (nodeCount === 0) {
      const defaultApiKey = process.env.DEFAULT_EDGE_API_KEY || 'transguard-edge-secret-key-9042';
      await EdgeNode.createWithRawKey({
        node_id: 'EDGE-DEFAULT-001', api_key: defaultApiKey,
        label: 'Default Dev Node', location: 'Local Development',
        hardware: 'Development Machine', status: 'ACTIVE',
      });
      log.info('Seeded development EdgeNode with hashed API key.');
    }
  })
  .catch((error) => log.error('MongoDB connection error: %s', error.message));

Promise.all([
  fs.mkdir(uploadsDir, { recursive: true }),
  fs.mkdir(watchlistUploadsDir, { recursive: true }),
]).catch((error) => log.error('Filesystem setup error: %s', error.message));

// ==========================================
// MULTER CONFIGURATION
// ==========================================
const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function imageFileFilter(req, file, callback) {
  if (!allowedImageMimeTypes.has(file.mimetype)) {
    return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
  callback(null, true);
}

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1, fields: 30, fieldSize: 100 * 1024 },
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
  limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1, fields: 10, fieldSize: 10 * 1024 },
  fileFilter: imageFileFilter,
});

// ==========================================
// INCIDENT QUEUE
// ==========================================
const incidentQueue = new IncidentIngestionQueue({
  concurrency: INCIDENT_WORKER_CONCURRENCY,
  maxPending: MAX_PENDING_INCIDENTS,
  uploadsDir,
  io,
  Incident,
});

// ==========================================
// MIDDLEWARE STACK
// ==========================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
      fontSrc: ["'self'", 'https:', 'data:'],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https:',
        'http:',
        'https://*.arcgisonline.com',
        'https://*.tile.openstreetmap.org',
        'https://*.basemaps.cartocdn.com',
        'https://ui-avatars.com',
      ],
      connectSrc: [
        "'self'",
        'ws:',
        'wss:',
        'http:',
        'https:',
      ],
      mediaSrc: ["'self'", 'blob:', 'data:', 'http:', 'https:'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors(corsOptions));
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(requestLogger);

const staticOpts = {
  setHeaders: (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
};
app.use('/uploads/evidence', express.static(uploadsDir, staticOpts));
app.use('/uploads/watchlist', express.static(watchlistUploadsDir, staticOpts));
app.use(express.static(path.join(__dirname, 'frontend', 'dist'), staticOpts));

// ==========================================
// SOCKET.IO
// ==========================================
const socketLog = logger.forComponent('Socket.io');
io.use(socketHandshakeAuth);

io.on('connection', async (socket) => {
  socketLog.info('Client connected: %s (user: %s)', socket.id, socket.user.id);
  socket.join('authenticated_dashboard');
  try {
    const initialAlerts = await Incident.find().sort({ timestamp: -1 }).limit(50);
    const nodes = await EdgeNode.find({ status: 'ACTIVE' });
    const activeCameras = [];
    for (const node of nodes) {
      for (const camera of node.cameras || []) {
        activeCameras.push({
          camera_id: camera.camera_id, node_id: node.node_id,
          status: camera.status, fps: camera.fps, last_heartbeat: camera.last_heartbeat,
        });
      }
    }
    socket.emit('initial_state', { alerts: initialAlerts, monitoring_enabled: monitoringEnabled, cameras: activeCameras });
  } catch (error) {
    socketLog.error('Error fetching initial state: %s', error.message);
  }
  socket.on('disconnect', () => socketLog.info('Client disconnected: %s', socket.id));
});

// ==========================================
// ROUTES
// ==========================================
app.get('/api/health', async (req, res) => {
  const mongoState = mongoose.connection.readyState;
  res.json({
    status: mongoState === 1 ? 'ok' : 'degraded',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    mongo: mongoState === 1 ? 'connected' : mongoState === 2 ? 'connecting' : 'disconnected',
    activeNodes: activeEdgeNodes.size,
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);

app.use('/api/alerts', createAlertsRouter({
  incidentQueue, io, evidenceUpload, uploadsDir,
  getMonitoringEnabled: () => monitoringEnabled,
}));

app.use('/api/edge', createEdgeRouter({
  io, activeEdgeNodes,
  getMonitoringEnabled: () => monitoringEnabled,
}));

app.use('/api/watchlist', createWatchlistRouter({ watchlistUpload }));

app.use('/api/control', createControlRouter({
  io,
  getMonitoringEnabled: () => monitoringEnabled,
  setMonitoringEnabled: (v) => { monitoringEnabled = v; },
}));

// Zone routes mounted under /api/edge but managed by control router
app.use('/api/edge', createControlRouter({
  io,
  getMonitoringEnabled: () => monitoringEnabled,
  setMonitoringEnabled: (v) => { monitoringEnabled = v; },
}));

// ==========================================
// SPA FALLBACK & ERROR HANDLER
// ==========================================
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

app.use((error, req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Evidence image must not exceed ${Math.floor(MAX_EVIDENCE_BYTES / 1024 / 1024)} MB.`
      : 'Invalid multipart upload.';
    return res.status(400).json({ error: message });
  }
  if (error) {
    log.error('Unhandled request error: %s', error.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
  return _next();
});

// ==========================================
// BACKGROUND SERVICES
// ==========================================
if (process.env.NODE_ENV !== 'test') {
  initRetentionCron();
}
const offlineCheckInterval = startOfflineDetector(io);

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log.info('Shutdown signal received (%s). Closing gracefully...', signal);
  server.close(() => log.info('HTTP server closed'));
  clearInterval(offlineCheckInterval);
  for (const [cameraId, proc] of activeEdgeNodes) {
    log.info('Terminating Python engine for %s (pid=%d)', cameraId, proc.pid);
    proc.kill('SIGTERM');
  }
  io.close();
  try {
    await mongoose.connection.close();
    log.info('MongoDB connection closed');
  } catch (error) {
    log.error('Error closing MongoDB: %s', error.message);
  }
  log.info('Graceful shutdown complete');
  process.exit(0);
}

function forceExit(signal) {
  gracefulShutdown(signal);
  setTimeout(() => { log.error('Forced exit after 10s timeout'); process.exit(1); }, 10000).unref();
}

process.on('SIGTERM', () => forceExit('SIGTERM'));
process.on('SIGINT', () => forceExit('SIGINT'));

// ==========================================
// START SERVER
// ==========================================
if (require.main === module) {
  server.listen(PORT, () => {
    log.info('Trans Guard AI backend running on port %d', PORT);
    log.info('Architecture: routes/ + services/ decomposition');
    log.info('Security: Helmet=%s, CORS=%s, bcrypt auth, hashed API keys', 'enabled', CORS_ORIGINS ? CORS_ORIGINS.join(',') : 'open (dev)');
  });
}

module.exports = { app, server, io };
