import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import Wallet from '../models/Wallet';
import Transaction from '../models/Transaction';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-transaction-api-1234567890';

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

describe('Transaction API', () => {
  let mongoServer: MongoMemoryServer;
  let app: express.Express;
  let token: string;
  let userId: string;
  let tenantId: string;
  let walletId: string;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await mongoose.connect(process.env.MONGO_URI!);

    userId = new mongoose.Types.ObjectId().toHexString();
    tenantId = new mongoose.Types.ObjectId().toHexString();
    token = buildToken(userId, tenantId);

    const { default: transactionRouter } = await import('../routes/transaction');

    app = express();
    app.use(express.json());
    app.use('/api/wallets', transactionRouter);

    const wallet = await Wallet.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      userId: new mongoose.Types.ObjectId(userId),
      name: 'Main Wallet',
      initialBalance: mongoose.Types.Decimal128.fromString('1000'),
      initialBalanceDate: new Date('2025-01-01T00:00:00Z'),
      currentBalance: mongoose.Types.Decimal128.fromString('1000'),
      version: 0,
    });

    walletId = wallet._id.toString();
  });

  beforeEach(async () => {
    await mongoose.connection.db?.dropDatabase();

    const wallet = await Wallet.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      userId: new mongoose.Types.ObjectId(userId),
      name: 'Main Wallet',
      initialBalance: mongoose.Types.Decimal128.fromString('1000'),
      initialBalanceDate: new Date('2025-01-01T00:00:00Z'),
      currentBalance: mongoose.Types.Decimal128.fromString('1000'),
      version: 0,
    });

    walletId = wallet._id.toString();
  });

  after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('POST /api/wallets/:walletId/transactions creates a transaction and returns the created document', async () => {
    const response = await request(app)
      .post(`/api/wallets/${walletId}/transactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: '250.50',
        type: 'INCOME',
        date: '2026-01-15T12:00:00Z',
        note: 'bonus',
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.transaction.amount.$numberDecimal, '250.50');
    assert.equal(response.body.transaction.type, 'INCOME');
    assert.equal(response.body.transaction.note, 'bonus');
  });

  it('GET /api/wallets/:walletId/transactions returns canonical ordering, openingBalance and balanceBefore/balanceAfter', async () => {
    await Transaction.create([
      {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        userId: new mongoose.Types.ObjectId(userId),
        walletId: new mongoose.Types.ObjectId(walletId),
        amount: mongoose.Types.Decimal128.fromString('100'),
        type: 'INCOME',
        date: new Date('2026-01-01T00:00:00Z'),
        note: 'first',
      },
      {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        userId: new mongoose.Types.ObjectId(userId),
        walletId: new mongoose.Types.ObjectId(walletId),
        amount: mongoose.Types.Decimal128.fromString('50'),
        type: 'EXPENSE',
        date: new Date('2026-01-01T00:00:00Z'),
        note: 'second',
      },
    ]);

    const response = await request(app)
      .get(`/api/wallets/${walletId}/transactions`)
      .set('Authorization', `Bearer ${token}`)
      .query({
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T00:00:00Z',
        limit: 10,
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.transactions.length, 2);
    assert.equal(response.body.openingBalance, '1000');
    assert.equal(response.body.transactions[0].balanceBefore, '1000');
    assert.equal(response.body.transactions[0].balanceAfter, '1100');
    assert.equal(response.body.transactions[1].balanceBefore, '1100');
    assert.equal(response.body.transactions[1].balanceAfter, '1050');
  });
});
