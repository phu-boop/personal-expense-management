import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { before, beforeEach, after, afterEach, describe, it } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Transaction, { TransactionType } from '../models/Transaction';
import Wallet from '../models/Wallet';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import StatementService from './statementService';
import { toDecimal128 } from '../utils/money';
import SnapshotService from './snapshotService';

describe('StatementService', () => {
  let mongoServer: MongoMemoryServer;
  let tenantId: mongoose.Types.ObjectId;
  let userId: mongoose.Types.ObjectId;
  let wallet: any;

  before(async () => {
    // cast to any for compatibility with mongodb-memory-server typings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mongoServer = await MongoMemoryServer.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } } as any);
    process.env.MONGO_URI = mongoServer.getUri();
    await mongoose.connect(process.env.MONGO_URI!);
  });

  beforeEach(async () => {
    await mongoose.connection.db?.dropDatabase();
    tenantId = new mongoose.Types.ObjectId();
    userId = new mongoose.Types.ObjectId();
    wallet = await Wallet.create({ tenantId, userId, name: 'w', initialBalance: toDecimal128('100.00'), initialBalanceDate: new Date('2025-01-01T00:00:00Z'), currentBalance: toDecimal128('100.00'), version: 0 });
  });

  afterEach(async () => {
    await Transaction.deleteMany({});
    await BalanceSnapshot.deleteMany({});
    await Wallet.deleteMany({});
  });

  after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('pagination continuity: page1 -> page2 balances continue', async () => {
    // Create three transactions in period so pagination with limit=1 yields multiple pages
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: TransactionType.INCOME, date: new Date('2026-09-03T01:00:00.000Z') });
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: TransactionType.INCOME, date: new Date('2026-09-03T02:00:00.000Z') });
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('5'), type: TransactionType.EXPENSE, date: new Date('2026-09-03T03:00:00.000Z') });

    // Page 1
    const p1 = await StatementService.computeStatement({ tenantId, userId, walletId: wallet._id, from: new Date('2026-09-03T00:00:00.000Z'), to: new Date('2026-09-04T00:00:00.000Z'), limit: 1, cursor: null });
    const nextCursor = p1.nextCursor as string | null;
    // Page 2 using cursor
    const decoded = nextCursor ? JSON.parse(Buffer.from(nextCursor!, 'base64').toString('utf8')) : null;
    const cursor = decoded ? { date: new Date(decoded.date), createdAt: new Date(decoded.createdAt), _id: new mongoose.Types.ObjectId(decoded._id) } : null;
    const p2 = await StatementService.computeStatement({ tenantId, userId, walletId: wallet._id, from: new Date('2026-09-03T00:00:00.000Z'), to: new Date('2026-09-04T00:00:00.000Z'), limit: 1, cursor });

    // The last transaction of page1 must have balanceAfter equal to first transaction's balanceBefore on page2
    const lastP1 = p1.transactions[p1.transactions.length - 1];
    const firstP2 = p2.transactions[0];
    assert.equal(lastP1.balanceAfter, firstP2.balanceBefore);
  });

  it('basic statement: opening/closing/totals and boundaries', async () => {
    // T1 before from
    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: TransactionType.INCOME, date: new Date('2026-09-02T23:59:59.000Z') });
    // T2 at from
    const t2 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('5'), type: TransactionType.EXPENSE, date: new Date('2026-09-03T00:00:00.000Z') });
    // T3 inside
    const t3 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: TransactionType.INCOME, date: new Date('2026-09-03T12:00:00.000Z') });
    // T4 at to (excluded)
    const t4 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('7'), type: TransactionType.EXPENSE, date: new Date('2026-09-04T00:00:00.000Z') });

    const res = await StatementService.computeStatement({ tenantId, userId, walletId: wallet._id, from: new Date('2026-09-03T00:00:00.000Z'), to: new Date('2026-09-04T00:00:00.000Z'), limit: 10, cursor: null });

    // openingBalance = initial(100) + t1(10) = 110
    assert.equal(res.openingBalance, '110.00');
    // totalIncome inside = t3 = 20
    assert.equal(res.totalIncome, '20.00');
    // totalExpense inside = t2 = 5
    assert.equal(res.totalExpense, '5.00');
    // closing = 110 +20 -5 = 125
    assert.equal(res.closingBalance, '125.00');

    // transactions should include t2 and t3 in canonical order
    assert.equal(res.transactions.length, 2);
    assert.equal(res.transactions[0]._id.toString(), t2._id.toString());
    assert.equal(res.transactions[1]._id.toString(), t3._id.toString());

    // balances before/after
    assert.equal(res.transactions[0].balanceBefore, '110.00');
    assert.equal(res.transactions[0].balanceAfter, '105.00');
    assert.equal(res.transactions[1].balanceBefore, '105.00');
    assert.equal(res.transactions[1].balanceAfter, '125.00');
  });

  it('uses valid snapshot and does not double-count checkpoint', async () => {
    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: 'INCOME', date: new Date('2026-08-01T00:00:00.000Z') });
    const t2 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: 'INCOME', date: new Date('2026-08-15T00:00:00.000Z') });

    // create VALID snapshot that includes t2
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('130.00'), lastTransactionDate: t2.date, lastTransactionCreatedAt: t2.createdAt, lastTransactionId: t2._id, status: BalanceSnapshotStatus.VALID });

    const t3 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('5'), type: 'EXPENSE', date: new Date('2026-09-03T01:00:00.000Z') });

    const res = await StatementService.computeStatement({ tenantId, userId, walletId: wallet._id, from: new Date('2026-09-03T00:00:00.000Z'), to: new Date('2026-09-04T00:00:00.000Z'), limit: 10, cursor: null });

    // openingBalance should be snapshot.balance + effects after snapshot before from (none)
    assert.equal(res.openingBalance, '130.00');
    assert.equal(res.totalIncome, '0.00');
    assert.equal(res.totalExpense, '5.00');
    assert.equal(res.closingBalance, '125.00');
  });

  it('cursor semantics: page1/page2 T1..T4 scenario', async () => {
    // T1 +100, T2 -50, T3 +200, T4 -30
    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('100'), type: 'INCOME', date: new Date('2026-09-01T00:00:00.000Z') });
    const t2 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('50'), type: 'EXPENSE', date: new Date('2026-09-02T00:00:00.000Z') });
    const t3 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('200'), type: 'INCOME', date: new Date('2026-09-03T00:00:00.000Z') });
    const t4 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('30'), type: 'EXPENSE', date: new Date('2026-09-04T00:00:00.000Z') });

    const p1 = await StatementService.computeStatement({ tenantId, userId, walletId: wallet._id, from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-05T00:00:00.000Z'), limit: 2, cursor: null });
    assert.equal(p1.transactions.length, 2);
    const nextCursor = p1.nextCursor as string | null;
    const decoded = nextCursor ? JSON.parse(Buffer.from(nextCursor!, 'base64').toString('utf8')) : null;
    const cursor = decoded ? { date: new Date(decoded.date), createdAt: new Date(decoded.createdAt), _id: new mongoose.Types.ObjectId(decoded._id) } : null;

    const p2 = await StatementService.computeStatement({ tenantId, userId, walletId: wallet._id, from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-05T00:00:00.000Z'), limit: 10, cursor });

    // openingBalance(page2) == balance immediately after T2
    const openingPage2 = p2.openingBalance;
    // initial 100 + t1(100) - t2(50) = 150
    assert.equal(openingPage2, '150.00');

    // Ensure T2 not double-counted and T3 balances correct
    assert.equal(p2.transactions[0]._id.toString(), t3._id.toString());
    assert.equal(p2.transactions[0].balanceBefore, '150.00');
    assert.equal(p2.transactions[0].balanceAfter, '350.00');
    // final running balance after T4 should be 320
    const last = p2.transactions[p2.transactions.length - 1];
    // compute expected final: 150 +200 -30 = 320
    assert.equal(last.balanceAfter, '320.00');
  });

  it('cursor boundary predicate: same date and createdAt tie-breaker uses _id', async () => {
    // Use same date and same createdAt for three txs; ensure ordering falls back to _id
    const sameDate = new Date('2026-09-10T00:00:00.000Z');
    const sameCreatedAt = new Date('2026-09-10T00:00:00.000Z');

    const a = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: 'INCOME', date: sameDate, createdAt: sameCreatedAt });
    const b = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: 'INCOME', date: sameDate, createdAt: sameCreatedAt });
    const c = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('5'), type: 'EXPENSE', date: sameDate, createdAt: sameCreatedAt });

    // page size 2 -> page1 [a,b], page2 [c]
    const p1 = await StatementService.computeStatement({ tenantId, userId, walletId: wallet._id, from: new Date('2026-09-09T00:00:00.000Z'), to: new Date('2026-09-11T00:00:00.000Z'), limit: 2, cursor: null });
    const decoded = p1.nextCursor ? JSON.parse(Buffer.from(p1.nextCursor!, 'base64').toString('utf8')) : null;
    const cursor = decoded ? { date: new Date(decoded.date), createdAt: new Date(decoded.createdAt), _id: new mongoose.Types.ObjectId(decoded._id) } : null;
    const p2 = await StatementService.computeStatement({ tenantId, userId, walletId: wallet._id, from: new Date('2026-09-09T00:00:00.000Z'), to: new Date('2026-09-11T00:00:00.000Z'), limit: 10, cursor });

    // p2 should start with c
    assert.equal(p2.transactions.length, 1);
    assert.equal(p2.transactions[0]._id.toString(), c._id.toString());
  });

  it('snapshot + cursor interaction: snapshot checkpoint not double-counted and page2 opens correctly', async () => {
    // Create T1, T2, T3
    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('50'), type: 'INCOME', date: new Date('2026-08-01T00:00:00.000Z') });
    const t2 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: 'EXPENSE', date: new Date('2026-08-15T00:00:00.000Z') });
    const t3 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('30'), type: 'INCOME', date: new Date('2026-09-03T01:00:00.000Z') });

    // create snapshot at checkpoint after t2
    const checkpoint = { date: t2.date, createdAt: t2.createdAt, id: t2._id };
    const snap = await SnapshotService.createSnapshot(wallet._id, checkpoint, tenantId);

    // Add t4 after snapshot
    const t4 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: 'INCOME', date: new Date('2026-09-03T02:00:00.000Z') });

    // page1 returns t3 only (limit=1)
    const p1 = await StatementService.computeStatement({ tenantId, userId, walletId: wallet._id, from: new Date('2026-09-03T00:00:00.000Z'), to: new Date('2026-09-04T00:00:00.000Z'), limit: 1, cursor: null });
    const decoded = p1.nextCursor ? JSON.parse(Buffer.from(p1.nextCursor!, 'base64').toString('utf8')) : null;
    const cursor = decoded ? { date: new Date(decoded.date), createdAt: new Date(decoded.createdAt), _id: new mongoose.Types.ObjectId(decoded._id) } : null;

    const p2 = await StatementService.computeStatement({ tenantId, userId, walletId: wallet._id, from: new Date('2026-09-03T00:00:00.000Z'), to: new Date('2026-09-04T00:00:00.000Z'), limit: 10, cursor });

    // The snapshot balance should have been used as the base; t3 should not be double-counted
    // Verify p2 openingBalance equals snapshot.balance + effects after snapshot up to cursor
    // For our case, snapshot includes t2; the only effect after snapshot before cursor is none (t3 is the cursor transaction included in page1)
    // So opening for page2 should equal balance after applying transactions up to t3
    const lastP1 = p1.transactions[p1.transactions.length - 1];
    const firstP2 = p2.transactions[0];
    assert.equal(lastP1.balanceAfter, firstP2.balanceBefore);
  });
});
