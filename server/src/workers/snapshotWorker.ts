import mongoose from 'mongoose';
import Transaction from '../models/Transaction';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import SnapshotService from '../services/snapshotService';

const DEFAULT_SNAPSHOT_INTERVAL = 50000;

/**
 * Check the latest VALID snapshot for the wallet and create a new snapshot
 * if the number of transactions after the snapshot >= SNAPSHOT_INTERVAL.
 */
export async function createSnapshotIfNeeded(
  walletId: mongoose.Types.ObjectId | string,
  options?: { tenantId?: mongoose.Types.ObjectId | string; snapshotInterval?: number }
) {
  const walletObjectId = typeof walletId === 'string' ? new mongoose.Types.ObjectId(walletId) : walletId;
  const tenantId = options?.tenantId;
  const interval = options?.snapshotInterval ?? DEFAULT_SNAPSHOT_INTERVAL;

  // Find latest VALID snapshot for this wallet
  const latestSnapshot = await BalanceSnapshot.findOne({
    walletId: walletObjectId,
    ...(tenantId ? { tenantId } : {}),
    status: BalanceSnapshotStatus.VALID,
  }).sort({ lastTransactionDate: -1, lastTransactionCreatedAt: -1, lastTransactionId: -1 }).lean();

  // Determine the cursor ordering to count from
  let afterPredicate: any = {};

  if (!latestSnapshot) {
    // No snapshot -> count all transactions for wallet
    afterPredicate = { walletId: walletObjectId, ...(tenantId ? { tenantId } : {}) };
  } else {
    // Count transactions strictly after the snapshot's lastTransaction
    const ord = {
      date: latestSnapshot.lastTransactionDate,
      createdAt: latestSnapshot.lastTransactionCreatedAt,
      _id: latestSnapshot.lastTransactionId,
    };

    afterPredicate = {
      walletId: walletObjectId,
      ...(tenantId ? { tenantId } : {}),
      $or: [
        { date: { $gt: ord.date } },
        { $and: [{ date: ord.date }, { createdAt: { $gt: ord.createdAt } }] },
        { $and: [{ date: ord.date }, { createdAt: ord.createdAt }, { _id: { $gt: ord._id } }] },
      ],
    };
  }

  const countAfter = await Transaction.countDocuments(afterPredicate);

  if (countAfter < interval) {
    return { created: false, reason: 'interval not reached', countAfter };
  }

  // Find the latest transaction and use it as checkpoint
  const latestTx = await Transaction.findOne({ walletId: walletObjectId, ...(tenantId ? { tenantId } : {}) })
    .sort({ date: -1, createdAt: -1, _id: -1 }).lean();

  if (!latestTx) {
    return { created: false, reason: 'no transactions' };
  }

  const checkpoint = {
    date: latestTx.date,
    createdAt: latestTx.createdAt,
    id: latestTx._id,
  } as any;

  const snapshot = await SnapshotService.createSnapshot(walletObjectId, checkpoint, tenantId);

  return { created: true, snapshotId: snapshot._id };
}

export default { createSnapshotIfNeeded };
