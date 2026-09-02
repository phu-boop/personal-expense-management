import express, { Request, Response } from 'express';
import mongoose from 'mongoose';

import { authenticate } from '../middleware/auth';
import { createWallet, listWallets, listWalletsCompact, getWallet } from '../controllers/walletController';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();

type WalletResponse = {
  _id: IWallet['_id'];
  tenantId: IWallet['tenantId'];
  userId: IWallet['userId'];
  name: string;
  accountNumber?: string;
  initialBalance: IWallet['initialBalance'];
  currentBalance: IWallet['currentBalance'];
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

const withWalletResponse = (wallet: IWallet): WalletResponse => ({
  _id: wallet._id,
  tenantId: wallet.tenantId,
  userId: wallet.userId,
  name: wallet.name,
  accountNumber: wallet.accountNumber,
  initialBalance: wallet.initialBalance,
  currentBalance: wallet.currentBalance,
  version: wallet.version,
  createdAt: wallet.createdAt,
  updatedAt: wallet.updatedAt,
});

const parseLimit = (value?: unknown): number => {
  const parsed = Number(value ?? 20);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('limit must be a positive integer');
  return Math.min(parsed, 100);
};

type Cursor = { createdAt: Date; _id: mongoose.Types.ObjectId };

const decodeCursor = (cursor?: string): Cursor | undefined => {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { createdAt: string; _id: string } | null;
    if (!parsed) return undefined;
    return { createdAt: new Date(parsed.createdAt), _id: new mongoose.Types.ObjectId(parsed._id) };
  } catch {
    return undefined;
  }
};

const encodeCursor = (wallet: { createdAt: Date; _id: mongoose.Types.ObjectId }) =>
  Buffer.from(JSON.stringify({ createdAt: wallet.createdAt.toISOString(), _id: wallet._id.toString() })).toString('base64');

router.use(authenticate);

type CreateWalletBody = { name?: unknown; accountNumber?: unknown; initialBalance?: unknown };

const validateCreateBody = (body: CreateWalletBody, userTenantId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId) => {
  const { name, accountNumber, initialBalance } = body;

  if (typeof name !== 'string' || !name.trim()) throw new Error('Wallet name is required');

  if (accountNumber !== undefined && (typeof accountNumber !== 'string' || !accountNumber.trim())) {
    throw new Error('accountNumber must be a non-empty string when provided');
  }

  if (initialBalance === undefined || initialBalance === null || initialBalance === '') throw new Error('initialBalance is required');

  const initialBalanceDecimal = toDecimal(String(initialBalance));
  if (!initialBalanceDecimal.isFinite() || initialBalanceDecimal.isNaN()) throw new Error('initialBalance must be a valid decimal value');
  if (initialBalanceDecimal.isNegative()) throw new Error('initialBalance cannot be negative');

  return {
    tenantId: userTenantId,
    userId,
    name: name.trim(),
    accountNumber: accountNumber?.trim() || undefined,
    initialBalanceDecimal,
  } as const;
};

router.post('/', createWallet as any);

router.get('/', listWallets as any);

// Compact wallet list: returns a slimmer payload for frontend consumption
router.get('/compact', listWalletsCompact as any);

router.get('/:walletId', getWallet as any);

export default router;
