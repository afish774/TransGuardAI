const Joi = require('joi');

// ==========================================
// REUSABLE VALIDATION MIDDLEWARE
// ==========================================

/**
 * Express middleware factory that validates req.body against a Joi schema.
 * Returns 400 with a clear error message if validation fails.
 *
 * @param {Joi.ObjectSchema} schema - The Joi schema to validate against.
 * @param {'body'|'query'|'params'} [source='body'] - Which request property to validate.
 * @returns {Function} Express middleware
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: false,
      allowUnknown: source === 'body', // Allow extra metadata fields in body
    });

    if (error) {
      const messages = error.details.map((detail) => detail.message).join('; ');
      return res.status(400).json({ error: `Validation failed: ${messages}` });
    }

    req[source] = value;
    return next();
  };
}

// ==========================================
// SCHEMAS
// ==========================================

const loginSchema = Joi.object({
  username: Joi.string().trim().min(3).max(64).required()
    .messages({ 'any.required': 'Username is required.' }),
  password: Joi.string().min(1).max(256).required()
    .messages({ 'any.required': 'Password is required.' }),
});

const registerSchema = Joi.object({
  username: Joi.string().trim().min(3).max(64).pattern(/^[a-zA-Z0-9_.-]+$/).required()
    .messages({
      'string.pattern.base': 'Username may only contain letters, numbers, underscores, dots, and hyphens.',
    }),
  password: Joi.string().min(8).max(256).required()
    .messages({ 'string.min': 'Password must be at least 8 characters.' }),
  role: Joi.string().valid('admin', 'operator').default('operator'),
});

const heartbeatSchema = Joi.object({
  camera_id: Joi.string().trim().min(1).max(64).required(),
  status: Joi.string().valid('ONLINE', 'OFFLINE').default('ONLINE'),
  fps: Joi.number().min(0).max(1000).default(0),
  capture_fps: Joi.number().min(0).max(1000).optional(),
  inference_fps: Joi.number().min(0).max(1000).optional(),
});

const provisionSchema = Joi.object({
  camera_id: Joi.string().trim().min(1).max(64).pattern(/^[A-Za-z0-9_-]+$/).required()
    .messages({
      'string.pattern.base': 'camera_id may only contain letters, numbers, underscores, and hyphens.',
    }),
  rtsp_url: Joi.alternatives().try(
    Joi.string().trim().uri({ scheme: ['rtsp', 'rtsps', 'http', 'https'] }),
    Joi.string().trim().pattern(/^\d+$/),
    Joi.string().trim().pattern(/\.(mp4|avi|mov|mkv)$/i),
  ).required()
    .messages({
      'alternatives.match': 'rtsp_url must be a valid stream URL (rtsp://, http://), webcam device number (e.g. 0), or video file.',
    }),
});

const zoneSchema = Joi.object({
  camera_id: Joi.string().trim().min(1).max(64).required(),
  polygon: Joi.array().items(
    Joi.array().items(Joi.number()).length(2)
  ).min(0).required()
    .custom((value, helpers) => {
      if (value.length > 0 && value.length < 3) {
        return helpers.error('any.custom', { message: 'polygon must have 0 or >= 3 vertices' });
      }
      return value;
    }),
});

const acknowledgeSchema = Joi.object({
  status: Joi.string().valid('REVIEWED', 'DISMISSED').default('REVIEWED'),
});

module.exports = {
  validate,
  loginSchema,
  registerSchema,
  heartbeatSchema,
  provisionSchema,
  zoneSchema,
  acknowledgeSchema,
};
