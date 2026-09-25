/**
 * Shared test setup for backend API integration tests.
 *
 * Uses mongodb-memory-server to spin up an ephemeral MongoDB instance.
 * This module is designed to be called ONCE — from the first test file
 * that loads. Subsequent test files reuse the same connection via the
 * Node.js require cache.
 *
 * Strategy:
 *   1. Start MongoMemoryServer
 *   2. Set env vars (MONGO_URI, etc.) BEFORE server.js is first required
 *   3. Require server.js → triggers mongoose.connect() with in-memory URI
 *   4. Wait for connection + seeding
 *   5. Export app, helpers, and teardown function
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const supertest = require('supertest');

// Known test credentials
const TEST_ADMIN = { username: 'admin', password: 'TestPassword@123' };
const TEST_EDGE_API_KEY = 'test-edge-api-key-12345';

let mongoServer = null;
let _app = null;
let _initialized = false;

/**
 * Initialize the test environment. Idempotent — safe to call from
 * multiple test files; only the first call does anything.
 */
async function initTestEnv() {
  if (_initialized) return;
  _initialized = true;

  // Start in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  // Set env vars BEFORE requiring the app
  process.env.MONGO_URI = uri;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.DEFAULT_ADMIN_PASSWORD = TEST_ADMIN.password;
  process.env.DEFAULT_EDGE_API_KEY = TEST_EDGE_API_KEY;
  process.env.NODE_ENV = 'test';

  // Now require server.js — this triggers mongoose.connect()
  const { app } = require('../../server');
  _app = app;

  // Wait for mongoose to connect
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('MongoDB connection timeout')), 20000);
    const check = setInterval(() => {
      if (mongoose.connection.readyState === 1) {
        clearInterval(check);
        clearTimeout(timeout);
        resolve();
      }
    }, 100);
  });

  // Wait for seed operations (admin user + edge node) to complete
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

/**
 * Tear down the test environment. Call this in the LAST test file's afterAll.
 */
async function teardownTestEnv() {
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.dropDatabase();
      await mongoose.connection.close();
    } catch {
      // Ignore teardown errors
    }
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}

/**
 * Get the Express app for supertest (must call initTestEnv first).
 */
function getApp() {
  if (!_app) throw new Error('Call initTestEnv() before getApp()');
  return _app;
}

/**
 * Login as the seeded admin user and return the JWT.
 */
async function loginAsAdmin() {
  const app = getApp();
  const res = await supertest(app)
    .post('/api/auth/login')
    .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password });

  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.token;
}

module.exports = {
  initTestEnv,
  teardownTestEnv,
  getApp,
  loginAsAdmin,
  TEST_ADMIN,
  TEST_EDGE_API_KEY,
};
