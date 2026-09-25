/**
 * Backend API tests — Edge node routes and health check.
 *
 * Tests heartbeat, camera list, zone management, and the
 * unauthenticated /api/health endpoint.
 *
 * This is the LAST test file to run (alphabetically), so it
 * handles teardown.
 */

const supertest = require('supertest');
const { initTestEnv, getApp, loginAsAdmin, TEST_EDGE_API_KEY } = require('./setup');

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
  // Don't teardown here — let the last test file (watchlist.test.js) do it
});

describe('GET /api/health', () => {
  it('should return health status without authentication', async () => {
    const res = await request
      .get('/api/health')
      .expect(200);

    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('mongo');
    expect(res.body).toHaveProperty('version', '2.0.0');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('POST /api/edge/heartbeat', () => {
  it('should accept a heartbeat from a valid edge node', async () => {
    const res = await request
      .post('/api/edge/heartbeat')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .send({ camera_id: 'cam0', status: 'ONLINE', fps: 25 })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should return 401 without edge API key', async () => {
    await request
      .post('/api/edge/heartbeat')
      .send({ camera_id: 'cam0', status: 'ONLINE', fps: 25 })
      .expect(401);
  });

  it('should return 400 for missing camera_id (Joi validation)', async () => {
    const res = await request
      .post('/api/edge/heartbeat')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .send({ status: 'ONLINE', fps: 25 })
      .expect(400);

    expect(res.body.error).toMatch(/Validation failed/);
  });
});

describe('GET /api/edge/cameras', () => {
  it('should return camera list for authenticated dashboard user', async () => {
    const res = await request
      .get('/api/edge/cameras')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Zone management', () => {
  const testPolygon = [[0, 0], [100, 0], [100, 100], [0, 100]];

  it('should create a zone for a camera', async () => {
    const res = await request
      .post('/api/edge/zone')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ camera_id: 'cam0', polygon: testPolygon })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.polygon).toEqual(testPolygon);
  });

  it('should retrieve the zone for a camera (edge-authenticated)', async () => {
    const res = await request
      .get('/api/edge/zone/cam0')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .expect(200);

    expect(res.body.camera_id).toBe('cam0');
    expect(res.body.polygon).toEqual(testPolygon);
  });
});
