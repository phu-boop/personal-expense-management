import mongoose from 'mongoose';
import { toDecimal } from '../utils/money';
import Wallet from '../models/Wallet';
import Transaction from '../models/Transaction';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import orderingUtils from '../utils/ordering';
import { getTransactionEffect } from '../utils/transactionEffect';

export const listTransactions = async ({ tenantId, userId, walletId, limit, cursor, from, to }: any) => {
  const fromDate = from ?? new Date(0);
  const toDate = to ?? new Date();

  if (fromDate.getTime() >= toDate.getTime()) throw new Error('from must be earlier than to');

  const boundary = cursor ? { date: cursor.date, createdAt: cursor.createdAt, _id: cursor._id } : undefined;

  const baseFilter: any = { tenantId, userId, walletId };
  const rangeDateFilter = { date: { $gte: fromDate, $lt: toDate } };

  // Initial transaction fetch to determine the page start ordering.
  const afterBoundaryPred = boundary ? orderingUtils.buildAfterPredicate(boundary) : undefined;
  const initialRangeQuery: any = { ...baseFilter, ...rangeDateFilter };
  if (afterBoundaryPred) initialRangeQuery.$and = [afterBoundaryPred];
  const initialTransactions = await Transaction.find(initialRangeQuery).sort({ date: 1, createdAt: 1, _id: 1 }).limit(limit + 1).lean();

  // Determine page start candidate ordering (used to select snapshot)
  const pageStartCandidate = initialTransactions.length > 0
    ? { date: initialTransactions[0].date, createdAt: initialTransactions[0].createdAt, _id: initialTransactions[0]._id }
    : boundary
      ? { date: boundary.date, createdAt: boundary.createdAt, _id: boundary._id }
      : { date: fromDate, createdAt: new Date(0), _id: new mongoose.Types.ObjectId('000000000000000000000000') };

  // Find latest VALID snapshot whose checkpoint is STRICTLY BEFORE the pageStartCandidate.
  // Build a predicate that matches snapshots with checkpoint < pageStartCandidate using the same ordering tuple.
  const snapBeforePred = orderingUtils.buildBeforePredicate(pageStartCandidate);
  const snapshot = await BalanceSnapshot.findOne({
    tenantId,
    walletId,
    status: BalanceSnapshotStatus.VALID,
    $and: [
      { lastTransactionDate: { $exists: true } },
      { lastTransactionCreatedAt: { $exists: true } },
      { lastTransactionId: { $exists: true } },
      snapBeforePred,
    ],
  }).sort({ lastTransactionDate: -1, lastTransactionCreatedAt: -1, lastTransactionId: -1 }).lean();

  // If we have a snapshot, re-query transactions starting strictly after the snapshot checkpoint
  let transactions = initialTransactions;
  if (snapshot) {
    const afterSnapPred = orderingUtils.buildAfterPredicate({ date: snapshot.lastTransactionDate!, createdAt: snapshot.lastTransactionCreatedAt!, _id: snapshot.lastTransactionId! });
    const andPreds: any[] = [];
    if (afterBoundaryPred) andPreds.push(afterBoundaryPred);
    if (afterSnapPred) andPreds.push(afterSnapPred);
    const rangeQuery: any = { ...baseFilter, ...rangeDateFilter };
    if (andPreds.length) rangeQuery.$and = andPreds;
    transactions = await Transaction.find(rangeQuery).sort({ date: 1, createdAt: 1, _id: 1 }).limit(limit + 1).lean();
  }

  // Compute openingBalance using BalanceSnapshot fast-path
  let openingBalance = toDecimal('0');

  // Determine first ordering (page start boundary)
  const firstOrdering = transactions.length > 0
    ? { date: transactions[0].date, createdAt: transactions[0].createdAt, _id: transactions[0]._id }
    : boundary
      ? { date: boundary.date, createdAt: boundary.createdAt, _id: boundary._id }
      : { date: fromDate, createdAt: new Date(0), _id: new mongoose.Types.ObjectId('000000000000000000000000') };

  if (snapshot) {
    openingBalance = toDecimal(snapshot.balance);

    // Sum effects for transactions strictly after snapshot checkpoint and strictly before firstOrdering
    const afterSnapOr = orderingUtils.buildAfterPredicate({ date: snapshot.lastTransactionDate!, createdAt: snapshot.lastTransactionCreatedAt!, _id: snapshot.lastTransactionId! });
    const beforeFirstOr = orderingUtils.buildBeforePredicate(firstOrdering);

    const match: any = { tenantId, userId, walletId, $and: [afterSnapOr, beforeFirstOr] };

    const pipeline = [
      { $match: match },
      { $project: { effect: { $switch: { branches: [
        { case: { $eq: ['$type', 'INCOME'] }, then: '$amount' },
        { case: { $eq: ['$type', 'EXPENSE'] }, then: { $multiply: ['$amount', -1] } },
      ], default: 0 } } } },
      { $group: { _id: null, total: { $sum: '$effect' } } },
    ];

    const aggRes = await Transaction.aggregate(pipeline).allowDiskUse(true).exec();
    const deltaRaw = aggRes?.[0]?.total ?? 0;
    const deltaStr = deltaRaw && typeof deltaRaw.toString === 'function' ? deltaRaw.toString() : String(deltaRaw);
    // On any conversion/aggregation error we must throw — do NOT silently return snapshot.balance
    const Decimal = (await import('decimal.js')).default;
    let total: any;
    try {
      total = new Decimal(deltaStr);
    } catch (err) {
      throw new Error(`Failed to parse aggregate delta: ${String(err)} `);
    }
    try {
      openingBalance = toDecimal(snapshot.balance).plus(total);
    } catch (err) {
      throw new Error(`Failed to compute openingBalance from snapshot: ${String(err)}`);
    }
  } else {
    // No valid snapshot: compute wallet.initialBalance + sum of all transactions strictly before firstOrdering
    const wallet = await Wallet.findOne({ _id: walletId, tenantId }).lean();
    const initial = toDecimal(wallet?.initialBalance ?? '0');

    const beforePred2 = orderingUtils.buildBeforePredicate(firstOrdering);
    const match: any = { tenantId, userId, walletId, ...beforePred2 };
    const pipeline = [
      { $match: match },
      { $project: { effect: { $switch: { branches: [
        { case: { $eq: ['$type', 'INCOME'] }, then: '$amount' },
        { case: { $eq: ['$type', 'EXPENSE'] }, then: { $multiply: ['$amount', -1] } },
      ], default: 0 } } } },
      { $group: { _id: null, total: { $sum: '$effect' } } },
    ];

    const aggRes = await Transaction.aggregate(pipeline).allowDiskUse(true).exec();
    const totalRaw = aggRes?.[0]?.total ?? 0;
    const totalStr = totalRaw && typeof totalRaw.toString === 'function' ? totalRaw.toString() : String(totalRaw);
    const Decimal = (await import('decimal.js')).default;
    let total: any;
    try {
      total = new Decimal(totalStr);
    } catch (err) {
      throw new Error(`Failed to parse aggregate total: ${String(err)}`);
    }
    try {
      openingBalance = initial.plus(total);
    } catch (err) {
      throw new Error(`Failed to compute openingBalance from initial balance: ${String(err)}`);
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

  return { openingBalance: openingBalance.toString(), transactions: result, nextCursor, hasMore, limit };
};

