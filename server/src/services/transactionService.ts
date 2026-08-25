import mongoose, { type ClientSession } from 'mongoose';
import { WalletModel } from '../models/Wallet.js';
import { TransactionModel } from '../models/Transaction.js';
import { TransactionAuditModel } from '../models/TransactionAudit.js';
import { cacheDelete } from '../db/redis.js';
import { walletRepository } from '../repositories/walletRepository.js';
import { transactionRepository } from '../repositories/transactionRepository.js';
import { parseDateInput } from '../utils/date.js';

const recalculateWalletBalance = async (userId: string, walletId: string, session?: ClientSession) => {
  const wallet = await WalletModel.findOne({ _id: walletId, userId, isActive: { $ne: false } }).session(session ?? null).lean();
  if (!wallet) {
    return null;
  }

  const txList = await TransactionModel.find({ userId, walletId, status: 'ACTIVE' }).sort({ date: 1, createdAt: 1 }).session(session ?? null).lean();
  const sorted = [...txList].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let runningBalance = Number(wallet.openingBalance || 0);

  for (const tx of sorted) {
    const balanceBefore = runningBalance;
    runningBalance = tx.type === 'INCOME' ? runningBalance + Number(tx.amount || 0) : runningBalance - Number(tx.amount || 0);

    if (runningBalance < 0) {
      throw new Error('Insufficient balance');
    }

    await TransactionModel.findByIdAndUpdate(
      tx._id,
      {
        balanceBefore,
        balanceAfter: runningBalance,
        updatedAt: new Date(),
      },
      { session, new: true }
    );
  }

  await WalletModel.findByIdAndUpdate(
    walletId,
    {
      currentBalance: runningBalance,
      updatedAt: new Date(),
    },
    { session, new: true }
  );

  return runningBalance;
};

