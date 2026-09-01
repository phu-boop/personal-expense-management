import express, { Response } from 'express';
import mongoose from 'mongoose';

import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  createTransaction,
  createTransactionWithInvalidation,
  editTransaction,
  InsufficientBalanceError,
  TransactionNotFoundError,
  TransactionServiceError,
  WalletNotFoundError,
} from '../services/transactionService';
import { toDecimal } from '../utils/money';
import { getTransactionEffect } from '../utils/transactionEffect';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import orderingUtils from '../utils/ordering';

const router = express.Router();

const parseLimit = (value: unknown): number => {
  const parsed = Number(value ?? 20);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('limit must be a positive integer');
  }

  return Math.min(parsed, 100);
};

const parseDate = (value: unknown, label: string): Date => {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${label} is required`);
  }

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid ISO date`);
  }

  return new Date(date.toISOString());
};

const decodeCursor = (cursor?: string) => {
  if (!cursor) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
      date?: string;
      createdAt?: string;
      _id?: string;
    };

    if (!payload.date || !payload.createdAt || !payload._id) {
      throw new Error('Invalid transaction cursor payload');
    }

    const date = new Date(payload.date);
    const createdAt = new Date(payload.createdAt);
    if (Number.isNaN(date.getTime()) || Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid transaction cursor timestamp');
    }

    return {
      date,
      createdAt,
      _id: new mongoose.Types.ObjectId(payload._id),
    };
  } catch {
    throw new Error('Invalid cursor');
  }
};

const encodeCursor = (transaction: any) => {
  const payload = {
    date: transaction.date.toISOString(),
    createdAt: transaction.createdAt.toISOString(),
    _id: transaction._id.toString(),
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
};

const ensureWalletAccess = async (req: AuthRequest, walletId: string) => {
  if (!mongoose.isValidObjectId(walletId)) {
    throw new TransactionServiceError('Invalid walletId');
  }

  const wallet = await Wallet.findOne({
    _id: walletId,
    tenantId: req.user!.tenantId,
    userId: req.user!.id,
  }).lean();

  if (!wallet) {
    throw new WalletNotFoundError();
  }

  return wallet;
};

router.use(authenticate);

router.post('/:walletId/transactions', async (req: AuthRequest, res: Response) => {
  try {
    const { walletId } = req.params;
    await ensureWalletAccess(req, walletId);

    const { amount, type, date, category, note } = req.body ?? {};

    if (amount === undefined || amount === null || amount === '') {
      return res.status(400).json({ error: 'ValidationError', message: 'amount is required' });
    }

    if (type !== TransactionType.INCOME && type !== TransactionType.EXPENSE) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'type must be INCOME or EXPENSE',
      });
    }

    const parsedDate = parseDate(date, 'date');
    const amountDecimal = toDecimal(String(amount));

    if (!amountDecimal.isFinite() || amountDecimal.isNaN() || !amountDecimal.isPositive()) {
      return res.status(400).json({ error: 'ValidationError', message: 'amount must be a positive decimal' });
    }

    if (category !== undefined && category !== null && category !== '' && !mongoose.isValidObjectId(String(category))) {
      return res.status(400).json({ error: 'ValidationError', message: 'Invalid category' });
    }

    const transaction = await createTransactionWithInvalidation({
      tenantId: req.user!.tenantId!,
      userId: req.user!.id,
      walletId: new mongoose.Types.ObjectId(walletId),
      amount: amountDecimal,
      type,
      date: parsedDate,
      category: category || undefined,
      note: typeof note === 'string' ? note.trim() || undefined : undefined,
    });

    return res.status(201).json({ transaction: transaction.toObject() });
  } catch (error: any) {
    if (error instanceof WalletNotFoundError) {
      return res.status(404).json({ error: 'WalletNotFound', message: error.message });
    }

    if (error instanceof InsufficientBalanceError) {
      return res.status(409).json({ error: 'InsufficientBalance', message: error.message });
    }

    if (error instanceof TransactionServiceError) {
      return res.status(400).json({ error: 'ValidationError', message: error.message });
    }

    console.error('Create transaction error:', error);
    return res.status(500).json({ error: 'InternalServerError', message: 'Failed to create transaction' });
  }
});

