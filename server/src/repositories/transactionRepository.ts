import mongoose from 'mongoose';
import TransactionModel, { TransactionDocument } from '../models/Transaction';
import { buildBeforePredicate, buildAfterPredicate, buildAtOrAfterPredicate } from '../utils/ordering';

export const insertTransaction = (tx: Partial<TransactionDocument>, session?: mongoose.ClientSession) =>
  new TransactionModel(tx).save({ session });

export const findById = (id: mongoose.Types.ObjectId) => TransactionModel.findById(id).lean();

export const findByWalletWithPredicate = (walletId: mongoose.Types.ObjectId, predicate: any, limit = 20) =>
  TransactionModel.find({ wallet: walletId, ...predicate }).sort({ date: -1, createdAt: -1, _id: -1 }).limit(limit).lean();

export const countAfterOrdering = (walletId: mongoose.Types.ObjectId, ordering: { date: Date; createdAt: Date; _id: mongoose.Types.ObjectId }) =>
  TransactionModel.countDocuments({
    wallet: walletId,
    ...buildAfterPredicate(ordering.date, ordering.createdAt, ordering._id),
  });

export const sumUpToOrdering = (walletId: mongoose.Types.ObjectId, ordering: { date: Date; createdAt: Date; _id: mongoose.Types.ObjectId }) =>
  TransactionModel.aggregate([
    { $match: { wallet: walletId, ...buildAtOrAfterPredicate(new Date(0), ordering.date) } },
    { $sort: { date: 1, createdAt: 1, _id: 1 } },
    { $group: { _id: null, total: { $sum: '$amountDecimal' } } },
  ]).then((r) => (r[0]?.total ? r[0].total : 0));
