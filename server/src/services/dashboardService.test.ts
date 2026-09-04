import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, after } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import { toDecimal128 } from '../utils/money';
import { getDashboard } from './dashboardService';

describe('dashboardService', () => {
  let mongoServer: MongoMemoryServer;

  before(async () => {
    mongoServer = await MongoMemoryServer.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } } as any);
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

  it('returns aggregated dashboard metrics for the current month', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const walletA = await Wallet.create({
      tenantId,
      userId,
      name: 'Cash',
      initialBalance: toDecimal128('1000'),
      initialBalanceDate: new Date(),
      currentBalance: toDecimal128('1200'),
      version: 0,
    });

    const walletB = await Wallet.create({
      tenantId,
      userId,
      name: 'Savings',
      initialBalance: toDecimal128('500'),
      initialBalanceDate: new Date(),
      currentBalance: toDecimal128('800'),
      version: 0,
    });

    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const secondDay = new Date(now.getFullYear(), now.getMonth(), 2, 0, 0, 0, 0);
    const thirdDay = new Date(now.getFullYear(), now.getMonth(), 3, 0, 0, 0, 0);

    await Transaction.create({
      tenantId,
      userId,
      walletId: walletA._id,
      amount: toDecimal128('300'),
      type: TransactionType.INCOME,
      date: secondDay,
    });

    await Transaction.create({
      tenantId,
      userId,
      walletId: walletA._id,
      amount: toDecimal128('100'),
      type: TransactionType.EXPENSE,
      date: thirdDay,
    });

    await Transaction.create({
      tenantId,
      userId,
      walletId: walletB._id,
      amount: toDecimal128('250'),
      type: TransactionType.EXPENSE,
      date: secondDay,
    });

    await Transaction.create({
      tenantId,
      userId,
      walletId: walletB._id,
      amount: toDecimal128('500'),
      type: TransactionType.INCOME,
      date: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 10),
    });

    const dashboard = await getDashboard({ tenantId, userId });

    assert.equal(dashboard.totalBalance, '2000.00');
    assert.equal(dashboard.activeWallets, 2);
    assert.equal(dashboard.incomeThisMonth, '300.00');
    assert.equal(dashboard.expenseThisMonth, '350.00');
    assert.equal(dashboard.netThisMonth, '-50.00');
    assert.ok(Array.isArray(dashboard.recentTransactions));
    assert.ok(Array.isArray(dashboard.monthlyTrend));
    assert.ok(Array.isArray(dashboard.categoryBreakdown));
    assert.ok(dashboard.recentTransactions.length >= 3);
    assert.equal(dashboard.recentTransactions[0].walletId.toString(), walletA._id.toString() || dashboard.recentTransactions[0].walletId.toString());
    assert.ok(dashboard.monthlyTrend.some((item) => item.month === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`));
  });
});