router.patch('/:walletId/transactions/:transactionId', async (req: AuthRequest, res: Response) => {
  try {
    const { walletId, transactionId } = req.params;
    await ensureWalletAccess(req, walletId);

    if (!mongoose.isValidObjectId(transactionId)) {
      return res.status(400).json({ error: 'ValidationError', message: 'Invalid transactionId' });
    }

    const payload = req.body ?? {};
    const hasAnyField = 'amount' in payload || 'type' in payload || 'date' in payload || 'note' in payload;
    if (!hasAnyField) {
      return res.status(400).json({ error: 'ValidationError', message: 'At least one field must be provided' });
    }

    const nextAmount = payload.amount !== undefined ? toDecimal(String(payload.amount)) : undefined;
    if (payload.amount !== undefined && (!nextAmount.isFinite() || nextAmount.isNaN() || !nextAmount.isPositive())) {
      return res.status(400).json({ error: 'ValidationError', message: 'amount must be a positive decimal' });
    }

    if (payload.type !== undefined && payload.type !== TransactionType.INCOME && payload.type !== TransactionType.EXPENSE) {
      return res.status(400).json({ error: 'ValidationError', message: 'type must be INCOME or EXPENSE' });
    }

    const nextDate = payload.date !== undefined ? parseDate(payload.date, 'date') : undefined;

    const transaction = await editTransaction({
      tenantId: req.user!.tenantId!,
      userId: req.user!.id,
      walletId: new mongoose.Types.ObjectId(walletId),
      transactionId: new mongoose.Types.ObjectId(transactionId),
      amount: nextAmount ?? undefined,
      type: payload.type,
      date: nextDate,
      note: payload.note,
    });

    return res.json({ transaction: transaction.toObject() });
  } catch (error: any) {
    if (error instanceof WalletNotFoundError) {
      return res.status(404).json({ error: 'WalletNotFound', message: error.message });
    }

    if (error instanceof TransactionNotFoundError) {
      return res.status(404).json({ error: 'TransactionNotFound', message: error.message });
    }

    if (error instanceof InsufficientBalanceError) {
      return res.status(409).json({ error: 'InsufficientBalance', message: error.message });
    }

    if (error instanceof TransactionServiceError) {
      return res.status(400).json({ error: 'ValidationError', message: error.message });
    }

    console.error('Edit transaction error:', error);
    return res.status(500).json({ error: 'InternalServerError', message: 'Failed to update transaction' });
  }
});

