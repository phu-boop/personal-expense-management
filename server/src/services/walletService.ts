import mongoose from 'mongoose';

import { toDecimal, toDecimal128 } from '../utils/money';
import * as repo from '../repositories/walletRepository';

export interface CreateWalletInput {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  accountNumber?: string;
  initialBalance: string | mongoose.Types.Decimal128;
}

export interface ListWalletsInput {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  limit: number;
  cursor?: string;
}

export interface WalletQueryResult {
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
}

type DecodedCursor = { createdAt: Date; _id: mongoose.Types.ObjectId };

const decodeCursor = (cursor?: string): DecodedCursor | undefined => {
  if (!cursor) return undefined;

  const raw = Buffer.from(cursor, 'base64').toString('utf8');
  const payload = JSON.parse(raw) as { createdAt?: string; _id?: string } | null;
  if (!payload?.createdAt || !payload?._id) throw new Error('Invalid cursor');

  const createdAt = new Date(payload.createdAt);
  if (Number.isNaN(createdAt.getTime())) throw new Error('Invalid cursor');

  return { createdAt, _id: new mongoose.Types.ObjectId(payload._id) };
};

const encodeCursor = (wallet: Pick<WalletQueryResult, '_id' | 'createdAt'>) =>
  Buffer.from(JSON.stringify({ createdAt: wallet.createdAt.toISOString(), _id: wallet._id.toHexString() })).toString('base64');

export async function createWalletForUser(input: CreateWalletInput) {
  const { tenantId, userId, name, accountNumber, initialBalance } = input;

  const normalizedName = name.trim();
  if (!normalizedName) throw new Error('Wallet name is required');

  const amount = toDecimal(initialBalance);
  if (!amount.isFinite() || amount.isNaN()) throw new Error('initialBalance must be a valid decimal value');
  if (amount.isNegative()) throw new Error('initialBalance cannot be negative');

  const wallet = await repo.insertWallet({
    tenantId,
    userId,
    name: normalizedName,
    accountNumber: accountNumber?.trim() || undefined,
    initialBalance: toDecimal128(amount),
    initialBalanceDate: new Date(),
    currentBalance: toDecimal128(amount),
    version: 0,
  });

  return wallet as repo.WalletQueryResult;
}

export async function listWalletsForUser(input: ListWalletsInput) {
  const { tenantId, userId, limit, cursor } = input;
  const decodedCursor = decodeCursor(cursor);

  const baseQuery: mongoose.FilterQuery<repo.WalletQueryResult> = { tenantId, userId };
  const query = decodedCursor
    ? { ...baseQuery, $or: [{ createdAt: { $lt: decodedCursor.createdAt } }, { createdAt: decodedCursor.createdAt, _id: { $lt: decodedCursor._id } }] }
    : baseQuery;

  const wallets = await repo.findWallets(query, limit);

  const hasMore = wallets.length > limit;
  const items = hasMore ? wallets.slice(0, limit) : wallets;
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1] as repo.WalletQueryResult) : null;

  return { items, hasMore, nextCursor, limit };
}

export async function getWalletByIdForUser({ tenantId, userId, walletId }: { tenantId: mongoose.Types.ObjectId; userId: mongoose.Types.ObjectId; walletId: string; }) {
  const wallet = await repo.findWalletById(walletId, tenantId, userId);
  return wallet as repo.WalletQueryResult | null;
}
