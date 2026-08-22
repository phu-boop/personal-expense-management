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