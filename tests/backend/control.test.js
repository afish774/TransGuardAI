/**
 * Backend API tests — Control, monitoring toggle, and zone persistence.
 *
 * Tests the monitoring toggle, control status, and zone CRUD operations
 * which now persist to MongoDB instead of in-memory storage.
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
  // Don't teardown here — let the last test file do it
});

describe('GET /api/control/status', () => {
  it('should return monitoring enabled state', async () => {
    const res = await request
      .get('/api/control/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('monitoring_enabled');
    expect(typeof res.body.monitoring_enabled).toBe('boolean');
  });

  it('should return 401 without authentication', async () => {
    await request
      .get('/api/control/status')
      .expect(401);
  });
});

describe('POST /api/control/toggle', () => {
  it('should toggle monitoring state', async () => {
    // Get current state
    const before = await request
      .get('/api/control/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Toggle
    const res = await request
      .post('/api/control/toggle')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.monitoring_enabled).toBe(!before.body.monitoring_enabled);

    // Toggle back to restore original state
    await request
      .post('/api/control/toggle')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('should return 401 without authentication', async () => {
    await request
      .post('/api/control/toggle')
      .expect(401);
  });
});

describe('Zone persistence (MongoDB)', () => {
  const testPolygon = [[10, 20], [30, 40], [50, 60], [70, 80]];

  it('should create a zone that persists', async () => {
    const res = await request
      .post('/api/edge/zone')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ camera_id: 'cam_zone_test', polygon: testPolygon })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.polygon).toEqual(testPolygon);
  });

  it('should retrieve the persisted zone', async () => {
    const res = await request
      .get('/api/edge/zone/cam_zone_test')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .expect(200);

    expect(res.body.camera_id).toBe('cam_zone_test');
    expect(res.body.polygon).toEqual(testPolygon);
  });

  it('should update an existing zone (upsert)', async () => {
    const newPolygon = [[0, 0], [100, 0], [100, 100]];
    await request
      .post('/api/edge/zone')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ camera_id: 'cam_zone_test', polygon: newPolygon })
      .expect(200);

    const res = await request
      .get('/api/edge/zone/cam_zone_test')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .expect(200);

    expect(res.body.polygon).toEqual(newPolygon);
  });

  it('should return empty polygon for unknown camera', async () => {
    const res = await request
      .get('/api/edge/zone/nonexistent_cam')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .expect(200);

    expect(res.body.polygon).toEqual([]);
  });
});

describe('GET /api/alerts/history (pagination)', () => {
  it('should return paginated results with metadata', async () => {
    const res = await request
      .get('/api/alerts/history?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toHaveProperty('page', 1);
    expect(res.body.pagination).toHaveProperty('limit', 10);
    expect(res.body.pagination).toHaveProperty('total');
    expect(res.body.pagination).toHaveProperty('pages');
  });

  it('should default to page 1 limit 50 when no params', async () => {
    const res = await request
      .get('/api/alerts/history')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(50);
  });
});
