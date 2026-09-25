/**
 * Backend API tests — Alert ingestion and history routes.
 *
 * Tests the incident ingestion pipeline, multipart enforcement,
 * edge node authentication, and incident acknowledgment.
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

describe('POST /api/alerts', () => {
  it('should accept a valid multipart alert with edge API key', async () => {
    const res = await request
      .post('/api/alerts')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .set('Content-Type', 'multipart/form-data')
      .field('camera_id', 'cam0')
      .field('incident_type', 'overcrowd')
      .field('confidence', '0.92')
      .expect(202);

    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('QUEUED');
  });

  it('should accept an alert with a numeric camera_id (e.g. "0" or "101")', async () => {
    const res = await request
      .post('/api/alerts')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .set('Content-Type', 'multipart/form-data')
      .field('camera_id', '0')
      .field('incident_type', 'overcrowd')
      .field('confidence', '0.95')
      .expect(202);

    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('QUEUED');
  });

  it('should return 401 without an API key', async () => {
    await request
      .post('/api/alerts')
      .set('Content-Type', 'multipart/form-data')
      .field('camera_id', 'cam0')
      .field('incident_type', 'overcrowd')
      .expect(401);
  });

  it('should return 401 with an invalid API key', async () => {
    await request
      .post('/api/alerts')
      .set('x-edge-api-key', 'totally-wrong-key')
      .set('Content-Type', 'multipart/form-data')
      .field('camera_id', 'cam0')
      .field('incident_type', 'overcrowd')
      .expect(401);
  });

  it('should return 415 for non-multipart content type', async () => {
    await request
      .post('/api/alerts')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .set('Content-Type', 'application/json')
      .send({ camera_id: 'cam0', incident_type: 'overcrowd' })
      .expect(415);
  });
});

describe('GET /api/alerts/history', () => {
  it('should return an array of incidents for authenticated user', async () => {
    const res = await request
      .get('/api/alerts/history')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body.data || res.body)).toBe(true);
  });

  it('should return 401 without JWT', async () => {
    await request
      .get('/api/alerts/history')
      .expect(401);
  });
});

describe('PATCH /api/alerts/:id/acknowledge', () => {
  let incidentId;

  beforeAll(async () => {
    // Ingest an alert so we have something to acknowledge
    const res = await request
      .post('/api/alerts')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .set('Content-Type', 'multipart/form-data')
      .field('camera_id', 'cam0')
      .field('incident_type', 'weapon_detected')
      .field('confidence', '0.88')
      .expect(202);

    incidentId = res.body.id;
    // Wait for the async queue to persist the incident
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }, 10000);

  it('should acknowledge an existing incident', async () => {
    const res = await request
      .patch(`/api/alerts/${incidentId}/acknowledge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REVIEWED' })
      .expect(200);

    expect(res.body.status).toBe('REVIEWED');
  });

  it('should return 404 for a nonexistent incident', async () => {
    await request
      .patch('/api/alerts/NONEXISTENT-ID-999/acknowledge')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REVIEWED' })
      .expect(404);
  });
});

describe('DELETE /api/alerts/:id', () => {
  let targetId;

  beforeAll(async () => {
    // Ingest an alert to delete
    const res = await request
      .post('/api/alerts')
      .set('x-edge-api-key', TEST_EDGE_API_KEY)
      .set('Content-Type', 'multipart/form-data')
      .field('camera_id', 'cam0')
      .field('incident_type', 'weapon_detected')
      .field('confidence', '0.92')
      .expect(202);

    targetId = res.body.id;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }, 10000);

  it('should return 401 when unauthenticated', async () => {
    await request
      .delete(`/api/alerts/${targetId}`)
      .expect(401);
  });

  it('should delete an existing incident', async () => {
    const res = await request
      .delete(`/api/alerts/${targetId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe(targetId);

    // Verify it is gone from DB
    const checkRes = await request
      .patch(`/api/alerts/${targetId}/acknowledge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REVIEWED' });

    expect(checkRes.status).toBe(404);
  });

  it('should return 404 for a nonexistent incident', async () => {
    await request
      .delete('/api/alerts/NONEXISTENT-ID-999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });
});

