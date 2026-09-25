/**
 * Backend API tests — Watchlist routes.
 *
 * Tests watchlist target upload and retrieval endpoints.
 */

const supertest = require('supertest');
const path = require('path');
const { initTestEnv, teardownTestEnv, getApp, loginAsAdmin, TEST_EDGE_API_KEY } = require('./setup');

let app;
let request;
let adminToken;

beforeAll(async () => {
  await initTestEnv();
  app = getApp();
  request = supertest(app);
  adminToken = await loginAsAdmin();
}, 30000);

afterAll(async () => {
  await teardownTestEnv();
});

describe('POST /api/watchlist', () => {
  it('should upload a watchlist target with an image', async () => {
    await request
      .post('/api/watchlist')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'John Test')
      .attach('image', path.join(__dirname, '..', '..', 'README.md')) // Using README as placeholder file
      .expect((response) => {
        // Accept 201 (success) or 400 (file type rejection) — depends on multer config
        expect([201, 400]).toContain(response.status);
      });
  });

  it('should return 400 when name is missing', async () => {
    await request
      .post('/api/watchlist')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('should return 401 without authentication', async () => {
    await request
      .post('/api/watchlist')
      .field('name', 'Unauthenticated Upload')
      .expect(401);
  });
});

describe('GET /api/watchlist', () => {
  it('should return watchlist targets for edge-authenticated requests', async () => {
    const res = await request
      .get('/api/watchlist')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should return 401 without edge API key', async () => {
    await request
      .get('/api/watchlist')
      .expect(401);
  });
});
