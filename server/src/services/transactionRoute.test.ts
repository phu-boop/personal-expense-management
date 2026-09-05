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

    const { default: transactionRouter, allTransactionsRouter } = await import('../routes/transaction');
    const categoryRoutes = (await import('../routes/category')).default;

    app = express();
    app.use(express.json());
    app.use('/api', categoryRoutes);
    app.use('/api', allTransactionsRouter);
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

  it('GET /api/wallets/:walletId/transactions returns newest-first for display order while preserving openingBalance', async () => {
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
    assert.equal(response.body.transactions[0].note, 'second');
    assert.equal(response.body.transactions[1].note, 'first');
    assert.equal(response.body.transactions[0].balanceBefore, '1100');
    assert.equal(response.body.transactions[0].balanceAfter, '1050');
    assert.equal(response.body.transactions[1].balanceBefore, '1000');
    assert.equal(response.body.transactions[1].balanceAfter, '1100');
  });

  it('GET /api/wallets/:walletId/transactions returns newest-first for display order', async () => {
    await Transaction.create([
      {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        userId: new mongoose.Types.ObjectId(userId),
        walletId: new mongoose.Types.ObjectId(walletId),
        amount: mongoose.Types.Decimal128.fromString('50'),
        type: 'EXPENSE',
        date: new Date('2026-01-10T00:00:00Z'),
        note: 'older',
      },
      {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        userId: new mongoose.Types.ObjectId(userId),
        walletId: new mongoose.Types.ObjectId(walletId),
        amount: mongoose.Types.Decimal128.fromString('25'),
        type: 'INCOME',
        date: new Date('2026-01-15T00:00:00Z'),
        note: 'newer',
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
    assert.equal(response.body.transactions[0].note, 'newer');
    assert.equal(response.body.transactions[1].note, 'older');
  });

  it('GET /api/categories returns the user category catalog', async () => {
    const response = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.categories));
    assert.ok(response.body.categories.some((cat: any) => cat.name === 'Food & Drink'));
    assert.ok(response.body.categories.some((cat: any) => cat.name === 'Salary'));
  });

  it('GET /api/transactions returns transactions across all wallets for the authenticated user', async () => {
    const walletA = await Wallet.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      userId: new mongoose.Types.ObjectId(userId),
      name: 'Wallet A',
      initialBalance: mongoose.Types.Decimal128.fromString('1000'),
      initialBalanceDate: new Date('2025-01-01T00:00:00Z'),
      currentBalance: mongoose.Types.Decimal128.fromString('1000'),
      version: 0,
    });

    const walletB = await Wallet.create({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      userId: new mongoose.Types.ObjectId(userId),
      name: 'Wallet B',
      initialBalance: mongoose.Types.Decimal128.fromString('2000'),
      initialBalanceDate: new Date('2025-01-01T00:00:00Z'),
      currentBalance: mongoose.Types.Decimal128.fromString('2000'),
      version: 0,
    });

    await Transaction.create([
      {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        userId: new mongoose.Types.ObjectId(userId),
        walletId: walletA._id,
        amount: mongoose.Types.Decimal128.fromString('100'),
        type: 'INCOME',
        date: new Date('2026-02-01T00:00:00Z'),
        note: 'wallet a income',
      },
      {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        userId: new mongoose.Types.ObjectId(userId),
        walletId: walletB._id,
        amount: mongoose.Types.Decimal128.fromString('75'),
        type: 'EXPENSE',
        date: new Date('2026-02-02T00:00:00Z'),
        note: 'wallet b expense',
      },
    ]);

    const response = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .query({
        from: '2026-01-01T00:00:00Z',
        to: '2026-12-31T00:00:00Z',
        limit: 10,
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.transactions.length, 2);
    assert.equal(response.body.transactions[0].walletId.name, 'Wallet B');
    assert.equal(response.body.transactions[1].walletId.name, 'Wallet A');
    assert.equal(response.body.openingBalance, null);
  });
});
