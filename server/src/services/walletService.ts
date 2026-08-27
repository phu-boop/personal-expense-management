import { cacheGet, cacheSet } from '../db/redis.js';
import { walletRepository } from '../repositories/walletRepository.js';

export const walletService = {
  async listWalletsForUser(userId: string) {
    const cacheKey = `wallets:${userId}`;
    const cached = await cacheGet(cacheKey);

    if (cached) {
      return { data: JSON.parse(cached), source: 'cache' };
    }

    const wallets = await walletRepository.listByUser(userId);
    await cacheSet(cacheKey, JSON.stringify(wallets), 60);

    return { data: wallets, source: 'db' };
  },

  async createWalletForUser(userId: string, payload: Record<string, any>) {
    const name = String(payload.name || '').trim();
    const openingBalance = Number(payload.openingBalance ?? 0);

    if (!name) {
      throw new Error('Wallet name is required');
    }

    if (!Number.isFinite(openingBalance)) {
      throw new Error('Opening balance must be a valid number');
    }

    const wallet = await walletRepository.create({
      userId,
      name,
      bankName: payload.bankName || '',
      accountNumber: payload.accountNumber || '',
      currency: payload.currency || 'VND',
      openingBalance,
      openingDate: payload.openingDate ? new Date(payload.openingDate) : new Date(),
      currentBalance: openingBalance,
    });

    const wallets = await walletRepository.listByUser(userId);
    await cacheSet(`wallets:${userId}`, JSON.stringify(wallets), 60);

    return wallet;
  },

  async getWalletDetail(userId: string, walletId: string) {
    const wallet = await walletRepository.findByIdForUser(userId, walletId);

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    return wallet;
  },
};
