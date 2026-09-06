const jwt = require('jsonwebtoken');
const EdgeNode = require('../models/EdgeNode');

const JWT_SECRET = process.env.JWT_SECRET || 'transguard-dashboard-jwt-secret';

// ==========================================
// EDGE NODE GATEKEEPER
// Queries the EdgeNode collection in MongoDB
// to validate the x-edge-api-key header.
// ==========================================
const verifyEdgeNode = async (req, res, next) => {
  const apiKey = req.headers['x-edge-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized. Missing x-edge-api-key header.' });
  }

  try {
    const node = await EdgeNode.findOne({ api_key: apiKey, status: 'ACTIVE' });

    if (!node) {
      return res.status(401).json({ error: 'Unauthorized Edge Node. Invalid or inactive API Key.' });
    }

    // Attach the validated node info to the request for downstream use
    req.edgeNode = node;

    // Update the heartbeat timestamp on every successful auth
    node.last_heartbeat = new Date();
    node.save().catch(() => {}); // Fire-and-forget, don't block the pipeline

    next();
  } catch (error) {
    console.error('[Auth] Edge node verification error:', error);
    return res.status(500).json({ error: 'Internal authentication error.' });
  }
};

// ==========================================
// DASHBOARD GATEKEEPER
// Verifies the JWT from the Authorization header.
// ==========================================
const verifyDashboardUser = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. Missing or malformed Authorization header.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized. Invalid or expired JWT.' });
  }
};

// ==========================================
// SOCKET HANDSHAKE AUTH
// Used as Socket.io middleware (io.use())
// to authenticate on the handshake itself.
// ==========================================
const socketHandshakeAuth = (socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error('Authentication error: No token provided.'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (error) {
    return next(new Error('Authentication error: Invalid token.'));
  }
};

// ==========================================
// JWT GENERATOR
// ==========================================
const generateDashboardToken = (userPayload) => {
  return jwt.sign(userPayload, JWT_SECRET, { expiresIn: '12h' });
};

module.exports = {
  verifyEdgeNode,
  verifyDashboardUser,
  socketHandshakeAuth,
  generateDashboardToken
};
