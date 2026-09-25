/**
 * Backend API tests — Authentication routes.
 *
 * Tests login, registration, JWT verification, and RBAC enforcement.
 */

const supertest = require('supertest');
const { initTestEnv, getApp, loginAsAdmin, TEST_ADMIN } = require('./setup');

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

describe('POST /api/auth/login', () => {
  it('should return a JWT for valid credentials', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN.username, password: TEST_ADMIN.password })
      .expect(200);

    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toHaveProperty('username', TEST_ADMIN.username);
    expect(res.body.user).toHaveProperty('role', 'admin');
  });

  it('should return 401 for wrong password', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: TEST_ADMIN.username, password: 'WrongPassword!99' })
      .expect(401);

    expect(res.body).toHaveProperty('error', 'Invalid credentials');
  });

  it('should return 401 for nonexistent user', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: 'ghostuser', password: 'anything' })
      .expect(401);

    expect(res.body).toHaveProperty('error', 'Invalid credentials');
  });

  it('should return 400 for missing fields (Joi validation)', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ username: '' })
      .expect(400);

    expect(res.body.error).toMatch(/Validation failed/);
  });
});

describe('POST /api/auth/register', () => {
  it('should create a new user when called by admin', async () => {
    const res = await request
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newoperator', password: 'Operator@123', role: 'operator' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.user).toHaveProperty('username', 'newoperator');
    expect(res.body.user).toHaveProperty('role', 'operator');
  });

  it('should return 403 when called by a non-admin (operator)', async () => {
    // Login as the newly created operator
    const loginRes = await request
      .post('/api/auth/login')
      .send({ username: 'newoperator', password: 'Operator@123' })
      .expect(200);

    const operatorToken = loginRes.body.token;

    await request
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ username: 'anotheruser', password: 'Another@123', role: 'operator' })
      .expect(403);
  });

  it('should return 409 for duplicate username', async () => {
    await request
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newoperator', password: 'Different@123', role: 'operator' })
      .expect(409);
  });
});

describe('Protected route access', () => {
  it('should return 401 when accessing a protected route without JWT', async () => {
    await request
      .get('/api/alerts/history')
      .expect(401);
  });

  it('should return 401 when using an invalid JWT', async () => {
    await request
      .get('/api/alerts/history')
      .set('Authorization', 'Bearer invalid.jwt.token')
      .expect(401);
  });
});
