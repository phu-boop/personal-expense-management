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

    const res = await Transaction.aggregate(pipeline).exec();

    const totalRaw = res?.[0]?.total ?? 0;

    // Convert wallet.initialBalance and totalRaw to Decimal for accurate math
    const initial = toDecimal(wallet.initialBalance ?? 0);
    const total = toDecimal(totalRaw);

    const balance = initial.plus(total);

    // Insert snapshot (append-only semantics)
    const snapshot = new BalanceSnapshot({
      tenantId: tenantId ?? wallet.tenantId,
      walletId: walletObjectId,
      snapshotAt: new Date(),
      balance: toDecimal128(balance),
      lastTransactionDate: checkpoint.date,
      lastTransactionCreatedAt: checkpoint.createdAt,
      lastTransactionId: checkpoint.id,
      status: BalanceSnapshotStatus.VALID,
    });

    await snapshot.save();

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
