import mongoose from 'mongoose';

import Wallet from '../models/Wallet';
import { toDecimal, toDecimal128 } from '../utils/money';

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

const decodeCursor = (cursor?: string) => {
  if (!cursor) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
      createdAt?: string;
      _id?: string;
    };

    if (!payload.createdAt || !payload._id) {
      throw new Error('Invalid cursor payload');
    }

    const createdAt = new Date(payload.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid cursor date');
    }

    return {
      createdAt,
      _id: new mongoose.Types.ObjectId(payload._id),
    };
  } catch {
    throw new Error('Invalid cursor');
  }
};

const encodeCursor = (wallet: WalletQueryResult) => {
  const payload = {
    createdAt: wallet.createdAt.toISOString(),
    _id: wallet._id.toHexString(),
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
};

export async function createWalletForUser(input: CreateWalletInput) {
  const { tenantId, userId, name, accountNumber, initialBalance } = input;

  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error('Wallet name is required');
  }

  const amount = toDecimal(initialBalance);
  if (!amount.isFinite() || amount.isNaN()) {
    throw new Error('initialBalance must be a valid decimal value');
  }

  if (amount.isNegative()) {
    throw new Error('initialBalance cannot be negative');
  }

  const wallet = await Wallet.create({
    tenantId,
    userId,
    name: normalizedName,
    accountNumber: accountNumber?.trim() || undefined,
    initialBalance: toDecimal128(amount),
    initialBalanceDate: new Date(),
    currentBalance: toDecimal128(amount),
    version: 0,
  });

  return wallet.toObject() as WalletQueryResult;
}

export async function listWalletsForUser(input: ListWalletsInput) {
  const { tenantId, userId, limit, cursor } = input;
  const decodedCursor = decodeCursor(cursor);

  const query: mongoose.FilterQuery<WalletQueryResult> = {
  tenantId,
  userId,
    };

  if (decodedCursor) {
    query.$or = [
      { createdAt: { $lt: decodedCursor.createdAt } },
      {
        createdAt: decodedCursor.createdAt,
        _id: { $lt: decodedCursor._id },
      },
    ];
  }

  const wallets = await Wallet.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = wallets.length > limit;
  const items = hasMore ? wallets.slice(0, limit) : wallets;
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1] as WalletQueryResult) : null;

  return {
    items,
    hasMore,
    nextCursor,
    limit,
  };
}

export async function getWalletByIdForUser({
  tenantId,
  userId,
  walletId,
}: {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  walletId: string;
}) {
  const wallet = await Wallet.findOne({
    _id: walletId,
    tenantId,
    userId,
  }).lean();

  return wallet as WalletQueryResult | null;
}
