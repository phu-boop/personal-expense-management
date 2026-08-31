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
    mongoServer = await MongoMemoryServer.create({
      replSet: {
        count: 1,
        storageEngine: 'wiredTiger',
      },
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
});
