import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, after } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import { toDecimal128, toDecimal } from '../utils/money';
import { listTransactions } from './transactionService.list';

describe('transactionService.list - openingBalance with snapshots', () => {
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

  it('No snapshot: openingBalance computed from initialBalance + transactions before page start', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'W',
      initialBalance: toDecimal128('100.00'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('100.00'),
      version: 0,
    });

    // T1 +10 at 2026-01-02
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: TransactionType.INCOME, date: new Date('2026-01-02T00:00:00.000Z') });
    // T2 -5 at 2026-01-03
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('5'), type: TransactionType.EXPENSE, date: new Date('2026-01-03T00:00:00.000Z') });
    // T3 +20 at 2026-01-04
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: TransactionType.INCOME, date: new Date('2026-01-04T00:00:00.000Z') });

    // Request page starting at T3 (from=2026-01-04,to=2026-01-05)
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-01-04T00:00:00.000Z'), to: new Date('2026-01-05T00:00:00.000Z') });

    // openingBalance should be 100 + 10 -5 = 105
    assert.equal(res.openingBalance, toDecimal('105').toString());
  });

  it('Valid snapshot: snapshot used and delta computed correctly', async () => {
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

    // create transactions T1..T5
    const dates = [
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z',
      '2026-01-05T00:00:00.000Z',
    ];
    const amounts = ['10', '20', '30', '40', '50'];
    for (let i = 0; i < dates.length; i++) {
      await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128(amounts[i]), type: TransactionType.INCOME, date: new Date(dates[i]) });
    }

    // create VALID snapshot at checkpoint T2 (includes T2)
    const t2 = await Transaction.findOne({ walletId: wallet._id, date: new Date(dates[1]) }).lean();
    const snap = await BalanceSnapshot.create({
      tenantId,
      walletId: wallet._id,
      snapshotAt: new Date(),
      balance: toDecimal128('30'), // T1+T2 = 10+20
      lastTransactionDate: t2.date,
      lastTransactionCreatedAt: t2.createdAt,
      lastTransactionId: t2._id,
      status: BalanceSnapshotStatus.VALID,
    });

    // Request page starting at T5 (from=2026-01-05,to=2026-01-06)
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-01-05T00:00:00.000Z'), to: new Date('2026-01-06T00:00:00.000Z') });

    // snapshot.balance = 30, delta after snapshot up to before T5 = T3+T4 = 30+40 =70
    // openingBalance should be 30 + 70 = 100
    assert.equal(res.openingBalance, toDecimal('100').toString());
  });

  it('Invalid snapshot is not used', async () => {
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

    // create T1, T2
    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: TransactionType.INCOME, date: new Date('2026-01-01T00:00:00.000Z') });
    const t2 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: TransactionType.INCOME, date: new Date('2026-01-02T00:00:00.000Z') });

    // INVALID snapshot at checkpoint T2
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('30'), lastTransactionDate: t2.date, lastTransactionCreatedAt: t2.createdAt, lastTransactionId: t2._id, status: BalanceSnapshotStatus.INVALID });

    // Request page starting at T2 (from=2026-01-02,to=2026-01-03)
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-01-02T00:00:00.000Z'), to: new Date('2026-01-03T00:00:00.000Z') });

    // Since snapshot is INVALID, openingBalance should be computed from initialBalance + transactions before T2 = T1 =10
    assert.equal(res.openingBalance, toDecimal('10').toString());
  });

  it('Multiple snapshots: choose latest VALID strictly before page start', async () => {
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

    // create T1..T6
    const amounts = ['1','2','3','4','5','6'];
    const dates = ['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-06'].map(d=>d+'T00:00:00.000Z');
    for (let i=0;i<6;i++) {
      await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128(amounts[i]), type: TransactionType.INCOME, date: new Date(dates[i]) });
    }

    const t2 = await Transaction.findOne({ walletId: wallet._id, date: new Date(dates[1]) }).lean();
    const t4 = await Transaction.findOne({ walletId: wallet._id, date: new Date(dates[3]) }).lean();

    // snapshot1 at T2 (VALID): sum = 1+2=3
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('3'), lastTransactionDate: t2.date, lastTransactionCreatedAt: t2.createdAt, lastTransactionId: t2._id, status: BalanceSnapshotStatus.VALID });
    // snapshot2 at T4 (VALID): sum = 1+2+3+4=10
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('10'), lastTransactionDate: t4.date, lastTransactionCreatedAt: t4.createdAt, lastTransactionId: t4._id, status: BalanceSnapshotStatus.VALID });

    // Request page starting at T6 (from=2026-01-06,to=2026-01-07)
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date(dates[5]), to: new Date('2026-01-07T00:00:00.000Z') });

    // latest VALID snapshot strictly before T6 is snapshot2 with balance=10; delta = T5 =5 => openingBalance=15
    assert.equal(res.openingBalance, toDecimal('15').toString());
  });

  it('Same-date transactions: ordering uses (date, createdAt, _id) and no skip/double-count', async () => {
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

    const date = new Date('2026-01-02T12:00:00.000Z');
    // create T1 and T2 with same date but different createdAt/_id via sequence
    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: TransactionType.INCOME, date });
    // small delay to ensure different createdAt
    await new Promise(r=>setTimeout(r,5));
    const t2 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: TransactionType.INCOME, date });

    // snapshot at checkpoint t1
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('10'), lastTransactionDate: t1.date, lastTransactionCreatedAt: t1.createdAt, lastTransactionId: t1._id, status: BalanceSnapshotStatus.VALID });

    // Request page starting after t1 (use cursor at t1) so page returns only t2
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: { date: t1.date, createdAt: t1.createdAt, _id: t1._id }, from: date, to: new Date('2026-01-03T00:00:00.000Z') });

    // openingBalance should be 10 (snapshot includes t1 only)
    assert.equal(res.openingBalance, toDecimal('10').toString());

    // returned transactions should include t2 and its balanceBefore should be 10
    assert.equal(res.transactions.length, 1);
    assert.equal(res.transactions[0]._id.toString(), t2._id.toString());
    assert.equal(res.transactions[0].balanceBefore, toDecimal('10').toString());
    assert.equal(res.transactions[0].balanceAfter, toDecimal('30').toString());
  });

  it('Cursor pagination: page2 openingBalance equals balance immediately before first tx of page2', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('100'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('100'), version: 0 });

    // create 3 transactions
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: TransactionType.INCOME, date: new Date('2026-01-02T00:00:00.000Z') });
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: TransactionType.INCOME, date: new Date('2026-01-03T00:00:00.000Z') });
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('30'), type: TransactionType.INCOME, date: new Date('2026-01-04T00:00:00.000Z') });

    // pageSize=2 -> page1 has first 2 transactions
    const page1 = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 2, cursor: undefined, from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-01-10T00:00:00.000Z') });
    assert.equal(page1.transactions.length, 2);
    const cursor = page1.nextCursor;
    // page2
    const decoded = JSON.parse(Buffer.from(cursor!, 'base64').toString('utf8'));
    const page2 = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 2, cursor: { date: new Date(decoded.date), createdAt: new Date(decoded.createdAt), _id: new mongoose.Types.ObjectId(decoded._id) }, from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-01-10T00:00:00.000Z') });

    // openingBalance page2 should be balance after first two transactions: 100 +10+20 =130
    assert.equal(page2.openingBalance, toDecimal('130').toString());
  });

  it('Checkpoint transaction is included in snapshot and not double-counted', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('0'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('0'), version: 0 });

    // create T1 (10), T2 (20)
    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: TransactionType.INCOME, date: new Date('2026-01-01T00:00:00.000Z') });
    const t2 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: TransactionType.INCOME, date: new Date('2026-01-02T00:00:00.000Z') });

    // snapshot at t2 includes t2
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('30'), lastTransactionDate: t2.date, lastTransactionCreatedAt: t2.createdAt, lastTransactionId: t2._id, status: BalanceSnapshotStatus.VALID });

    // request page starting after t2 (from = 2026-01-03)
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-01-03T00:00:00.000Z'), to: new Date('2026-01-04T00:00:00.000Z') });

    // openingBalance should be 30 (snapshot included t2) and not 30 + t2
    assert.equal(res.openingBalance, toDecimal('30').toString());
  });

  it('Historical date edit invalidation path (if supported): edited snapshot becomes INVALID', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('0'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('0'), version: 0 });

    // create T1(10), T2(20)
    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('10'), type: TransactionType.INCOME, date: new Date('2026-01-01T00:00:00.000Z') });
    const t2 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('20'), type: TransactionType.INCOME, date: new Date('2026-01-02T00:00:00.000Z') });

    // snapshot at t2 VALID
    const snap = await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('30'), lastTransactionDate: t2.date, lastTransactionCreatedAt: t2.createdAt, lastTransactionId: t2._id, status: BalanceSnapshotStatus.VALID });

    // Simulate historical edit that invalidates snapshot: mark snapshot INVALID
    await BalanceSnapshot.updateOne({ _id: snap._id }, { $set: { status: BalanceSnapshotStatus.INVALID } });

    // now request page starting at t2
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-01-02T00:00:00.000Z'), to: new Date('2026-01-03T00:00:00.000Z') });
    // since snapshot invalid, openingBalance should be computed from initialBalance + transactions before t2 = t1 =10
    assert.equal(res.openingBalance, toDecimal('10').toString());
  });

  it('Derived balances: income and expense basic cases', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('10000000'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('10000000'), version: 0 });

    // income
    const tIncome = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('5000000'), type: TransactionType.INCOME, date: new Date('2026-02-01T00:00:00.000Z') });
    let res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-02-01T00:00:00.000Z'), to: new Date('2026-02-02T00:00:00.000Z') });
    assert.equal(res.transactions.length, 1);
    assert.equal(res.transactions[0]._id.toString(), tIncome._id.toString());
    assert.equal(res.transactions[0].balanceBefore, toDecimal('10000000').toString());
    assert.equal(res.transactions[0].balanceAfter, toDecimal('15000000').toString());

    // expense
    const tExpense = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('2000000'), type: TransactionType.EXPENSE, date: new Date('2026-02-03T00:00:00.000Z') });
    res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-02-03T00:00:00.000Z'), to: new Date('2026-02-04T00:00:00.000Z') });
    assert.equal(res.transactions.length, 1);
    // openingBalance at expense page should reflect initial + income = 15,000,000
    assert.equal(res.transactions[0].balanceBefore, toDecimal('15000000').toString());
    assert.equal(res.transactions[0].balanceAfter, toDecimal('13000000').toString());
  });

  it('Derived balances: sequential transactions apply in canonical order', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('10000000'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('10000000'), version: 0 });

    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('5000000'), type: TransactionType.INCOME, date: new Date('2026-03-01T00:00:00.000Z') });
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('2000000'), type: TransactionType.EXPENSE, date: new Date('2026-03-02T00:00:00.000Z') });
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('3000000'), type: TransactionType.INCOME, date: new Date('2026-03-03T00:00:00.000Z') });

    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-03-01T00:00:00.000Z'), to: new Date('2026-03-04T00:00:00.000Z') });
    assert.equal(res.transactions.length, 3);
    // T1
    assert.equal(res.transactions[0].balanceBefore, toDecimal('10000000').toString());
    assert.equal(res.transactions[0].balanceAfter, toDecimal('15000000').toString());
    // T2
    assert.equal(res.transactions[1].balanceBefore, toDecimal('15000000').toString());
    assert.equal(res.transactions[1].balanceAfter, toDecimal('13000000').toString());
    // T3
    assert.equal(res.transactions[2].balanceBefore, toDecimal('13000000').toString());
    assert.equal(res.transactions[2].balanceAfter, toDecimal('16000000').toString());
  });

  it('Derived balances with snapshot checkpoint are applied correctly and checkpoint not double-counted', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('0'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('0'), version: 0 });

    const t0 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('1000000'), type: TransactionType.INCOME, date: new Date('2026-04-01T00:00:00.000Z') });
    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('1000000'), type: TransactionType.INCOME, date: new Date('2026-04-02T00:00:00.000Z') });

    // create snapshot at t1 (includes t1)
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('2000000'), lastTransactionDate: t1.date, lastTransactionCreatedAt: t1.createdAt, lastTransactionId: t1._id, status: BalanceSnapshotStatus.VALID });

    // transactions after snapshot
    const t2 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('1000000'), type: TransactionType.EXPENSE, date: new Date('2026-04-03T00:00:00.000Z') });
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-04-03T00:00:00.000Z'), to: new Date('2026-04-04T00:00:00.000Z') });
    assert.equal(res.transactions.length, 1);
    // openingBalance should be snapshot.balance = 2000000
    assert.equal(res.openingBalance, toDecimal('2000000').toString());
    // t2 before/after
    assert.equal(res.transactions[0].balanceBefore, toDecimal('2000000').toString());
    assert.equal(res.transactions[0].balanceAfter, toDecimal('1000000').toString());
  });

  it('Snapshot selection regression: choose older snapshot when newest is after page start', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('0'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('0'), version: 0 });

    // create transactions T100, T150, T200
    const t100 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('100'), type: TransactionType.INCOME, date: new Date('2026-06-10T00:00:00.000Z') });
    const t150 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('150'), type: TransactionType.INCOME, date: new Date('2026-06-15T00:00:00.000Z') });
    const t200 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('200'), type: TransactionType.INCOME, date: new Date('2026-06-20T00:00:00.000Z') });

    // snapshot A at t100 (older)
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('100'), lastTransactionDate: t100.date, lastTransactionCreatedAt: t100.createdAt, lastTransactionId: t100._id, status: BalanceSnapshotStatus.VALID });
    // snapshot B at t200 (newer)
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('450'), lastTransactionDate: t200.date, lastTransactionCreatedAt: t200.createdAt, lastTransactionId: t200._id, status: BalanceSnapshotStatus.VALID });

    // Request page starting at T150 -> should pick snapshot A (t100) not B (t200)
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-06-15T00:00:00.000Z'), to: new Date('2026-06-16T00:00:00.000Z') });
    // openingBalance should be snapshot A (100) + effects between t100 and before t150 (none) = 100
    assert.equal(res.openingBalance, toDecimal('100').toString());
  });

  it('Snapshot selection regression: snapshot exactly equals page start is NOT used', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('0'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('0'), version: 0 });

    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('100'), type: TransactionType.INCOME, date: new Date('2026-07-01T00:00:00.000Z') });
    // snapshot at t1
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('100'), lastTransactionDate: t1.date, lastTransactionCreatedAt: t1.createdAt, lastTransactionId: t1._id, status: BalanceSnapshotStatus.VALID });

    // Request page starting at t1 -> snapshot must NOT be used; openingBalance should be computed from initial + transactions before t1 = 0
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: t1.date, to: new Date('2026-07-02T00:00:00.000Z') });
    assert.equal(res.openingBalance, toDecimal('0').toString());
  });

  it('Snapshot selection regression: no usable snapshot when all snapshots are after page start', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('0'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('0'), version: 0 });

    const t100 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('100'), type: TransactionType.INCOME, date: new Date('2026-08-10T00:00:00.000Z') });
    const t200 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('200'), type: TransactionType.INCOME, date: new Date('2026-08-20T00:00:00.000Z') });

    // snapshot only at t200
    await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('300'), lastTransactionDate: t200.date, lastTransactionCreatedAt: t200.createdAt, lastTransactionId: t200._id, status: BalanceSnapshotStatus.VALID });

    // Request page starting at T150 -> no usable snapshot, openingBalance should be initial + effects before T150 = T100 = 100
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-08-15T00:00:00.000Z'), to: new Date('2026-08-16T00:00:00.000Z') });
    assert.equal(res.openingBalance, toDecimal('100').toString());
  });

  it('Decimal/aggregate failure must throw instead of returning incorrect balance', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('0'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('0'), version: 0 });

    // create a transaction with malformed amount that will break aggregation parsing when converting to Decimal
    // We simulate this by inserting a document with amount as string that cannot be parsed; but since schema uses Decimal128,
    // forcibly update the raw DB to set a non-numeric value to provoke parsing error path.
    const t1 = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('100'), type: TransactionType.INCOME, date: new Date('2026-09-01T00:00:00.000Z') });
    // directly update the aggregation result by inserting a bogus document in the collection used for aggregate
    await Transaction.collection.insertOne({ tenantId, userId, walletId: wallet._id, amount: 'not-a-number', type: 'INCOME', date: new Date('2026-09-02T00:00:00.000Z'), createdAt: new Date(), updatedAt: new Date() });

    let threw = false;
    try {
      await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-09-02T00:00:00.000Z'), to: new Date('2026-09-03T00:00:00.000Z') });
    } catch (err) {
      threw = true;
    }
    assert.equal(threw, true);
  });

  it('Pagination: page2 derived balances independent and correct', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('100000'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('100000'), version: 0 });

    // create 4 transactions
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('1000'), type: TransactionType.INCOME, date: new Date('2026-05-01T00:00:00.000Z') });
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('2000'), type: TransactionType.INCOME, date: new Date('2026-05-02T00:00:00.000Z') });
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('3000'), type: TransactionType.INCOME, date: new Date('2026-05-03T00:00:00.000Z') });
    await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('4000'), type: TransactionType.INCOME, date: new Date('2026-05-04T00:00:00.000Z') });

    const page1 = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 2, cursor: undefined, from: new Date('2026-05-01T00:00:00.000Z'), to: new Date('2026-05-10T00:00:00.000Z') });
    assert.equal(page1.transactions.length, 2);
    const cursor = page1.nextCursor!;
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    const page2 = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 2, cursor: { date: new Date(decoded.date), createdAt: new Date(decoded.createdAt), _id: new mongoose.Types.ObjectId(decoded._id) }, from: new Date('2026-05-01T00:00:00.000Z'), to: new Date('2026-05-10T00:00:00.000Z') });

    // page2 openingBalance should equal balance after first two transactions
    assert.equal(page2.openingBalance, toDecimal('103000').toString());
    // first tx on page2 balanceBefore should equal openingBalance
    assert.equal(page2.transactions[0].balanceBefore, page2.openingBalance);
  });

  it('DB integrity: transactions are not mutated with balanceBefore/After fields', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'W', initialBalance: toDecimal128('1000'), initialBalanceDate: new Date('2026-06-01T00:00:00.000Z'), currentBalance: toDecimal128('1000'), version: 0 });
    const t = await Transaction.create({ tenantId, userId, walletId: wallet._id, amount: toDecimal128('100'), type: TransactionType.INCOME, date: new Date('2026-06-02T00:00:00.000Z') });
    const res = await listTransactions({ tenantId, userId, walletId: wallet._id, limit: 10, cursor: undefined, from: new Date('2026-06-02T00:00:00.000Z'), to: new Date('2026-06-03T00:00:00.000Z') });
    // ensure DB document does not contain balanceBefore/balanceAfter
    const doc = await Transaction.findById(t._id).lean();
    // @ts-ignore
    assert.equal(typeof doc.balanceBefore, 'undefined');
    // @ts-ignore
    assert.equal(typeof doc.balanceAfter, 'undefined');
    // response contains derived fields
    assert.equal(res.transactions[0].balanceBefore !== undefined, true);
    assert.equal(res.transactions[0].balanceAfter !== undefined, true);
  });
  

});
