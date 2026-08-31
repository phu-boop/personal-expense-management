import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-wallet-api-1234567890';

const buildToken = (userId: string, tenantId: string) =>
  jwt.sign(
    {
      id: userId,
      email: `${userId}@example.com`,
      tenantId,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' },
  );

describe('Wallet API', () => {
  let mongoServer: MongoMemoryServer;
  let app: express.Express;
  let tokenForUser1: string;
  let tokenForUser2: string;
  let userId1: string;
  let userId2: string;
  let tenantId1: string;
  let tenantId2: string;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await mongoose.connect(process.env.MONGO_URI!);

    userId1 = new mongoose.Types.ObjectId().toHexString();
    userId2 = new mongoose.Types.ObjectId().toHexString();
    tenantId1 = new mongoose.Types.ObjectId().toHexString();
    tenantId2 = new mongoose.Types.ObjectId().toHexString();

    tokenForUser1 = buildToken(userId1, tenantId1);
    tokenForUser2 = buildToken(userId2, tenantId2);

    const { default: walletRouter } = await import('../routes/wallet');

    app = express();
    app.use(express.json());
    app.use('/api/wallets', walletRouter);
  });

  beforeEach(async () => {
    await mongoose.connection.db?.dropDatabase();
  });

  after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('POST /api/wallets creates a wallet for the authenticated tenant and user', async () => {
    const response = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${tokenForUser1}`)
      .send({
        name: 'Main Wallet',
        accountNumber: '123456',
        initialBalance: '1000.50',
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.name, 'Main Wallet');
    assert.equal(response.body.data.currentBalance?.$numberDecimal, '1000.50');
  });

  it('GET /api/wallets returns only wallets for the authenticated tenant and user and supports cursor pagination', async () => {
    await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${tokenForUser1}`)
      .send({ name: 'Wallet A', initialBalance: '100.00' });

    await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${tokenForUser1}`)
      .send({ name: 'Wallet B', initialBalance: '250.00' });

    await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${tokenForUser2}`)
      .send({ name: 'Other Tenant Wallet', initialBalance: '999.99' });

    const firstPage = await request(app)
      .get('/api/wallets')
      .set('Authorization', `Bearer ${tokenForUser1}`)
      .query({ limit: 1 });

    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body.success, true);
    assert.equal(firstPage.body.data.items.length, 1);
    assert.equal(firstPage.body.data.hasMore, true);
    assert.ok(typeof firstPage.body.data.nextCursor === 'string');

    const secondPage = await request(app)
      .get('/api/wallets')
      .set('Authorization', `Bearer ${tokenForUser1}`)
      .query({
        limit: 1,
        cursor: firstPage.body.data.nextCursor,
      });

    assert.equal(secondPage.status, 200);
    assert.equal(secondPage.body.data.items.length, 1);
    assert.equal(secondPage.body.data.hasMore, false);
  });

  it('GET /api/wallets/:walletId rejects wallets outside the authenticated tenant and user', async () => {
    const created = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${tokenForUser1}`)
      .send({ name: 'Private Wallet', initialBalance: '300.00' });

    const response = await request(app)
      .get(`/api/wallets/${created.body.data._id}`)
      .set('Authorization', `Bearer ${tokenForUser2}`);

    assert.equal(response.status, 404);
    assert.equal(response.body.success, false);
  });
});
