import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, after } from 'node:test';
import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import { toDecimal128 } from '../utils/money';
import SnapshotService from './snapshotService';

describe('snapshotService', () => {
  let mongoServer: MongoMemoryServer;

  before(async () => {
    mongoServer = await MongoMemoryServer.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
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

  it('creates snapshot with balance including checkpoint transaction', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'Main',
      initialBalance: toDecimal128('1000'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('1000'),
      version: 0,
    });

    // A +100
    await Transaction.create({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: toDecimal128('100'),
      type: TransactionType.INCOME,
      date: new Date('2026-01-02T00:00:00.000Z'),
    });

    // B -50
    await Transaction.create({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: toDecimal128('50'),
      type: TransactionType.EXPENSE,
      date: new Date('2026-01-02T01:00:00.000Z'),
    });

    // C +200 <- checkpoint
    const checkpointTx = await Transaction.create({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: toDecimal128('200'),
      type: TransactionType.INCOME,
      date: new Date('2026-01-02T02:00:00.000Z'),
    });

    const checkpoint = {
      date: checkpointTx.date,
      createdAt: checkpointTx.createdAt,
      id: checkpointTx._id,
    } as any;

    const snapshot = await SnapshotService.createSnapshot(wallet._id, checkpoint, tenantId);

    assert.equal(snapshot.balance.toString(), '1250.00'); // 1000 +100 -50 +200
    assert.equal(snapshot.lastTransactionId.toString(), checkpointTx._id.toString());
  });
});
