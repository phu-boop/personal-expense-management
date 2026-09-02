import mongoose from 'mongoose';
import { toDecimal } from '../utils/money';
import { TransactionType } from '../models/Transaction';

export const parseLimit = (value: unknown): number => {
  const parsed = Number(value ?? 20);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('limit must be a positive integer');
  return Math.min(parsed, 100);
};

export const parseDate = (value: unknown, label = 'date'): Date => {
  if (value === undefined || value === null || value === '') throw new Error(`${label} is required`);
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid ISO date`);
  return new Date(date.toISOString());
};

export type Cursor = { date: Date; createdAt: Date; _id: mongoose.Types.ObjectId };

export const decodeCursor = (cursor?: string): Cursor | undefined => {
  if (!cursor) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { date?: string; createdAt?: string; _id?: string } | null;
    if (!payload?.date || !payload?.createdAt || !payload?._id) throw new Error('Invalid transaction cursor payload');
    const date = new Date(payload.date);
    const createdAt = new Date(payload.createdAt);
    if (Number.isNaN(date.getTime()) || Number.isNaN(createdAt.getTime())) throw new Error('Invalid transaction cursor timestamp');
    return { date, createdAt, _id: new mongoose.Types.ObjectId(payload._id) };
  } catch {
    throw new Error('Invalid cursor');
  }
};

export const encodeCursor = (transaction: { date: Date; createdAt: Date; _id: mongoose.Types.ObjectId }) =>
  Buffer.from(JSON.stringify({ date: transaction.date.toISOString(), createdAt: transaction.createdAt.toISOString(), _id: transaction._id.toString() })).toString('base64');

export const normalizeCategory = (category?: mongoose.Types.ObjectId | string) => {
  if (category === undefined || category === null) return undefined;
  if (typeof category === 'string') {
    if (!mongoose.isValidObjectId(category)) throw new Error('Invalid category');
    return new mongoose.Types.ObjectId(category);
  }
  return category;
};

export const validateTransactionType = (type: unknown): TransactionType => {
  if (type !== TransactionType.INCOME && type !== TransactionType.EXPENSE) throw new Error('type must be INCOME or EXPENSE');
  return type as TransactionType;
};

export const normalizeTransactionId = (id: string | mongoose.Types.ObjectId) => {
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (!mongoose.isValidObjectId(String(id))) throw new Error('Invalid transactionId');
  return new mongoose.Types.ObjectId(String(id));
};

export const parseAmount = (value: unknown) => {
  if (value === undefined || value === null || value === '') throw new Error('amount is required');
  const dec = toDecimal(String(value));
  if (!dec.isFinite() || dec.isNaN() || !dec.isPositive()) throw new Error('amount must be a positive decimal');
  return dec;
};
import mongoose from 'mongoose';
import { TransactionType } from '../models/Transaction';

export interface CreateTransactionInput {
  walletId: mongoose.Types.ObjectId;
  type: TransactionType;
  amount: number;
  category: string;
  date: Date;
  note?: string;
}

export class TransactionValidationError extends Error {}

export const validateCreateTransaction = (body: Record<string, unknown>): CreateTransactionInput => {
  const { walletId, type, amount, category, date, note } = body;

  if (typeof walletId !== 'string' || !mongoose.isValidObjectId(walletId)) {
    throw new TransactionValidationError('walletId must be a valid ObjectId');
  }

  if (type !== TransactionType.INCOME && type !== TransactionType.EXPENSE) {
    throw new TransactionValidationError('Invalid transaction type');
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new TransactionValidationError('Amount must be greater than 0');
  }

  if (typeof category !== 'string' || category.trim().length === 0 || category.length > 100) {
    throw new TransactionValidationError('Category is required and must be at most 100 characters');
  }

  const parsedDate = new Date(String(date));
  if (!date || Number.isNaN(parsedDate.getTime())) {
    throw new TransactionValidationError('Date must be valid');
  }

  if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
    throw new TransactionValidationError('Note must be at most 500 characters');
  }

  return {
    walletId: new mongoose.Types.ObjectId(walletId),
    type,
    amount,
    category: category.trim(),
    date: parsedDate,
    note: typeof note === 'string' ? note.trim() : undefined,
  };
};