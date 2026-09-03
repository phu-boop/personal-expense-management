import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import { createTransaction, editTransaction, InsufficientBalanceError } from './transactionService';
import { toDecimal, toDecimal128 } from '../utils/money';

describe('transactionService', () => {
  let mongoServer: MongoMemoryServer;

  before(async () => {
    // mongodb-memory-server typings differ; cast to any for test runtime options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  it('creates a transaction and updates wallet currentBalance', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'Main wallet',
      initialBalance: toDecimal128('1000'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('1000'),
      version: 0,
    });

    const tx = await createTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: '250.50',
      type: TransactionType.INCOME,
      date: new Date('2026-01-02T00:00:00.000Z'),
    });

    assert.equal(tx.type, TransactionType.INCOME);

    const refreshedWallet = await Wallet.findById(wallet._id).lean();
    assert.ok(refreshedWallet);
    assert.equal(refreshedWallet!.currentBalance.toString(), '1250.50');
  });

  it('rejects an expense that would make wallet balance negative', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'Main wallet',
      initialBalance: toDecimal128('100'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('100'),
      version: 0,
    });

    await assert.rejects(
      () => createTransaction({
        tenantId,
        userId,
        walletId: wallet._id,
        amount: '200',
        type: TransactionType.EXPENSE,
        date: new Date('2026-01-02T00:00:00.000Z'),
      }),
      (err: unknown) => err instanceof InsufficientBalanceError,
    );
  });

  it('edits a transaction and only changes wallet balance by the delta', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'Main wallet',
      initialBalance: toDecimal128('1000'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('1000'),
      version: 0,
    });

    const created = await createTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: '100',
      type: TransactionType.EXPENSE,
      date: new Date('2026-01-02T00:00:00.000Z'),
    });

    const updated = await editTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      transactionId: created._id,
      amount: '250',
      type: TransactionType.EXPENSE,
    });

    assert.equal(updated.amount.toString(), '250.00');

    const refreshedWallet = await Wallet.findById(wallet._id).lean();
    assert.ok(refreshedWallet);
    assert.equal(refreshedWallet!.currentBalance.toString(), '750.00');

    await editTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      transactionId: created._id,
      date: new Date('2026-01-03T00:00:00.000Z'),
    });

    const refreshedWalletAfterDateOnlyEdit = await Wallet.findById(wallet._id).lean();
    assert.ok(refreshedWalletAfterDateOnlyEdit);
    assert.equal(refreshedWalletAfterDateOnlyEdit!.currentBalance.toString(), '750.00');
  });

  it('updates note without changing wallet balance', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'Main wallet',
      initialBalance: toDecimal128('1000'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('1000'),
      version: 0,
    });

    const created = await createTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: '100',
      type: TransactionType.INCOME,
      date: new Date('2026-01-02T00:00:00.000Z'),
    });

    await editTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      transactionId: created._id,
      note: 'updated note',
    });

    const refreshedWallet = await Wallet.findById(wallet._id).lean();
    assert.ok(refreshedWallet);
    assert.equal(refreshedWallet!.currentBalance.toString(), '1100.00');

    const refreshedTx = await Transaction.findById(created._id).lean();
    assert.equal(refreshedTx?.note, 'updated note');
  });

  it('marks valid snapshots invalid when amount or date changes and preserves note-only edits', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'Main wallet',
      initialBalance: toDecimal128('1000'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('1000'),
      version: 0,
    });

    const firstTx = await createTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: '100',
      type: TransactionType.INCOME,
      date: new Date('2026-01-02T00:00:00.000Z'),
    });

    const snapshot = await BalanceSnapshot.create({
      tenantId,
      walletId: wallet._id,
      snapshotAt: new Date('2026-01-03T00:00:00.000Z'),
      balance: toDecimal128('1100'),
      lastTransactionDate: firstTx.date,
      lastTransactionCreatedAt: firstTx.createdAt,
      lastTransactionId: firstTx._id,
      status: BalanceSnapshotStatus.VALID,
    });

    await editTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      transactionId: firstTx._id,
      note: 'updated',
    });

    const noteOnlySnapshot = await BalanceSnapshot.findById(snapshot._id).lean();
    assert.equal(noteOnlySnapshot?.status, BalanceSnapshotStatus.VALID);

    await editTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      transactionId: firstTx._id,
      amount: '250',
    });

    const invalidatedSnapshot = await BalanceSnapshot.findById(snapshot._id).lean();
    assert.equal(invalidatedSnapshot?.status, BalanceSnapshotStatus.INVALID);

    await editTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      transactionId: firstTx._id,
      date: new Date('2026-01-04T00:00:00.000Z'),
    });

    const afterDateMove = await BalanceSnapshot.findById(snapshot._id).lean();
    assert.equal(afterDateMove?.status, BalanceSnapshotStatus.INVALID);
  });

  it('invalidates only valid snapshots for affected tenant and wallet, and leaves invalid snapshots alone', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const otherTenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'Wallet 1',
      initialBalance: toDecimal128('500'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('500'),
      version: 0,
    });

    const otherWallet = await Wallet.create({
      tenantId,
      userId,
      name: 'Wallet 2',
      initialBalance: toDecimal128('500'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('500'),
      version: 0,
    });

    const tx = await createTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      amount: '100',
      type: TransactionType.INCOME,
      date: new Date('2026-01-02T00:00:00.000Z'),
    });

    const validSameWallet = await BalanceSnapshot.create({
      tenantId,
      walletId: wallet._id,
      snapshotAt: new Date('2026-01-03T00:00:00.000Z'),
      balance: toDecimal128('600'),
      lastTransactionDate: tx.date,
      lastTransactionCreatedAt: tx.createdAt,
      lastTransactionId: tx._id,
      status: BalanceSnapshotStatus.VALID,
    });

    const invalidSameWallet = await BalanceSnapshot.create({
      tenantId,
      walletId: wallet._id,
      snapshotAt: new Date('2026-01-04T00:00:00.000Z'),
      balance: toDecimal128('700'),
      lastTransactionDate: tx.date,
      lastTransactionCreatedAt: tx.createdAt,
      lastTransactionId: tx._id,
      status: BalanceSnapshotStatus.INVALID,
    });

    const otherWalletSnapshot = await BalanceSnapshot.create({
      tenantId,
      walletId: otherWallet._id,
      snapshotAt: new Date('2026-01-03T00:00:00.000Z'),
      balance: toDecimal128('600'),
      lastTransactionDate: tx.date,
      lastTransactionCreatedAt: tx.createdAt,
      lastTransactionId: tx._id,
      status: BalanceSnapshotStatus.VALID,
    });

    const otherTenantSnapshot = await BalanceSnapshot.create({
      tenantId: otherTenantId,
      walletId: wallet._id,
      snapshotAt: new Date('2026-01-03T00:00:00.000Z'),
      balance: toDecimal128('600'),
      lastTransactionDate: tx.date,
      lastTransactionCreatedAt: tx.createdAt,
      lastTransactionId: tx._id,
      status: BalanceSnapshotStatus.VALID,
    });

    await editTransaction({
      tenantId,
      userId,
      walletId: wallet._id,
      transactionId: tx._id,
      amount: '250',
    });

    const refreshedSameWallet = await BalanceSnapshot.findById(validSameWallet._id).lean();
    const refreshedInvalid = await BalanceSnapshot.findById(invalidSameWallet._id).lean();
    const refreshedOtherWallet = await BalanceSnapshot.findById(otherWalletSnapshot._id).lean();
    const refreshedOtherTenant = await BalanceSnapshot.findById(otherTenantSnapshot._id).lean();

    assert.equal(refreshedSameWallet?.status, BalanceSnapshotStatus.INVALID);
    assert.equal(refreshedInvalid?.status, BalanceSnapshotStatus.INVALID);
    assert.equal(refreshedOtherWallet?.status, BalanceSnapshotStatus.VALID);
    assert.equal(refreshedOtherTenant?.status, BalanceSnapshotStatus.VALID);
  });

  it('prevents concurrent overspend and preserves invariant', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'Main wallet',
      initialBalance: toDecimal128('1000000'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('1000000'),
      version: 0,
    });

    const results = await Promise.allSettled([
      createTransaction({
        tenantId,
        userId,
        walletId: wallet._id,
        amount: '700000',
        type: TransactionType.EXPENSE,
        date: new Date('2026-01-02T00:00:00.000Z'),
      }),
      createTransaction({
        tenantId,
        userId,
        walletId: wallet._id,
        amount: '700000',
        type: TransactionType.EXPENSE,
        date: new Date('2026-01-03T00:00:00.000Z'),
      }),
    ]);

    const successCount = results.filter((result) => result.status === 'fulfilled').length;
    const failureCount = results.filter((result) => result.status === 'rejected').length;

    assert.equal(successCount, 1);
    assert.equal(failureCount, 1);

    const refreshedWallet = await Wallet.findById(wallet._id).lean();
    assert.ok(refreshedWallet);
    assert.equal(refreshedWallet!.currentBalance.toString(), '300000.00');

    const dbTransactions = await Transaction.find({ tenantId, userId, walletId: wallet._id }).sort({ date: 1, createdAt: 1, _id: 1 }).lean();
    const totalEffect = dbTransactions.reduce((sum, tx) => {
      const value = toDecimal(tx.amount);
      return sum.plus(tx.type === TransactionType.INCOME ? value : value.negated());
    }, new Decimal(0));

    assert.equal(toDecimal(refreshedWallet!.currentBalance).toString(), toDecimal(refreshedWallet!.initialBalance).plus(totalEffect).toString());
  });

  it('invalidates snapshots between old and new ordering when transaction moves across many checkpoints', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({
      tenantId,
      userId,
      name: 'Checkpoint wallet',
      initialBalance: toDecimal128('1000'),
      initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      currentBalance: toDecimal128('1000'),
      version: 0,
    });

    // Create transactions T1..T5
    const t1 = await createTransaction({ tenantId, userId, walletId: wallet._id, amount: '10', type: TransactionType.INCOME, date: new Date('2026-02-01T00:00:00.000Z') });
    const t2 = await createTransaction({ tenantId, userId, walletId: wallet._id, amount: '20', type: TransactionType.INCOME, date: new Date('2026-02-02T00:00:00.000Z') });
    const t3 = await createTransaction({ tenantId, userId, walletId: wallet._id, amount: '30', type: TransactionType.INCOME, date: new Date('2026-02-03T00:00:00.000Z') });
    const t4 = await createTransaction({ tenantId, userId, walletId: wallet._id, amount: '40', type: TransactionType.INCOME, date: new Date('2026-02-04T00:00:00.000Z') });
    const t5 = await createTransaction({ tenantId, userId, walletId: wallet._id, amount: '50', type: TransactionType.INCOME, date: new Date('2026-02-05T00:00:00.000Z') });

    // Create snapshots at T1, T3, T5
    const s1 = await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('1010'), lastTransactionDate: t1.date, lastTransactionCreatedAt: t1.createdAt, lastTransactionId: t1._id, status: BalanceSnapshotStatus.VALID });
    const s2 = await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('1060'), lastTransactionDate: t3.date, lastTransactionCreatedAt: t3.createdAt, lastTransactionId: t3._id, status: BalanceSnapshotStatus.VALID });
    const s3 = await BalanceSnapshot.create({ tenantId, walletId: wallet._id, snapshotAt: new Date(), balance: toDecimal128('1160'), lastTransactionDate: t5.date, lastTransactionCreatedAt: t5.createdAt, lastTransactionId: t5._id, status: BalanceSnapshotStatus.VALID });

    // Move T2 (originally at between T1 and T3) to after T5
    await editTransaction({ tenantId, userId, walletId: wallet._id, transactionId: t2._id, date: new Date('2026-02-06T00:00:00.000Z') });

    const refreshedS1 = await BalanceSnapshot.findById(s1._id).lean();
    const refreshedS2 = await BalanceSnapshot.findById(s2._id).lean();
    const refreshedS3 = await BalanceSnapshot.findById(s3._id).lean();

    // S1 was before old/new affectedFrom and should remain VALID
    assert.equal(refreshedS1?.status, BalanceSnapshotStatus.VALID);
    // S2 and S3 are at or after the affected boundary and must be INVALID
    assert.equal(refreshedS2?.status, BalanceSnapshotStatus.INVALID);
    assert.equal(refreshedS3?.status, BalanceSnapshotStatus.INVALID);
  });

  it('concurrent create: only one expense succeeds and wallet never negative', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'Concurrent wallet', initialBalance: toDecimal128('100'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('100'), version: 0 });

    const p = await Promise.allSettled([
      createTransaction({ tenantId, userId, walletId: wallet._id, amount: '80', type: TransactionType.EXPENSE, date: new Date('2026-03-01T00:00:00.000Z') }),
      createTransaction({ tenantId, userId, walletId: wallet._id, amount: '50', type: TransactionType.EXPENSE, date: new Date('2026-03-01T00:00:01.000Z') }),
    ]);

    const fulfilled = p.filter((r) => r.status === 'fulfilled');
    const rejected = p.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const refreshed = await Wallet.findById(wallet._id).lean();
    assert.ok(refreshed);
    // wallet must not be negative
    assert.ok(!toDecimal(refreshed!.currentBalance).isNegative());

    const txs = await Transaction.find({ tenantId, userId, walletId: wallet._id }).lean();
    const totalEffect = txs.reduce((sum, tx) => {
      const v = toDecimal(tx.amount);
      return sum.plus(tx.type === TransactionType.INCOME ? v : v.negated());
    }, new Decimal(0));

    assert.equal(toDecimal(refreshed!.currentBalance).toString(), toDecimal(refreshed!.initialBalance).plus(totalEffect).toString());
  });

  it('concurrent edits: concurrent effect changes preserve invariant and at most one overspend', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'Edit concurrency', initialBalance: toDecimal128('100'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('100'), version: 0 });

    const t1 = await createTransaction({ tenantId, userId, walletId: wallet._id, amount: '10', type: TransactionType.EXPENSE, date: new Date('2026-04-01T00:00:00.000Z') });
    const t2 = await createTransaction({ tenantId, userId, walletId: wallet._id, amount: '10', type: TransactionType.EXPENSE, date: new Date('2026-04-02T00:00:00.000Z') });

    const results = await Promise.allSettled([
      editTransaction({ tenantId, userId, walletId: wallet._id, transactionId: t1._id, amount: '80' }), // delta -70
      editTransaction({ tenantId, userId, walletId: wallet._id, transactionId: t2._id, amount: '50' }), // delta -40
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    // The important invariants: wallet balance equals initial + sum(effects) and is not negative
    // verify invariant
    const refreshed = await Wallet.findById(wallet._id).lean();
    assert.ok(refreshed);
    const txs = await Transaction.find({ tenantId, userId, walletId: wallet._id }).lean();
    const totalEffect = txs.reduce((sum, tx) => {
      const v = toDecimal(tx.amount);
      return sum.plus(tx.type === TransactionType.INCOME ? v : v.negated());
    }, new Decimal(0));

    const expected = toDecimal(refreshed!.initialBalance).plus(totalEffect).toString();
    const actual = toDecimal(refreshed!.currentBalance).toString();
    if (actual !== expected || toDecimal(refreshed!.currentBalance).isNegative()) {
      console.error('CONCURRENT_EDIT_FAILURE', {
        wallet: { id: refreshed!._id?.toString?.(), initialBalance: refreshed!.initialBalance.toString(), currentBalance: refreshed!.currentBalance.toString(), version: refreshed!.version },
        transactions: txs.map((t) => ({ id: t._id?.toString?.(), amount: t.amount.toString(), type: t.type })),
        expected,
        actual,
      });
    }

    assert.equal(actual, expected);
    assert.ok(!toDecimal(refreshed!.currentBalance).isNegative());
  });

  it('atomic rollback: failed edit does not partially apply transaction nor wallet change', async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const wallet = await Wallet.create({ tenantId, userId, name: 'Atomic wallet', initialBalance: toDecimal128('100'), initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'), currentBalance: toDecimal128('100'), version: 0 });

    const t = await createTransaction({ tenantId, userId, walletId: wallet._id, amount: '10', type: TransactionType.EXPENSE, date: new Date('2026-05-01T00:00:00.000Z') });

    // Attempt an edit that would make the wallet negative
    await assert.rejects(async () => editTransaction({ tenantId, userId, walletId: wallet._id, transactionId: t._id, amount: '1000' }), (err: unknown) => err instanceof InsufficientBalanceError);

    const refreshedTx = await Transaction.findById(t._id).lean();
    const refreshedWallet = await Wallet.findById(wallet._id).lean();
    // Transaction must be unchanged
    assert.equal(refreshedTx?.amount.toString(), '10.00');
    // Wallet must be unchanged
    assert.equal(refreshedWallet!.currentBalance.toString(), '90.00');
  });
});
