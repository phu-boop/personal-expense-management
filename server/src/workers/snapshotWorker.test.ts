import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, after } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import { toDecimal128 } from '../utils/money';
import { createSnapshotIfNeeded } from './snapshotWorker';

describe('snapshotWorker', () => {
  let mongoServer: MongoMemoryServer;

  before(async () => {
    mongoServer = await MongoMemoryServer.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    process.env.MONGO_URI = mongoServer.getUri();
    await mongoose.connect(process.env.MONGO_URI!);
  });

  beforeEach(async () => {
    await mongoose.connection.db?.dropDatabase();
  });

  after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('does not create snapshot if interval not reached', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'W',
      initialBalance: toDecimal128('0'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('0'),
      version: 0,
    });

    // Create 10 transactions
    for (let i = 0; i < 10; i++) {
      await Transaction.create({
        tenantId,
        userId,
        walletId: wallet._id,
        amount: toDecimal128('1'),
        type: TransactionType.INCOME,
        date: new Date(2026, 0, 1, 0, i),
      });
    }

    const res = await createSnapshotIfNeeded(wallet._id, { tenantId, snapshotInterval: 50 });
    assert.equal(res.created, false);
  });

  it('creates snapshot when interval reached using latest transaction as checkpoint', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'W',
      initialBalance: toDecimal128('0'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('0'),
      version: 0,
    });

    // Create 60 transactions
    for (let i = 0; i < 60; i++) {
      await Transaction.create({
        tenantId,
        userId,
        walletId: wallet._id,
        amount: toDecimal128('1'),
        type: TransactionType.INCOME,
        date: new Date(2026, 0, 1, 0, i),
      });
    }

    const res = await createSnapshotIfNeeded(wallet._id, { tenantId, snapshotInterval: 50 });
    assert.equal(res.created, true);
  });
});
