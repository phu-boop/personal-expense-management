import { WalletModel } from '../models/Wallet.js';
import { walletRepository } from '../repositories/walletRepository.js';
import { transactionRepository } from '../repositories/transactionRepository.js';

const recalculateWalletBalance = async (userId: string, walletId: string) => {
  const wallet = await walletRepository.findByIdForUser(userId, walletId);
  if (!wallet) {
    return null;
  }

  const txList = await transactionRepository.listByUser(userId, { walletId });
  const sorted = [...txList].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let runningBalance = Number(wallet.openingBalance || 0);

  for (const tx of sorted) {
    const balanceBefore = runningBalance;
    runningBalance = tx.type === 'INCOME' ? runningBalance + Number(tx.amount || 0) : runningBalance - Number(tx.amount || 0);

    if (runningBalance < 0) {
      throw new Error('Insufficient balance');
    }

    await transactionRepository.updateById(String(tx._id), {
      balanceBefore,
      balanceAfter: runningBalance,
      updatedAt: new Date(),
    });
  }

  await WalletModel.findByIdAndUpdate(walletId, {
    currentBalance: runningBalance,
    updatedAt: new Date(),
  });

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

    return {
      income,
      expense,
      walletTotal,
    };
  },

  async getStatement(userId: string, filters: { walletId?: string; from?: string; to?: string }) {
    const walletIds = filters.walletId ? [filters.walletId] : (await walletRepository.listByUser(userId)).map((wallet) => String(wallet._id));

    const query: { walletId?: string; from?: Date; to?: Date } = {};
    if (filters.walletId) {
      query.walletId = filters.walletId;
    }
    if (filters.from) {
      query.from = new Date(filters.from);
    }
    if (filters.to) {
      query.to = new Date(filters.to);
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

    const wallet = await walletRepository.findByIdForUser(userId, walletId);
    if (!wallet) throw new Error('Wallet not found');

    if (type === 'EXPENSE') {
      const projectedBalance = Number(wallet.currentBalance || 0) - amount;
      if (projectedBalance < 0) {
        throw new Error('Insufficient balance');
      }
    }

    const transaction = await transactionRepository.create({
      userId,
      walletId,
      type,
      amount,
      category,
      date,
      note: payload.note || '',
      balanceBefore: Number(wallet.currentBalance || 0),
      balanceAfter: Number(wallet.currentBalance || 0) + (type === 'INCOME' ? amount : -amount),
    });

    await recalculateWalletBalance(userId, walletId);
    return transaction;
  },

  async updateTransaction(userId: string, transactionId: string, payload: Record<string, any>) {
    const current = await transactionRepository.findByIdForUser(userId, transactionId);
    if (!current) throw new Error('Transaction not found');

    const oldWalletId = String(current.walletId);
    const nextWalletId = payload.walletId ? String(payload.walletId) : oldWalletId;
    const nextWallet = await walletRepository.findByIdForUser(userId, nextWalletId);
    if (!nextWallet) throw new Error('Wallet not found');

    const nextAmount = payload.amount !== undefined ? Number(payload.amount) : Number(current.amount);
    const nextType = payload.type ? String(payload.type).toUpperCase() : String(current.type);
    const nextDate = payload.date ? new Date(payload.date) : current.date;

    if (!Number.isFinite(nextAmount) || nextAmount <= 0) throw new Error('Amount must be greater than zero');
    if (nextType !== 'INCOME' && nextType !== 'EXPENSE') throw new Error('Type must be INCOME or EXPENSE');
    if (Number.isNaN(nextDate.getTime())) throw new Error('Date is invalid');

    const previousValues = {
      walletId: oldWalletId,
      amount: Number(current.amount),
      type: current.type,
      category: current.category,
      date: current.date,
      note: current.note || '',
    };

    const updatedTransaction = await transactionRepository.updateById(transactionId, {
      walletId: nextWalletId,
      amount: nextAmount,
      type: nextType,
      category: payload.category ?? current.category,
      date: nextDate,
      note: payload.note ?? current.note,
      updatedAt: new Date(),
    });

    try {
      const walletIds = Array.from(new Set([oldWalletId, nextWalletId]));
      for (const walletId of walletIds) {
        await recalculateWalletBalance(userId, walletId);
      }
      return updatedTransaction;
    } catch (error) {
      await transactionRepository.updateById(transactionId, {
        ...previousValues,
        updatedAt: new Date(),
      });

      for (const walletId of Array.from(new Set([oldWalletId, nextWalletId]))) {
        await recalculateWalletBalance(userId, walletId);
      }

      throw error;
    }
  },

  async deleteTransaction(userId: string, transactionId: string) {
    const transaction = await transactionRepository.findByIdForUser(userId, transactionId);
    if (!transaction) throw new Error('Transaction not found');

    const walletId = String(transaction.walletId);

    try {
      await transactionRepository.deleteById(transactionId);
      await recalculateWalletBalance(userId, walletId);
      return true;
    } catch (error) {
      await transactionRepository.updateById(transactionId, {
        ...transaction,
        status: 'ACTIVE',
        updatedAt: new Date(),
      });
      await recalculateWalletBalance(userId, walletId);
      throw error;
    }
  },
};
