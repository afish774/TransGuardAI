// ==========================================
// AUTHENTICATION ROUTES
// ==========================================
const { Router } = require('express');
const rateLimit = require('express-rate-limit');

const logger = require('../utils/logger');
const { verifyDashboardUser, requireAdmin, generateDashboardToken } = require('../middleware/auth');
const { validate, loginSchema, registerSchema } = require('../middleware/validate');
const User = require('../models/User');

const router = Router();
const authLog = logger.forComponent('Auth');

// Brute-force protection for login endpoint
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginRateLimiter, validate(loginSchema), async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username: username.trim() });
    if (!user) {
      authLog.warn('Login failed: unknown user "%s"', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      authLog.warn('Login failed: wrong password for "%s"', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    user.last_login = new Date();
    await user.save();

    const token = generateDashboardToken({ id: user._id.toString(), role: user.role, username: user.username });
    authLog.info('User "%s" logged in successfully', username);
    return res.json({ token, user: { username: user.username, role: user.role } });
  } catch (error) {
    authLog.error('Login error: %s', error.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post('/register', verifyDashboardUser, requireAdmin, validate(registerSchema), async (req, res) => {
  const { username, password, role } = req.body;
  try {
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    const user = await User.createUser({ username, password, role });
    authLog.info('Admin "%s" registered new user "%s" (role: %s)', req.user.username, username, role);
    return res.status(201).json({ success: true, user: { username: user.username, role: user.role } });
  } catch (error) {
    authLog.error('Registration error: %s', error.message);
    return res.status(500).json({ error: 'Failed to create user.' });
  }
});

module.exports = router;
