import mongoose from 'mongoose';
import { toDecimal } from '../utils/money';
import Transaction from '../models/Transaction';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import orderingUtils from '../utils/ordering';
import { getTransactionEffect } from '../utils/transactionEffect';

export const listTransactions = async ({ tenantId, userId, walletId, limit, cursor, from, to, debug }: any) => {
  const fromDate = from ?? new Date(0);
  const toDate = to ?? new Date();

  if (fromDate.getTime() >= toDate.getTime()) throw new Error('from must be earlier than to');

  const boundary = cursor
    ? { date: cursor.date, createdAt: cursor.createdAt, _id: cursor._id }
    : undefined;

  const query: any = { tenantId, userId, walletId };
  if (boundary) {
    query.$or = [
      { date: { $gt: boundary.date } },
      { date: boundary.date, createdAt: { $gt: boundary.createdAt } },
      { date: boundary.date, createdAt: boundary.createdAt, _id: { $gt: boundary._id } },
    ];
  }

  const rangeQuery: any = { ...query, date: { $gte: fromDate, $lt: toDate } };

  const transactions = await Transaction.find(rangeQuery).sort({ date: 1, createdAt: 1, _id: 1 }).limit(limit + 1).lean();
  const rangeCount = debug ? await Transaction.countDocuments(rangeQuery).exec() : undefined;

  // Compute openingBalance using BalanceSnapshot fast-path
  let openingBalance = toDecimal('0');

  // Determine first ordering
  const firstOrdering = transactions.length > 0
    ? { date: transactions[0].date, createdAt: transactions[0].createdAt, _id: transactions[0]._id }
    : boundary
      ? { date: boundary.date, createdAt: boundary.createdAt, _id: boundary._id }
      : { date: fromDate, createdAt: new Date(0), _id: new mongoose.Types.ObjectId('000000000000000000000000') };

  const beforePred = orderingUtils.buildBeforePredicate(firstOrdering);

  const snapshot = await BalanceSnapshot.findOne({
    tenantId,
    walletId,
    status: BalanceSnapshotStatus.VALID,
    $and: [
      { lastTransactionDate: { $exists: true } },
      { lastTransactionCreatedAt: { $exists: true } },
      { lastTransactionId: { $exists: true } },
    ],
    ...beforePred,
  }).sort({ lastTransactionDate: -1, lastTransactionCreatedAt: -1, lastTransactionId: -1 }).lean();

  if (snapshot) {
    openingBalance = toDecimal(snapshot.balance);
    const afterSnapOr = orderingUtils.buildAfterPredicate({ date: snapshot.lastTransactionDate!, createdAt: snapshot.lastTransactionCreatedAt!, _id: snapshot.lastTransactionId! });
    const beforeFirstOr = orderingUtils.buildBeforePredicate(firstOrdering);

    const betweenQuery = { tenantId, userId, walletId, $and: [afterSnapOr, beforeFirstOr] };
    const between = await Transaction.find(betweenQuery).sort({ date: 1, createdAt: 1, _id: 1 }).lean();
    const betweenCount = debug ? await Transaction.countDocuments(betweenQuery).exec() : undefined;
    for (const t of between) {
      openingBalance = openingBalance.plus(getTransactionEffect(toDecimal(t.amount), t.type));
    }
  } else {
    const beforePred2 = orderingUtils.buildBeforePredicate(firstOrdering);
    const historicalQuery = { tenantId, userId, walletId, ...beforePred2 };
    const historical = await Transaction.find(historicalQuery).sort({ date: 1, createdAt: 1, _id: 1 }).lean();
    const historicalCount = debug ? await Transaction.countDocuments(historicalQuery).exec() : undefined;
    for (const t of historical) {
      openingBalance = openingBalance.plus(getTransactionEffect(toDecimal(t.amount), t.type));
    }
  }

  const pageItems = transactions.slice(0, limit);
  const hasMore = transactions.length > limit;

  let runningBalance = openingBalance;
  const result = pageItems.map((transaction: any) => {
    const balanceBefore = runningBalance;
    const effect = getTransactionEffect(toDecimal(transaction.amount), transaction.type);
    runningBalance = runningBalance.plus(effect);
    const balanceAfter = runningBalance;

    return {
      ...transaction,
      amount: transaction.amount?.$numberDecimal ?? String(transaction.amount ?? '0'),
      balanceBefore: balanceBefore.toString(),
      balanceAfter: balanceAfter.toString(),
    };
  });

  const nextCursor = hasMore && result.length > 0 ? Buffer.from(JSON.stringify({ date: pageItems[pageItems.length - 1].date, createdAt: pageItems[pageItems.length - 1].createdAt, _id: pageItems[pageItems.length - 1]._id })).toString('base64') : null;

  const out: any = { openingBalance: openingBalance.toString(), transactions: result, nextCursor, hasMore, limit };
  if (debug) {
    out._debug = {
      rangeQuery,
      rangeCount,
      firstOrdering,
      beforePred,
      snapshot: snapshot ? { lastTransactionDate: snapshot.lastTransactionDate, lastTransactionCreatedAt: snapshot.lastTransactionCreatedAt, lastTransactionId: snapshot.lastTransactionId } : null,
      snapshotFound: Boolean(snapshot),
      betweenCount: typeof betweenCount !== 'undefined' ? betweenCount : undefined,
      historicalCount: typeof historicalCount !== 'undefined' ? historicalCount : undefined,
      returnedTransactions: transactions.length,
    };
  }

  return out;
};
