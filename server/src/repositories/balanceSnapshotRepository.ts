import mongoose from 'mongoose';
import BalanceSnapshotModel, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';

export const findLatestValidForWallet = (walletId: mongoose.Types.ObjectId) =>
  BalanceSnapshotModel.findOne({ walletId, status: BalanceSnapshotStatus.VALID }).sort({ lastTransactionDate: -1, lastTransactionCreatedAt: -1, lastTransactionId: -1 }).lean();

export const invalidateSnapshotsAtOrAfter = (walletId: mongoose.Types.ObjectId, minOrdering: { date: Date; createdAt: Date; _id: mongoose.Types.ObjectId }, session?: mongoose.ClientSession) =>
  BalanceSnapshotModel.updateMany(
    {
      walletId,
      $or: [
        { lastTransactionDate: { $gt: minOrdering.date } },
        { lastTransactionDate: minOrdering.date, lastTransactionCreatedAt: { $gt: minOrdering.createdAt } },
        { lastTransactionDate: minOrdering.date, lastTransactionCreatedAt: minOrdering.createdAt, lastTransactionId: { $gte: minOrdering._id } },
      ],
    },
    { $set: { status: BalanceSnapshotStatus.INVALID } },
    { session }
  );
