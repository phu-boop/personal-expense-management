import mongoose from 'mongoose';
import Decimal from 'decimal.js';

import Transaction, { ITransaction, TransactionType } from '../models/Transaction';
import Wallet from '../models/Wallet';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import orderingUtils from '../utils/ordering';
import { toDecimal, toDecimal128 } from '../utils/money';
import { getTransactionEffect } from '../utils/transactionEffect';

export type StatementRequest = {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  from: Date;
  to: Date;
  limit?: number;
  cursor?: { date: Date; createdAt: Date; _id: mongoose.Types.ObjectId } | null;
};

export type StatementResponse = {
  openingBalance: string;
  totalIncome: string;
  totalExpense: string;
  closingBalance: string;
  transactions: Array<{
    _id: mongoose.Types.ObjectId;
    tenantId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    walletId: mongoose.Types.ObjectId;
    amount: mongoose.Types.Decimal128;
    type: TransactionType;
    date: Date;
    category?: mongoose.Types.ObjectId;
    note?: string;
    createdAt: Date;
    balanceBefore: string;
    balanceAfter: string;
  }>;
  nextCursor?: string | null;
};

const DEFAULT_LIMIT = 100;

const encodeCursor = (c: { date: Date; createdAt: Date; _id: mongoose.Types.ObjectId } | null | undefined): string | undefined => {
  if (!c) return undefined;
  const payload = JSON.stringify({ date: c.date.toISOString(), createdAt: c.createdAt.toISOString(), _id: c._id.toHexString() });
  return Buffer.from(payload, 'utf8').toString('base64');
};