router.get('/:walletId/transactions', async (req: AuthRequest, res: Response) => {
  try {
    const { walletId } = req.params;
    const wallet = await ensureWalletAccess(req, walletId);

    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
    const fromDate = req.query.from ? parseDate(req.query.from, 'from') : new Date(wallet.initialBalanceDate);
    const toDate = req.query.to ? parseDate(req.query.to, 'to') : new Date();

    if (fromDate.getTime() >= toDate.getTime()) {
      return res.status(400).json({ error: 'ValidationError', message: 'from must be earlier than to' });
    }

    const boundary = cursor
      ? {
          date: cursor.date,
          createdAt: cursor.createdAt,
          _id: cursor._id,
        }
      : undefined;

    const query: any = {
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      walletId: new mongoose.Types.ObjectId(walletId),
    };

    if (boundary) {
      query.$or = [
        { date: { $gt: boundary.date } },
        { date: boundary.date, createdAt: { $gt: boundary.createdAt } },
        { date: boundary.date, createdAt: boundary.createdAt, _id: { $gt: boundary._id } },
      ];
    }

    const rangeQuery: any = {
      ...query,
      date: { $gte: fromDate, $lt: toDate },
    };

    const transactions = await Transaction.find(rangeQuery)
      .sort({ date: 1, createdAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean();

    // Compute openingBalance using BalanceSnapshot fast-path
    let openingBalance = toDecimal(wallet.initialBalance);

    // Determine the ordering of the first transaction in the page (or the page start)
    const firstTransactionOrdering = transactions.length > 0
      ? { date: transactions[0].date, createdAt: transactions[0].createdAt, _id: transactions[0]._id }
      : boundary
        ? { date: boundary.date, createdAt: boundary.createdAt, _id: boundary._id }
        : { date: fromDate, createdAt: new Date(0), _id: new mongoose.Types.ObjectId('000000000000000000000000') };

    // Find latest VALID snapshot strictly before firstTransactionOrdering
    const snapshot = await BalanceSnapshot.findOne({
      tenantId: req.user!.tenantId,
      walletId: new mongoose.Types.ObjectId(walletId),
      status: BalanceSnapshotStatus.VALID,
      $and: [
        { lastTransactionDate: { $exists: true } },
        { lastTransactionCreatedAt: { $exists: true } },
        { lastTransactionId: { $exists: true } },
      ],
      $or: orderingUtils.buildBeforePredicate({ date: firstTransactionOrdering.date, createdAt: firstTransactionOrdering.createdAt, _id: firstTransactionOrdering._id }),
    }).sort({ lastTransactionDate: -1, lastTransactionCreatedAt: -1, lastTransactionId: -1 }).lean();

    if (snapshot) {
      openingBalance = toDecimal(snapshot.balance);

      // Sum transactions strictly after snapshot checkpoint and strictly before firstTransactionOrdering
      const afterSnapOr = orderingUtils.buildAfterPredicate({ date: snapshot.lastTransactionDate!, createdAt: snapshot.lastTransactionCreatedAt!, _id: snapshot.lastTransactionId! });
      const beforeFirstOr = orderingUtils.buildBeforePredicate({ date: firstTransactionOrdering.date, createdAt: firstTransactionOrdering.createdAt, _id: firstTransactionOrdering._id });

      const betweenQuery: any = {
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        walletId: new mongoose.Types.ObjectId(walletId),
        $and: [ afterSnapOr, beforeFirstOr ],
      };

      const between = await Transaction.find(betweenQuery).sort({ date: 1, createdAt: 1, _id: 1 }).lean();
      for (const t of between) {
        const effect = getTransactionEffect(toDecimal(t.amount), t.type as TransactionType);
        openingBalance = openingBalance.plus(effect);
      }
    } else {
      // No snapshot found — aggregate all transactions before firstTransactionOrdering
      const histQuery: any = {
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        walletId: new mongoose.Types.ObjectId(walletId),
        $or: orderingUtils.buildBeforePredicate({ date: firstTransactionOrdering.date, createdAt: firstTransactionOrdering.createdAt, _id: firstTransactionOrdering._id }),
      };

      const historical = await Transaction.find(histQuery).sort({ date: 1, createdAt: 1, _id: 1 }).lean();
      for (const transaction of historical) {
        const effect = getTransactionEffect(toDecimal(transaction.amount), transaction.type as TransactionType);
        openingBalance = openingBalance.plus(effect);
      }
    }

    const pageItems = transactions.slice(0, limit);
    const hasMore = transactions.length > limit;

    let runningBalance = openingBalance;
    const result = pageItems.map((transaction: any) => {
      const balanceBefore = runningBalance;
      const effect = getTransactionEffect(toDecimal(transaction.amount), transaction.type as TransactionType);
      runningBalance = runningBalance.plus(effect);
      const balanceAfter = runningBalance;

      return {
        ...transaction,
        amount: transaction.amount?.$numberDecimal ?? String(transaction.amount ?? '0'),
        balanceBefore: balanceBefore.toString(),
        balanceAfter: balanceAfter.toString(),
      };
    });

    const nextCursor = hasMore && result.length > 0 ? encodeCursor(pageItems[pageItems.length - 1]) : null;

    return res.json({
      openingBalance: openingBalance.toString(),
      transactions: result,
      nextCursor,
      hasMore,
      limit,
    });
  } catch (error: any) {
    if (error instanceof WalletNotFoundError) {
      return res.status(404).json({ error: 'WalletNotFound', message: error.message });
    }

    if (error instanceof TransactionServiceError) {
      return res.status(400).json({ error: 'ValidationError', message: error.message });
    }

    console.error('List wallet transactions error:', error);
    return res.status(500).json({ error: 'InternalServerError', message: 'Failed to fetch transactions' });
  }
});

export default router;
