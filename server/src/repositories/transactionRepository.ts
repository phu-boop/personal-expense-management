import mongoose from 'mongoose';
import TransactionModel, { ITransaction } from '../models/Transaction';
import { buildAfterPredicate, buildAtOrAfterPredicate } from '../utils/ordering';

export type TransactionDocument = ITransaction & mongoose.Document;

export const insertTransaction = (tx: Partial<ITransaction>, session?: mongoose.ClientSession) =>
  new TransactionModel(tx).save({ session });

export const findById = (id: mongoose.Types.ObjectId) => TransactionModel.findById(id).lean();

export const findByWalletWithPredicate = (walletId: mongoose.Types.ObjectId, predicate: any, limit = 20) =>
  TransactionModel.find({ walletId, ...predicate }).sort({ date: -1, createdAt: -1, _id: -1 }).limit(limit).lean();

export const countAfterOrdering = (walletId: mongoose.Types.ObjectId, ordering: { date: Date; createdAt: Date; _id: mongoose.Types.ObjectId }) =>
  TransactionModel.countDocuments({
    walletId,
    ...buildAfterPredicate({ date: ordering.date, createdAt: ordering.createdAt, _id: ordering._id }),
  });

export const sumUpToOrdering = (walletId: mongoose.Types.ObjectId, ordering: { date: Date; createdAt: Date; _id: mongoose.Types.ObjectId }) =>
  TransactionModel.aggregate([
    { $match: { walletId, ...buildAtOrAfterPredicate({ date: new Date(0), createdAt: new Date(0), _id: new mongoose.Types.ObjectId('000000000000000000000000') }) } },
    { $sort: { date: 1, createdAt: 1, _id: 1 } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]).then((r) => (r[0]?.total ? r[0].total : 0));