export default class StatementService {
  static async computeStatement(req: StatementRequest): Promise<StatementResponse> {
    const { tenantId, userId, walletId, from, to, limit = DEFAULT_LIMIT, cursor } = req;

    if (!(from instanceof Date) || Number.isNaN(from.getTime())) throw new Error('invalid from date');
    if (!(to instanceof Date) || Number.isNaN(to.getTime())) throw new Error('invalid to date');
    if (from.getTime() >= to.getTime()) throw new Error('from must be before to');

    // Ensure wallet exists and belongs to tenant/user
    const wallet = await Wallet.findOne({ _id: walletId, tenantId, userId }).lean();
    if (!wallet) throw new Error('wallet not found');

    // Compute openingBalance: balance immediately before `from`.
    // Use latest VALID snapshot strictly before `from` ordering candidate, else compute from initialBalance.
    const pageStartCandidate = { date: from, createdAt: new Date(0), _id: new mongoose.Types.ObjectId('000000000000000000000000') };

    const beforePred = orderingUtils.buildBeforePredicate(pageStartCandidate);

    const snapshot = await BalanceSnapshot.findOne({
      tenantId,
      walletId,
      status: BalanceSnapshotStatus.VALID,
      ...beforePred,
    }).sort({ lastTransactionDate: -1, lastTransactionCreatedAt: -1, lastTransactionId: -1 }).lean();

    let openingBalanceDecimal = toDecimal(wallet.initialBalance);

    if (snapshot) {
      openingBalanceDecimal = toDecimal(snapshot.balance);

      // sum effects strictly after snapshot checkpoint and strictly before `from`
      const afterSnap = orderingUtils.buildAfterPredicate({ date: snapshot.lastTransactionDate!, createdAt: snapshot.lastTransactionCreatedAt!, _id: snapshot.lastTransactionId! });
      const beforeFrom = orderingUtils.buildBeforePredicate({ date: from, createdAt: new Date(0), _id: new mongoose.Types.ObjectId('000000000000000000000000') });

      const aggMatch: any = { tenantId, walletId, $and: [afterSnap, beforeFrom] };

      const agg = await Transaction.aggregate([
        { $match: aggMatch },
        { $project: { amount: 1, type: 1 } },
        { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', { $multiply: ['$amount', -1] } ] } } } },
      ]).exec();

      if (agg.length === 1 && agg[0].total !== undefined && agg[0].total !== null) {
        try {
          const total = toDecimal(agg[0].total);
          openingBalanceDecimal = openingBalanceDecimal.plus(total);
        } catch (err) {
          throw new Error(`Failed to compute openingBalance from snapshot: ${String(err)}`);
        }
      }
    } else {
      // No snapshot: sum effects of transactions strictly before `from` and add to initialBalance
      const beforeFromMatch: any = { tenantId, walletId, date: { $lt: from } };
      const agg = await Transaction.aggregate([
        { $match: beforeFromMatch },
        { $project: { amount: 1, type: 1 } },
        { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', { $multiply: ['$amount', -1] } ] } } } },
      ]).exec();

      if (agg.length === 1 && agg[0].total !== undefined && agg[0].total !== null) {
        try {
          const total = toDecimal(agg[0].total);
          openingBalanceDecimal = openingBalanceDecimal.plus(total);
        } catch (err) {
          throw new Error(`Failed to compute openingBalance: ${String(err)}`);
        }
      }
    }

    // If a cursor is provided, we must advance the opening balance by the
    // effects of transactions in [from, cursor) so a paged request continues
    // the running balance correctly across pages.
    if (cursor) {
      const fromCandidate = { date: from, createdAt: new Date(0), _id: new mongoose.Types.ObjectId('000000000000000000000000') };
      const afterFromPred = orderingUtils.buildAtOrAfterPredicate(fromCandidate);
      // Build predicate matching ordering less-than-or-equal-to the cursor
      const beforeOrEqCursorPred = {
        $or: [
          { date: { $lt: new Date(cursor.date) } },
          { $and: [ { date: { $eq: new Date(cursor.date) } }, { createdAt: { $lt: new Date(cursor.createdAt ?? 0) } } ] },
          { $and: [ { date: { $eq: new Date(cursor.date) } }, { createdAt: { $eq: new Date(cursor.createdAt ?? 0) } }, { _id: { $lte: new mongoose.Types.ObjectId(String(cursor._id)) } } ] },
        ],
      };

      const cursorMatch: any = { tenantId, walletId, $and: [afterFromPred, beforeOrEqCursorPred] };

      const cursorAgg = await Transaction.aggregate([
        { $match: cursorMatch },
        { $project: { amount: 1, type: 1 } },
        { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', { $multiply: ['$amount', -1] } ] } } } },
      ]).exec();

      if (cursorAgg.length === 1 && cursorAgg[0].total !== undefined && cursorAgg[0].total !== null) {
        try {
          const delta = toDecimal(cursorAgg[0].total);
          openingBalanceDecimal = openingBalanceDecimal.plus(delta);
        } catch (err) {
          throw new Error(`Failed to compute openingBalance for cursor page: ${String(err)}`);
        }
      }
    }

    // Now fetch transactions in [from, to) with canonical ordering, apply cursor if provided
    const match: any = { tenantId, walletId, date: { $gte: from, $lt: to } };

    if (cursor) {
      const afterCursor = orderingUtils.buildAfterPredicate({ date: cursor.date, createdAt: cursor.createdAt, _id: cursor._id });
      match.$and = [afterCursor];
    }

    const docs = await Transaction.find(match)
      .sort({ date: 1, createdAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean()
      .exec();

    let items = docs.slice(0, limit);

    // compute totals and per-transaction balances
    let running = openingBalanceDecimal;
    let totalIncome = new Decimal(0);
    let totalExpense = new Decimal(0);

    const txs = items.map((t: any) => {
      const effect = getTransactionEffect(toDecimal(t.amount), t.type);
      const before = running;
      const after = before.plus(effect);
      running = after;

      if (t.type === TransactionType.INCOME) totalIncome = totalIncome.plus(toDecimal(t.amount));
      if (t.type === TransactionType.EXPENSE) totalExpense = totalExpense.plus(toDecimal(t.amount));

      return {
        _id: t._id,
        tenantId: t.tenantId,
        userId: t.userId,
        walletId: t.walletId,
        amount: t.amount,
        type: t.type,
        date: t.date,
        category: t.category,
        note: t.note,
        createdAt: t.createdAt,
        balanceBefore: before.toFixed(2),
        balanceAfter: after.toFixed(2),
      };
    });

    const hasMore = docs.length > limit;
    const nextCursor = hasMore ? encodeCursor({ date: items[items.length - 1].date, createdAt: items[items.length - 1].createdAt, _id: items[items.length - 1]._id }) : undefined;

    const closingBalance = openingBalanceDecimal.plus(totalIncome).minus(totalExpense);

    return {
      openingBalance: openingBalanceDecimal.toFixed(2),
      totalIncome: totalIncome.toFixed(2),
      totalExpense: totalExpense.toFixed(2),
      closingBalance: closingBalance.toFixed(2),
      transactions: txs,
      nextCursor: nextCursor ?? null,
    };
  }
}
