const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const EdgeNode = require('../models/EdgeNode');
const logger = require('../utils/logger').forComponent('Auth');

const JWT_SECRET = process.env.JWT_SECRET || 'transguard-dashboard-jwt-secret';
const HMAC_MAX_AGE_SECONDS = 30;

// ==========================================
// EDGE NODE GATEKEEPER
// Queries the EdgeNode collection using hashed API key.
// Optionally validates HMAC signature for replay protection.
// ==========================================
const verifyEdgeNode = async (req, res, next) => {
  const apiKey = req.headers['x-edge-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized. Missing x-edge-api-key header.' });
  }

  try {
    const node = await EdgeNode.findByApiKey(apiKey);

    if (!node) {
      logger.warn('Rejected edge request: invalid API key');
      return res.status(401).json({ error: 'Unauthorized Edge Node. Invalid or inactive API Key.' });
    }

    // Optional HMAC verification (backward-compatible: only enforced if header present)
    const signature = req.headers['x-edge-signature'];
    const timestamp = req.headers['x-edge-timestamp'];
    if (signature && timestamp) {
      const age = Math.abs(Date.now() / 1000 - Number(timestamp));
      if (!Number.isFinite(age) || age > HMAC_MAX_AGE_SECONDS) {
        logger.warn('Rejected edge request: HMAC timestamp too old (%ds)', age);
        return res.status(401).json({ error: 'Request timestamp expired. Clock skew too large.' });
      }

      // Reconstruct HMAC: sha256(api_key, timestamp + body_str)
      const rawBodyStr = req.rawBody ?? '';
      const jsonBodyStr = req.body ? JSON.stringify(req.body) : '';

      const expectedRaw = crypto
        .createHmac('sha256', apiKey)
        .update(`${timestamp}${rawBodyStr}`)
        .digest('hex');

      const expectedJson = crypto
        .createHmac('sha256', apiKey)
        .update(`${timestamp}${jsonBodyStr}`)
        .digest('hex');

      const sigBuf = Buffer.from(signature, 'hex');
      const rawBuf = Buffer.from(expectedRaw, 'hex');
      const jsonBuf = Buffer.from(expectedJson, 'hex');

      const rawMatch = sigBuf.length === rawBuf.length && crypto.timingSafeEqual(sigBuf, rawBuf);
      const jsonMatch = sigBuf.length === jsonBuf.length && crypto.timingSafeEqual(sigBuf, jsonBuf);

      if (!rawMatch && !jsonMatch) {
        logger.warn('Rejected edge request: HMAC signature mismatch');
        return res.status(401).json({ error: 'Invalid request signature.' });
      }
    }

    // Attach validated node info to the request for downstream use
    req.edgeNode = node;

    // Update the heartbeat timestamp on every successful auth (fire-and-forget)
    node.last_heartbeat = new Date();
    node.save().catch(() => {});

    next();
  } catch (error) {
    logger.error('Edge node verification error: %s', error.message);
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
  } catch (_error) {
    return res.status(401).json({ error: 'Unauthorized. Invalid or expired JWT.' });
  }
};

/**
 * Require admin role. Must be used AFTER verifyDashboardUser.
 */
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Admin privileges required.' });
  }
  next();
};

// ==========================================
// SOCKET HANDSHAKE AUTH
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
  } catch (_error) {
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
  requireAdmin,
  socketHandshakeAuth,
  generateDashboardToken
};
