import mongoose from 'mongoose';
import Decimal from 'decimal.js';

import Transaction from '../models/Transaction';
import Wallet from '../models/Wallet';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import { toDecimal, toDecimal128 } from '../utils/money';
import orderingUtils from '../utils/ordering';
import { createRedisQueueFromEnvironment } from './redisQueue';

export type SnapshotCheckpoint = {
  date: Date;
  createdAt: Date;
  id: mongoose.Types.ObjectId;
};

class SnapshotService {
  /**
   * Create a BalanceSnapshot for the given wallet up to and including the checkpoint transaction.
   * The snapshot.balance is the wallet.initialBalance + sum(effect of transactions <= checkpoint)
   */
  static async createSnapshot(
    walletId: mongoose.Types.ObjectId | string,
    checkpoint: SnapshotCheckpoint,
    tenantId?: mongoose.Types.ObjectId | string,
  ) {
    const walletObjectId = typeof walletId === 'string' ? new mongoose.Types.ObjectId(walletId) : walletId;

    const wallet = await Wallet.findOne({ _id: walletObjectId, ...(tenantId ? { tenantId } : {}) }).lean();

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // record start time to detect concurrent edits that happen while we aggregate
    const startTime = new Date();

    // Build predicate for transactions <= checkpoint (inclusive)
    // orderingUtils.buildBeforePredicate is strictly before, so use OR with equality when needed.
    const beforePred = orderingUtils.buildBeforePredicate({
      date: checkpoint.date,
      createdAt: checkpoint.createdAt,
      _id: checkpoint.id,
    });

    // Flatten the $or array from beforePred and append an equality clause for the checkpoint
    const beforeArray = Array.isArray((beforePred as any).$or) ? (beforePred as any).$or : [beforePred];

    // Build equality predicate for the exact checkpoint (date == && createdAt == && _id ==)
    const eqPred = {
      date: new Date(checkpoint.date),
      createdAt: new Date(checkpoint.createdAt),
      _id: checkpoint.id,
    };

    const orPredicate = { $or: [...beforeArray, eqPred] };

    // Ensure we only sum transactions for this wallet (and tenant if provided)
    const match: any = { walletId: walletObjectId };
    if (tenantId) match.tenantId = tenantId;

    // Aggregate sum of effects up to and including the checkpoint
    const pipeline = [
      { $match: { ...match, ...orPredicate } },
      {
        $project: {
          effect: { $switch: { branches: [
            { case: { $eq: ['$type', 'INCOME'] }, then: '$amount' },
            { case: { $eq: ['$type', 'EXPENSE'] }, then: { $multiply: ['$amount', -1] } },
          ], default: 0 } },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$effect' },
        },
      },
    ];

    const res = await Transaction.aggregate(pipeline).allowDiskUse(true).exec();

    const totalRaw = res?.[0]?.total ?? 0;

    // Convert wallet.initialBalance and totalRaw to Decimal for accurate math
    const initial = toDecimal(wallet.initialBalance ?? 0);
    const total = toDecimal(totalRaw);

    const balance = initial.plus(total);

    // Insert snapshot (append-only semantics)
    // Before persisting, detect concurrent transaction edits that occurred while we were aggregating.
    // If any transaction for this wallet was updated after we started, treat as transient so the consumer can retry.
    const concurrentEditExists = await Transaction.exists({
      walletId: walletObjectId,
      ...(tenantId ? { tenantId } : {}),
      updatedAt: { $gt: startTime },
    });

    if (concurrentEditExists) {
      const err: any = new Error('transient: concurrent transaction modification detected');
      err.name = 'TransientSnapshotCreationError';
      throw err;
    }
    // Also detect concurrent snapshot invalidation or snapshot writes
    const concurrentSnapshotChange = await BalanceSnapshot.exists({
      walletId: walletObjectId,
      ...(tenantId ? { tenantId } : {}),
      updatedAt: { $gt: startTime },
    });

    if (concurrentSnapshotChange) {
      const err: any = new Error('transient: concurrent snapshot modification detected');
      err.name = 'TransientSnapshotCreationError';
      throw err;
    }

    // Upsert a VALID snapshot for this exact checkpoint to make snapshot creation idempotent.
    // Use $setOnInsert so concurrent creators race to insert only one document.
    const filter: any = {
      walletId: walletObjectId,
      lastTransactionDate: checkpoint.date,
      lastTransactionCreatedAt: checkpoint.createdAt,
      lastTransactionId: checkpoint.id,
      status: BalanceSnapshotStatus.VALID,
    };

    const now = new Date();
    const updateOnInsert = {
      $setOnInsert: {
        tenantId: tenantId ?? wallet.tenantId,
        walletId: walletObjectId,
        snapshotAt: now,
        balance: toDecimal128(balance),
        lastTransactionDate: checkpoint.date,
        lastTransactionCreatedAt: checkpoint.createdAt,
        lastTransactionId: checkpoint.id,
        status: BalanceSnapshotStatus.VALID,
      },
    };

    const snapshot = await BalanceSnapshot.findOneAndUpdate(filter, updateOnInsert, { upsert: true, returnDocument: 'after' }).lean();

    // Enqueue snapshot cleanup/metric job (best-effort) — not the main worker trigger
    try {
      const queue = await createRedisQueueFromEnvironment();
      await queue.enqueue('snapshot-jobs', { walletId: walletObjectId, snapshotId: snapshot._id });
    } catch (err) {
      // swallow queue errors — snapshot creation itself succeeded
      console.warn('[snapshotService] failed to enqueue snapshot job', err);
    }

    return snapshot;
  }
}

export default SnapshotService;
