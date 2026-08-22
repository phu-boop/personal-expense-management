import express, { Response } from 'express';
import { AuthRequest, authenticate, requireReadAccess, requireWriteAccess } from '../middleware/auth';
import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import mongoose from 'mongoose';
import { createTransaction, WalletNotFoundError } from '../services/transactionService';
import { TransactionValidationError, validateCreateTransaction } from '../validators/transactionValidator';
import {
  buildTransactionCursorFilter,
  buildTransactionListFilter,
  encodeCursor,
  normalizeTransactionCursorQuery,
} from '../services/transactionCursorQuery';
import { calculateStatementSummary } from '../services/statementSummaryService';

const router = express.Router();
router.use(authenticate);
router.use(requireReadAccess);

router.post('/', requireWriteAccess, async (req: AuthRequest, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const input = validateCreateTransaction(req.body);
    const transaction = await createTransaction(req.user!.tenantId!, req.user!.id, input, session);
    await session.commitTransaction();

    res.status(201).json(transaction);
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof TransactionValidationError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof WalletNotFoundError) {
      return res.status(404).json({ message: error.message });
    }
    if (error instanceof Error && error.message === 'Insufficient balance in wallet') {
      return res.status(400).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  } finally {
    session.endSession();
  }
});

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const normalized = normalizeTransactionCursorQuery(req.query);
    const baseFilter = buildTransactionListFilter(req.user!.tenantId!, req.user!.id, req.query);
    const filter = buildTransactionCursorFilter(baseFilter, normalized.before);

    const transactions = await Transaction.find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(normalized.limit + 1)
      .populate('walletId', 'name')
      .lean();

    const hasMore = transactions.length > normalized.limit;
    const pageItems = hasMore ? transactions.slice(0, normalized.limit) : transactions;
    const nextCursor = hasMore && pageItems.length > 0 ? encodeCursor(pageItems[pageItems.length - 1]) : null;

    res.json({
      data: pageItems,
      hasMore,
      nextCursor,
      limit: normalized.limit,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/statement', async (req: AuthRequest, res: Response) => {
  try {
    const { walletId, startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    const periodQuery: any = {
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      date: {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      },
    };

    if (walletId) {
      if (!mongoose.isValidObjectId(walletId)) {
        return res.status(400).json({ message: 'walletId must be a valid ObjectId' });
      }
      periodQuery.walletId = new mongoose.Types.ObjectId(walletId as string);
    }

    const summaryResult = await Transaction.aggregate([
      { $match: periodQuery },
      {
        $group: {
          _id: null,
          totalIncome: {
            $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', 0] }
          },
          totalExpense: {
            $sum: { $cond: [{ $eq: ['$type', TransactionType.EXPENSE] }, '$amount', 0] }
          }
        }
      }
    ]);

    const summary = summaryResult[0] || { totalIncome: 0, totalExpense: 0 };

    const wallets = await Wallet.find({ tenantId: req.user!.tenantId, userId: req.user!.id, ...(periodQuery.walletId ? { _id: periodQuery.walletId } : {}) })
      .select('_id initialBalance currentBalance')
      .lean();
    const periodStart = new Date(startDate as string);
    const openingBalances = await Transaction.aggregate([
      {
        $match: {
          tenantId: req.user!.tenantId,
          userId: req.user!.id,
          date: { $lt: periodStart },
          ...(periodQuery.walletId ? { walletId: periodQuery.walletId } : {}),
        },
      },
      { $sort: { date: -1, createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: '$walletId',
          balanceAfter: { $first: '$balanceAfter' },
        },
      },
    ]);
    const openingByWallet = new Map(openingBalances.map((item) => [item._id.toString(), item.balanceAfter]));
    const summaryResponse = calculateStatementSummary({
      wallets: wallets.map((wallet) => ({
        _id: wallet._id.toString(),
        initialBalance: wallet.initialBalance,
      })),
      openingByWallet,
      totalIncome: summary.totalIncome,
      totalExpense: summary.totalExpense,
    });

    const transactions = await Transaction.find(periodQuery).sort({ date: -1, createdAt: -1 });

    res.json({
      summary: summaryResponse,
      transactions,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/insights', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const now = new Date();

    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const monthlyData = await Transaction.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(String(tenantId)),
          userId: new mongoose.Types.ObjectId(userId),
          date: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: { month: { $month: '$date' }, year: { $year: '$date' } },
          income: { $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', 0] } },
          expense: { $sum: { $cond: [{ $eq: ['$type', TransactionType.EXPENSE] }, '$amount', 0] } }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const formattedMonthlyData = monthlyData.map(item => ({
      name: `${item._id.month}/${item._id.year}`,
      Income: item.income,
      Expense: item.expense
    }));

    const firstDayCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const categoryData = await Transaction.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(String(tenantId)),
          userId: new mongoose.Types.ObjectId(userId),
          type: TransactionType.EXPENSE,
          date: { $gte: firstDayCurrentMonth }
        }
      },
      {
        $group: {
          _id: '$category',
          value: { $sum: '$amount' }
        }
      },
      { $sort: { value: -1 } }
    ]);

    const formattedCategoryData = categoryData.map(item => ({
      name: item._id,
      value: item.value
    }));

    let insightMessage = "Keep tracking your expenses!";
    if (formattedCategoryData.length > 0) {
      const highestCategory = formattedCategoryData[0];
      insightMessage = `You spent the most on ${highestCategory.name} this month (${highestCategory.value.toLocaleString('vi-VN')} VND).`;
    }

    res.json({
      monthlyChart: formattedMonthlyData,
      categoryChart: formattedCategoryData,
      insightMessage
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
