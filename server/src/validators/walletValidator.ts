import mongoose from 'mongoose';
import { toDecimal } from '../utils/money';

export type CreateWalletBody = { name?: unknown; accountNumber?: unknown; initialBalance?: unknown };

export const parseLimit = (value?: unknown): number => {
  const parsed = Number(value ?? 20);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('limit must be a positive integer');
  return Math.min(parsed, 100);
};

export type ValidatedCreate = {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  accountNumber?: string;
  initialBalanceDecimal: ReturnType<typeof toDecimal>;
};

export const validateCreateBody = (body: CreateWalletBody, userTenantId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId): ValidatedCreate => {
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
  };
};

export type DecodedCursor = { createdAt: Date; _id: mongoose.Types.ObjectId };

export const decodeCursor = (cursor?: string): DecodedCursor | undefined => {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { createdAt?: string; _id?: string } | null;
    if (!parsed?.createdAt || !parsed?._id) throw new Error('Invalid cursor');
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error('Invalid cursor');
    return { createdAt, _id: new mongoose.Types.ObjectId(parsed._id) };
  } catch {
    throw new Error('Invalid cursor');
  }
};

export const encodeCursor = (createdAt: Date, id: mongoose.Types.ObjectId) =>
  Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), _id: id.toHexString() })).toString('base64');
