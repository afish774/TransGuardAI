const winston = require('winston');

const isProduction = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(), // Enable %s, %d, %j interpolation
    isProduction
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, component, requestId, ...meta }) => {
            const prefix = component ? `[${component}]` : '';
            const rid = requestId ? ` (${requestId})` : '';
            const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} ${level} ${prefix}${rid} ${message}${extra}`;
          })
        )
  ),
  transports: [
    new winston.transports.Console(),
  ],
  exitOnError: false,
});

/**
 * Create a child logger scoped to a specific component.
 * @param {string} component - Name of the subsystem (e.g., 'Auth', 'Socket.io', 'IncidentQueue')
 * @returns {winston.Logger}
 */
logger.forComponent = (component) => logger.child({ component });

module.exports = logger;
