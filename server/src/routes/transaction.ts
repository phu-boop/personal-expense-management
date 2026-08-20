import express, { Response } from 'express';
import { AuthRequest, authenticate } from '../middleware/auth';
import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import mongoose from 'mongoose';

const router = express.Router();
router.use(authenticate);

// Create a new transaction (Income/Expense)
router.post('/', async (req: AuthRequest, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { walletId, type, amount, category, date, note } = req.body;

    if (!walletId || !type || !amount || !category || !date) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (amount <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than 0' });
    }

    const wallet = await Wallet.findOne({ _id: walletId, userId: req.user!.id }).session(session);
    if (!wallet) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    const balanceBefore = wallet.currentBalance;
    let balanceAfter = balanceBefore;

    if (type === TransactionType.INCOME) {
      balanceAfter += amount;
    } else if (type === TransactionType.EXPENSE) {
      if (wallet.currentBalance < amount) {
        return res.status(400).json({ message: 'Insufficient balance in wallet' });
      }
      balanceAfter -= amount;
    } else {
      return res.status(400).json({ message: 'Invalid transaction type' });
    }

    wallet.currentBalance = balanceAfter;
    await wallet.save({ session });

    const transaction = new Transaction({
      userId: req.user!.id,
      walletId,
      type,
      amount,
      category,
      date: new Date(date),
      note,
      balanceBefore,
      balanceAfter,
    });

    await transaction.save({ session });
    await session.commitTransaction();

    res.status(201).json(transaction);
  } catch (error) {
    await session.abortTransaction();
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  } finally {
    session.endSession();
  }
});

// Get transactions history
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { walletId, page = 1, limit = 50 } = req.query;

    const query: any = { userId: req.user!.id };
    if (walletId) {
      query.walletId = walletId;
    }

    const transactions = await Transaction.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('walletId', 'name');

    const total = await Transaction.countDocuments(query);

    res.json({
      data: transactions,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Statement/Report API
router.get('/statement', async (req: AuthRequest, res: Response) => {
  try {
    const { walletId, startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    const query: any = {
      userId: req.user!.id,
      date: {
        $gte: new Date(startDate as string),
        $lte: new Date(endDate as string),
      },
    };

    if (walletId) {
      query.walletId = new mongoose.Types.ObjectId(walletId as string);
    }

    // Aggregation for summary
    const summaryResult = await Transaction.aggregate([
      { $match: query },
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

    // Get earliest transaction in the period for balanceBefore
    const earliestTx = await Transaction.findOne(query).sort({ date: 1, createdAt: 1 });
    // Get latest transaction in the period for balanceAfter
    const latestTx = await Transaction.findOne(query).sort({ date: -1, createdAt: -1 });

    const openingBalance = earliestTx ? earliestTx.balanceBefore : 0;
    const closingBalance = latestTx ? latestTx.balanceAfter : 0;

    // Get list of transactions
    const transactions = await Transaction.find(query).sort({ date: -1, createdAt: -1 });

    res.json({
      summary: {
        openingBalance,
        totalIncome: summary.totalIncome,
        totalExpense: summary.totalExpense,
        closingBalance,
      },
      transactions,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Insights API
router.get('/insights', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const now = new Date();

    // 1. Chart Data (Last 6 Months)
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const monthlyData = await Transaction.aggregate([
      {
        $match: {
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

    // 2. Category Breakdown (Current Month)
    const firstDayCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const categoryData = await Transaction.aggregate([
      {
        $match: {
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

    // 3. Mini Insight (Compare with last month or highlight highest category)
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
