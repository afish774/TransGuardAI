// ==========================================
// HTTP REQUEST LOGGING MIDDLEWARE
// ==========================================
const crypto = require('crypto');
const logger = require('../utils/logger');
const log = logger.forComponent('HTTP');

/**
 * Express middleware that logs every HTTP request with:
 * - method, path, status code, response time
 * - unique request ID (X-Request-Id header)
 *
 * Inspired by morgan but integrated with the project's Winston logger.
 */
function requestLogger(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID().slice(0, 8);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startTime = process.hrtime.bigint();

  // Patch res.end to capture status code and duration
  const originalEnd = res.end;
  res.end = function patchedEnd(...args) {
    const durationNs = process.hrtime.bigint() - startTime;
    const durationMs = Number(durationNs) / 1e6;

    const statusCode = res.statusCode;
    const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    log[logLevel](
      '%s %s %d %sms [%s]',
      req.method,
      req.originalUrl,
      statusCode,
      durationMs.toFixed(1),
      requestId,
    );

    originalEnd.apply(this, args);
  };

  next();
}

module.exports = requestLogger;
