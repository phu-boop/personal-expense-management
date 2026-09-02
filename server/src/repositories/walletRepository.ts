import mongoose from 'mongoose';
import Wallet from '../models/Wallet';

export type WalletQueryResult = {
  _id: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  accountNumber?: string;
  initialBalance: mongoose.Types.Decimal128;
  currentBalance: mongoose.Types.Decimal128;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function insertWallet(doc: Partial<WalletQueryResult>) {
  const created = await Wallet.create(doc as any);
  return created.toObject() as WalletQueryResult;
}

export async function findWallets(query: mongoose.FilterQuery<unknown>, limit: number) {
  return Wallet.find<WalletQueryResult>(query).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
}

export async function findWalletById(walletId: string, tenantId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId) {
  return Wallet.findOne({ _id: walletId, tenantId, userId }).lean() as Promise<WalletQueryResult | null>;
}