export const transactionService = {
  async listTransactions(userId: string, filters: { walletId?: string; category?: string; limit?: number; before?: string }) {
    const query: { walletId?: string; category?: string; from?: Date; to?: Date } = {};

    if (filters.walletId) query.walletId = filters.walletId;
    if (filters.category) query.category = filters.category;

    const list = await transactionRepository.listByUser(userId, query);
    const sorted = [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const pageSize = Number(filters.limit ?? 20) || 20;
    let start = 0;

    if (filters.before) {
      const beforeIndex = sorted.findIndex((tx) => String((tx as any)._id) === filters.before);
      if (beforeIndex >= 0) start = beforeIndex + 1;
    }

    const page = sorted.slice(start, start + pageSize);
    const nextCursor = start + pageSize < sorted.length ? page[page.length - 1]?._id?.toString() ?? null : null;

    return {
      data: page,
      nextCursor,
      hasMore: start + pageSize < sorted.length,
    };
  },

  async getInsights(userId: string) {
    const wallets = await walletRepository.listByUser(userId);
    const txList = await transactionRepository.listByUser(userId);

    const income = txList.filter((tx) => tx.type === 'INCOME').reduce((sum, tx) => sum + tx.amount, 0);
    const expense = txList.filter((tx) => tx.type === 'EXPENSE').reduce((sum, tx) => sum + tx.amount, 0);
    const walletTotal = wallets.reduce((sum, wallet) => sum + Number(wallet.currentBalance || 0), 0);

    const now = new Date();
    const monthSeries = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      const name = date.toLocaleString('en-US', { month: 'short' });
      return {
        name,
        Income: 0,
        Expense: 0,
      };
    });

    for (const tx of txList) {
      const txDate = new Date(tx.date);
      const monthIndex = monthSeries.findIndex((item) => {
        const itemDate = new Date(now.getFullYear(), now.getMonth() - (5 - monthSeries.indexOf(item)), 1);
        return itemDate.getFullYear() === txDate.getFullYear() && itemDate.getMonth() === txDate.getMonth();
      });

      if (monthIndex >= 0) {
        if (tx.type === 'INCOME') {
          monthSeries[monthIndex].Income += Number(tx.amount || 0);
        }
        if (tx.type === 'EXPENSE') {
          monthSeries[monthIndex].Expense += Number(tx.amount || 0);
        }
      }
    }

    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthExpenses = txList.filter((tx) => {
      const txDate = new Date(tx.date);
      return tx.type === 'EXPENSE' && txDate >= currentMonthStart && txDate < new Date(now.getFullYear(), now.getMonth() + 1, 1);
    });

    const categoryMap = new Map<string, number>();
    for (const tx of currentMonthExpenses) {
      const category = String(tx.category || 'Other');
      categoryMap.set(category, (categoryMap.get(category) ?? 0) + Number(tx.amount || 0));
    }

    const categoryChart = Array.from(categoryMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const savingsRate = income > 0 ? Math.max(0, Math.round(((income - expense) / income) * 100)) : 0;
    const insightMessage = savingsRate >= 30
      ? 'Your savings rate is strong this month.'
      : savingsRate >= 10
        ? 'You are building a healthy buffer.'
        : 'Consider reducing expenses to improve your monthly savings.';

    return {
      income,
      expense,
      walletTotal,
      monthlyChart: monthSeries,
      categoryChart,
      insightMessage,
    };
  },

  async getStatement(userId: string, filters: { walletId?: string; from?: string; to?: string; startDate?: string; endDate?: string }) {
    const walletIds = filters.walletId ? [filters.walletId] : (await walletRepository.listByUser(userId)).map((wallet) => String(wallet._id));

    const query: { walletId?: string; from?: Date; to?: Date } = {};
    if (filters.walletId) {
      query.walletId = filters.walletId;
    }
    if (filters.from || filters.startDate) {
      query.from = parseDateInput(filters.from || filters.startDate, false);
    }
    if (filters.to || filters.endDate) {
      query.to = parseDateInput(filters.to || filters.endDate, true);
    }

    const transactions = await transactionRepository.listByUser(userId, query);
    const filteredTransactions = transactions
      .filter((tx) => walletIds.includes(String(tx.walletId)))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const wallets = await walletRepository.listByUser(userId);
    const selectedWallets = walletIds.length > 0 ? wallets.filter((wallet) => walletIds.includes(String(wallet._id))) : wallets;
    const openingBalance = selectedWallets.reduce((sum, wallet) => sum + Number(wallet.openingBalance || 0), 0);
    const totalIncome = filteredTransactions
      .filter((tx) => tx.type === 'INCOME')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const totalExpense = filteredTransactions
      .filter((tx) => tx.type === 'EXPENSE')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const closingBalance = openingBalance + totalIncome - totalExpense;

    return {
      openingBalance,
      totalIncome,
      totalExpense,
      closingBalance,
      transactions: filteredTransactions,
    };
  },

  async getTransactionAuditLogs(userId: string, transactionId?: string) {
    if (transactionId) {
      const transaction = await transactionRepository.findByIdForUser(userId, transactionId);
      if (!transaction) {
        throw new Error('Transaction not found');
      }

      return TransactionAuditModel.find({ transactionId, userId }).sort({ changedAt: -1 }).lean();
    }

    return TransactionAuditModel.find({ userId }).sort({ changedAt: -1 }).lean();
  },

  async createTransaction(userId: string, payload: Record<string, any>) {
    const walletId = String(payload.walletId || '').trim();
    const amount = Number(payload.amount ?? 0);
    const type = String(payload.type || 'EXPENSE').toUpperCase();
    const category = String(payload.category || 'Other').trim();
    const date = payload.date ? new Date(payload.date) : new Date();

    if (!walletId) throw new Error('Wallet is required');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than zero');
    if (type !== 'INCOME' && type !== 'EXPENSE') throw new Error('Type must be INCOME or EXPENSE');
    if (Number.isNaN(date.getTime())) throw new Error('Date is invalid');

    const session = await mongoose.startSession();

    try {
      let createdTransaction: any = null;

      await session.withTransaction(async () => {
        const wallet = await WalletModel.findOne({ _id: walletId, userId, isActive: { $ne: false } }).session(session).lean();
        if (!wallet) throw new Error('Wallet not found');

        if (type === 'EXPENSE') {
          const projectedBalance = Number(wallet.currentBalance || 0) - amount;
          if (projectedBalance < 0) {
            throw new Error('Insufficient balance');
          }
        }

        createdTransaction = await TransactionModel.create([{ 
          userId,
          walletId,
          type,
          amount,
          category,
          date,
          note: payload.note || '',
          balanceBefore: Number(wallet.currentBalance || 0),
          balanceAfter: Number(wallet.currentBalance || 0) + (type === 'INCOME' ? amount : -amount),
        }], { session });

        await recalculateWalletBalance(userId, walletId, session);
      });

      await cacheDelete(`wallets:${userId}`);
      return createdTransaction[0] ?? createdTransaction;
    } finally {
      await session.endSession();
    }
  },

  async updateTransaction(userId: string, transactionId: string, payload: Record<string, any>) {
    const session = await mongoose.startSession();

    try {
      let updatedTransaction: any = null;

      await session.withTransaction(async () => {
        const current = await TransactionModel.findOne({ _id: transactionId, userId, status: 'ACTIVE' }).session(session).lean();
        if (!current) throw new Error('Transaction not found');

        const oldWalletId = String(current.walletId);
        const nextWalletId = payload.walletId ? String(payload.walletId) : oldWalletId;
        const nextWallet = await WalletModel.findOne({ _id: nextWalletId, userId, isActive: { $ne: false } }).session(session).lean();
        if (!nextWallet) throw new Error('Wallet not found');

        const oldWallet = await WalletModel.findOne({ _id: oldWalletId, userId, isActive: { $ne: false } }).session(session).lean();
        if (!oldWallet) throw new Error('Wallet not found');

        const nextAmount = payload.amount !== undefined ? Number(payload.amount) : Number(current.amount);
        const nextType = payload.type ? String(payload.type).toUpperCase() : String(current.type);
        const nextDate = payload.date ? new Date(payload.date) : current.date;

        if (!Number.isFinite(nextAmount) || nextAmount <= 0) throw new Error('Amount must be greater than zero');
        if (nextType !== 'INCOME' && nextType !== 'EXPENSE') throw new Error('Type must be INCOME or EXPENSE');
        if (Number.isNaN(nextDate.getTime())) throw new Error('Date is invalid');

        const oldEffect = current.type === 'INCOME' ? Number(current.amount || 0) : -Number(current.amount || 0);
        const nextEffect = nextType === 'INCOME' ? nextAmount : -nextAmount;

        if (oldWalletId === nextWalletId) {
          const projectedBalance = Number(oldWallet.currentBalance || 0) - oldEffect + nextEffect;
          if (nextEffect < 0 && projectedBalance < 0) {
            throw new Error('Insufficient balance');
          }
        } else {
          const projectedNewWalletBalance = Number(nextWallet.currentBalance || 0) + nextEffect;
          if (nextEffect < 0 && projectedNewWalletBalance < 0) {
            throw new Error('Insufficient balance');
          }
        }

        const previousValues = {
          walletId: oldWalletId,
          amount: Number(current.amount),
          type: current.type,
          category: current.category,
          date: current.date,
          note: current.note || '',
        };

        const nextValues = {
          walletId: nextWalletId,
          amount: nextAmount,
          type: nextType,
          category: payload.category ?? current.category,
          date: nextDate,
          note: payload.note ?? current.note,
        };

        updatedTransaction = await TransactionModel.findByIdAndUpdate(
          transactionId,
          {
            ...nextValues,
            updatedAt: new Date(),
          },
          { new: true, session }
        ).lean();

        await TransactionAuditModel.create([{
          transactionId,
          userId,
          walletId: nextWalletId,
          changedBy: userId,
          changedAt: new Date(),
          oldValues: previousValues,
          newValues: nextValues,
          changeReason: 'User edited transaction',
        }], { session });

        const walletIds = Array.from(new Set([oldWalletId, nextWalletId]));
        for (const walletId of walletIds) {
          await recalculateWalletBalance(userId, walletId, session);
        }
      });

      await cacheDelete(`wallets:${userId}`);
      return updatedTransaction;
    } finally {
      await session.endSession();
    }
  },

  async deleteTransaction(userId: string, transactionId: string) {
    const session = await mongoose.startSession();

    try {
      let deleted = false;

      await session.withTransaction(async () => {
        const transaction = await TransactionModel.findOne({ _id: transactionId, userId, status: 'ACTIVE' }).session(session).lean();
        if (!transaction) throw new Error('Transaction not found');

        const walletId = String(transaction.walletId);
        const oldValues = {
          walletId: String(transaction.walletId),
          amount: Number(transaction.amount),
          type: transaction.type,
          category: transaction.category,
          date: transaction.date,
          note: transaction.note || '',
          status: transaction.status || 'ACTIVE',
        };

        await TransactionAuditModel.create([{
          transactionId,
          userId,
          walletId,
          changedBy: userId,
          changedAt: new Date(),
          oldValues,
          newValues: {
            walletId: String(transaction.walletId),
            amount: Number(transaction.amount),
            type: transaction.type,
            category: transaction.category,
            date: transaction.date,
            note: transaction.note || '',
            status: 'DELETED',
          },
          changeReason: 'User deleted transaction',
        }], { session });

        await TransactionModel.findByIdAndUpdate(
          transactionId,
          { status: 'DELETED', updatedAt: new Date() },
          { session, new: true }
        );

        await recalculateWalletBalance(userId, walletId, session);
        deleted = true;
      });

      await cacheDelete(`wallets:${userId}`);
      return deleted;
    } finally {
      await session.endSession();
    }
  },
};
