import { WalletModel } from '../models/Wallet.js';

export const walletRepository = {
  async listByUser(userId: string) {
    return WalletModel.find({ userId, isActive: true }).lean();
  },

  async findByIdForUser(userId: string, walletId: string) {
    return WalletModel.findOne({ _id: walletId, userId, isActive: true }).lean();
  },

  async create(data: {
    userId: string;
    name: string;
    bankName?: string;
    accountNumber?: string;
    currency?: string;
    openingBalance: number;
    openingDate: Date;
    currentBalance: number;
  }) {
    return WalletModel.create(data);
  },
};
