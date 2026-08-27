import { TransactionModel } from '../models/Transaction.js';

export const transactionRepository = {
  async listByUser(userId: string, filters?: { walletId?: string; category?: string; from?: Date; to?: Date }) {
    const query: Record<string, any> = { userId, status: 'ACTIVE' };

    if (filters?.walletId) query.walletId = filters.walletId;
    if (filters?.category) query.category = filters.category;
    if (filters?.from || filters?.to) {
      query.date = {};
      if (filters.from) query.date.$gte = filters.from;
      if (filters.to) query.date.$lte = filters.to;
    }

    return TransactionModel.find(query).sort({ date: -1, createdAt: -1 }).lean();
  },

  async findByIdForUser(userId: string, transactionId: string) {
    return TransactionModel.findOne({ _id: transactionId, userId, status: 'ACTIVE' }).lean();
  },

  async create(data: {
    userId: string;
    walletId: string;
    type: 'INCOME' | 'EXPENSE';
    amount: number;
    category: string;
    date: Date;
    note?: string;
    balanceBefore: number;
    balanceAfter: number;
  }) {
    return TransactionModel.create(data);
  },

  async updateById(transactionId: string, update: Record<string, any>) {
    return TransactionModel.findByIdAndUpdate(transactionId, update, { new: true }).lean();
  },

  async deleteById(transactionId: string) {
    return TransactionModel.findByIdAndUpdate(
      transactionId,
      { status: 'DELETED', updatedAt: new Date() },
      { new: true }
    ).lean();
  },
};
