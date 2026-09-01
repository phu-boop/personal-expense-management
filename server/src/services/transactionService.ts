import mongoose from 'mongoose';
import Decimal from 'decimal.js';

import Transaction, { ITransaction, TransactionType } from '../models/Transaction';
import Wallet from '../models/Wallet';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import orderingUtils from '../utils/ordering';
import { toDecimal, toDecimal128 } from '../utils/money';
import { getTransactionEffect } from '../utils/transactionEffect';

export interface CreateTransactionInput {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  amount: Decimal | string | mongoose.Types.Decimal128;
  type: TransactionType;
  date: Date;
  category?: mongoose.Types.ObjectId | string;
  note?: string;
}

export interface EditTransactionInput {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  transactionId: mongoose.Types.ObjectId | string;
  amount?: Decimal | string | mongoose.Types.Decimal128;
  type?: TransactionType;
  date?: Date;
  note?: string;
}

export class TransactionServiceError extends Error {}

export class WalletNotFoundError extends TransactionServiceError {
  constructor(message = 'Wallet not found') {
    super(message);
    this.name = 'WalletNotFoundError';
  }
}

export class TransactionNotFoundError extends TransactionServiceError {
  constructor(message = 'Transaction not found') {
    super(message);
    this.name = 'TransactionNotFoundError';
  }
}

export class InsufficientBalanceError extends TransactionServiceError {
  constructor(message = 'Insufficient wallet balance') {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

export class WalletVersionConflictError extends TransactionServiceError {
  constructor(message = 'Wallet version conflict') {
    super(message);
    this.name = 'WalletVersionConflictError';
  }
}

const MAX_TRANSACTION_RETRIES = 3;

type TransactionMutationType =
  | 'NOTE_ONLY'
  | 'EFFECT_CHANGE'
  | 'ORDERING_CHANGE'
  | 'EFFECT_AND_ORDERING_CHANGE';

type SnapshotCheckpoint = {
  date: Date;
  createdAt: Date;
  id: mongoose.Types.ObjectId;
};

const normalizeCategory = (category?: mongoose.Types.ObjectId | string) => {
  if (category === undefined || category === null) {
    return undefined;
  }

  if (typeof category === 'string') {
    if (!mongoose.isValidObjectId(category)) {
      throw new TransactionServiceError('Invalid category');
    }
    return new mongoose.Types.ObjectId(category);
  }

  return category;
};

const validateTransactionType = (type: TransactionType) => {
  if (type !== TransactionType.INCOME && type !== TransactionType.EXPENSE) {
    throw new TransactionServiceError('Invalid transaction type');
  }
};

const validateDate = (date: Date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TransactionServiceError('Date must be a valid ISO date');
  }
  return new Date(date.toISOString());
};

const hasErrorLabel = (error: unknown, label: string): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as { hasErrorLabel?: (name: string) => boolean };
  return typeof record.hasErrorLabel === 'function' && record.hasErrorLabel(label);
};

const isMongoTransactionsUnavailableError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as {
    code?: number;
    name?: string;
    message?: string;
    errorResponse?: { code?: number; errmsg?: string };
  };

  const message = record.message ?? record.errorResponse?.errmsg ?? '';

  return record.code === 20
    || /replica set|mongos|transactions are not supported/i.test(message)
    || /transaction numbers are only allowed/i.test(message);
};

const isTransientTransactionError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as { code?: number; name?: string; message?: string };

  if (error instanceof WalletVersionConflictError) {
    return true;
  }

  if (hasErrorLabel(error, 'TransientTransactionError') || hasErrorLabel(error, 'UnknownTransactionCommitResult')) {
    return true;
  }

  if ([112, 11602, 11604, 251].includes(record.code ?? -1)) {
    return true;
  }

  return /write conflict|transient|retry|version conflict/i.test(record.message ?? '');
};

const runWithoutTransaction = async <T>(
  operation: (session?: mongoose.ClientSession) => Promise<T>,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTransientTransactionError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new TransactionServiceError('Transaction failed after retries');
};

const withTransactionRetry = async <T>(
  operation: (session?: mongoose.ClientSession) => Promise<T>,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      return await session.withTransaction(async () => operation(session));
    } catch (error) {
      lastError = error;

      if (isMongoTransactionsUnavailableError(error)) {
        return runWithoutTransaction(operation);
      }

      if (!isTransientTransactionError(error)) {
        throw error;
      }
    } finally {
      await session.endSession();
    }
  }

  throw lastError ?? new TransactionServiceError('Transaction failed after retries');
};

const normalizeTransactionId = (transactionId: mongoose.Types.ObjectId | string) => {
  if (transactionId instanceof mongoose.Types.ObjectId) {
    return transactionId;
  }

  if (!mongoose.isValidObjectId(transactionId)) {
    throw new TransactionServiceError('Invalid transactionId');
  }

  return new mongoose.Types.ObjectId(transactionId);
};

const compareSnapshotCheckpoint = (
  left: SnapshotCheckpoint,
  right: SnapshotCheckpoint,
): number => {
  const dateComparison = left.date.getTime() - right.date.getTime();
  if (dateComparison !== 0) {
    return dateComparison;
  }

  const createdAtComparison = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return left.id.toHexString().localeCompare(right.id.toHexString());
};

const getMutationType = ({
  oldAmount,
  newAmount,
  oldType,
  newType,
  oldDate,
  newDate,
  oldNote,
  newNote,
}: {
  oldAmount: Decimal;
  newAmount: Decimal;
  oldType: TransactionType;
  newType: TransactionType;
  oldDate: Date;
  newDate: Date;
  oldNote?: string;
  newNote?: string;
}): TransactionMutationType => {
  const effectChanged = !oldAmount.eq(newAmount) || oldType !== newType;
  const orderingChanged = oldDate.getTime() !== newDate.getTime();
  const noteChanged = (oldNote ?? '') !== (newNote ?? '');

  if (noteChanged && !effectChanged && !orderingChanged) {
    return 'NOTE_ONLY';
  }

  if (effectChanged && !orderingChanged) {
    return 'EFFECT_CHANGE';
  }

  if (!effectChanged && orderingChanged) {
    return 'ORDERING_CHANGE';
  }

  return 'EFFECT_AND_ORDERING_CHANGE';
};

const invalidateAffectedSnapshots = async ({
  tenantId,
  walletId,
  oldDate,
  newDate,
  createdAt,
  transactionId,
  session,
  mutationType,
}: {
  tenantId: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  oldDate: Date;
  newDate: Date;
  createdAt: Date;
  transactionId: mongoose.Types.ObjectId;
  session?: mongoose.ClientSession;
  mutationType: TransactionMutationType;
}) => {
  if (mutationType === 'NOTE_ONLY') {
    return;
  }

  const minOrdering = orderingUtils.isBefore(
    { date: oldDate, createdAt, _id: transactionId },
    { date: newDate, createdAt, _id: transactionId },
  )
    ? { date: oldDate, createdAt, _id: transactionId }
    : { date: newDate, createdAt, _id: transactionId };

  const ord = minOrdering;

  const atOrAfterForSnapshot = {
    $or: [
      { lastTransactionDate: { $gt: new Date(ord.date) } },
      {
        $and: [
          { lastTransactionDate: { $eq: new Date(ord.date) } },
          { lastTransactionCreatedAt: { $gt: new Date(ord.createdAt ?? 0) } },
        ],
      },
      {
        $and: [
          { lastTransactionDate: { $eq: new Date(ord.date) } },
          { lastTransactionCreatedAt: { $eq: new Date(ord.createdAt ?? 0) } },
          { lastTransactionId: { $gte: ord._id } },
        ],
      },
    ],
  };

  await BalanceSnapshot.updateMany(
    {
      tenantId,
      walletId,
      status: BalanceSnapshotStatus.VALID,
      $and: [
        { lastTransactionDate: { $exists: true } },
        { lastTransactionCreatedAt: { $exists: true } },
        { lastTransactionId: { $exists: true } },
      ],
      ...atOrAfterForSnapshot,
    },
    {
      $set: {
        status: BalanceSnapshotStatus.INVALID,
      },
    },
    { session },
  );
};

export async function createTransaction(
  input: CreateTransactionInput,
): Promise<ITransaction> {
  const { tenantId, userId, walletId, amount, type, date, category, note } = input;

  const amountDecimal = toDecimal(amount);
  if (!amountDecimal.isFinite() || amountDecimal.isNaN() || !amountDecimal.isPositive()) {
    throw new TransactionServiceError('Amount must be greater than 0');
  }

  validateTransactionType(type);
  const normalizedDate = validateDate(date);
  const normalizedCategory = normalizeCategory(category);

  return withTransactionRetry(async (session) => {
    const wallet = await Wallet.findOne({
      _id: walletId,
      tenantId,
      userId,
    }).session(session ?? null);

    if (!wallet) {
      throw new WalletNotFoundError();
    }

    const currentBalance = toDecimal(wallet.currentBalance);
    const effect = getTransactionEffect(amountDecimal, type);
    const nextBalance = currentBalance.plus(effect);

    if (nextBalance.isNegative()) {
      throw new InsufficientBalanceError();
    }

    const nextVersion = (wallet.version ?? 0) + 1;
    const updatedWallet = await Wallet.findOneAndUpdate(
      {
        _id: walletId,
        tenantId,
        userId,
        version: wallet.version ?? 0,
      },
      {
        $set: {
          currentBalance: toDecimal128(nextBalance),
          version: nextVersion,
        },
      },
      {
        returnDocument: 'after',
        session,
      },
    );

    if (!updatedWallet) {
      throw new WalletVersionConflictError();
    }

    const [transaction] = await Transaction.create([
      {
        tenantId,
        userId,
        walletId,
        amount: toDecimal128(amountDecimal),
        type,
        category: normalizedCategory,
        date: normalizedDate,
        note: note?.trim() || undefined,
      },
    ], { session });
    return transaction as ITransaction;
  });
}

export async function createTransactionWithInvalidation(
  input: CreateTransactionInput,
): Promise<ITransaction> {
  const tx = await createTransaction(input);

  // Invalidate snapshots at-or-after the new transaction ordering
  await invalidateAffectedSnapshots({
    tenantId: tx.tenantId as mongoose.Types.ObjectId,
    walletId: tx.walletId as mongoose.Types.ObjectId,
    oldDate: tx.date,
    newDate: tx.date,
    createdAt: tx.createdAt,
    transactionId: tx._id,
    session: undefined,
    mutationType: 'EFFECT_CHANGE',
  });

  // best-effort enqueue snapshot check after commit
  enqueueSnapshotJob(tx.walletId as mongoose.Types.ObjectId, tx.tenantId as mongoose.Types.ObjectId).catch(() => {});

  return tx;
}

// Enqueue snapshot job after commit (best-effort, non-blocking)
async function enqueueSnapshotJob(walletId: mongoose.Types.ObjectId, tenantId?: mongoose.Types.ObjectId) {
  try {
    const { createRedisQueueFromEnvironment } = await import('./redisQueue');
    const queue = await createRedisQueueFromEnvironment();
    await queue.enqueue('snapshot-check', { walletId, tenantId });
  } catch (err) {
    console.warn('[transactionService] failed to enqueue snapshot-check job', err);
  }
}

export async function editTransaction(
  input: EditTransactionInput,
): Promise<ITransaction> {
  const {
    tenantId,
    userId,
    walletId,
    transactionId,
    amount,
    type,
    date,
    note,
  } = input;

  if (amount === undefined && type === undefined && date === undefined && note === undefined) {
    throw new TransactionServiceError('At least one field must be provided');
  }

  const transactionObjectId = normalizeTransactionId(transactionId);

  if (amount !== undefined) {
    const amountDecimal = toDecimal(amount);
    if (!amountDecimal.isFinite() || amountDecimal.isNaN() || !amountDecimal.isPositive()) {
      throw new TransactionServiceError('Amount must be greater than 0');
    }
  }

  if (type !== undefined) {
    validateTransactionType(type);
  }

  const normalizedDate = date !== undefined ? validateDate(date) : undefined;

  return withTransactionRetry(async (session) => {
    const existingTransaction = await Transaction.findOne({
      _id: transactionObjectId,
      tenantId,
      userId,
      walletId,
    }).session(session ?? null);

    if (!existingTransaction) {
      throw new TransactionNotFoundError();
    }

    const wallet = await Wallet.findOne({
      _id: walletId,
      tenantId,
      userId,
    }).session(session ?? null);

    if (!wallet) {
      throw new WalletNotFoundError();
    }

    const oldAmount = toDecimal(existingTransaction.amount);
    const oldType = existingTransaction.type;
    const oldDate = existingTransaction.date;
    const oldNote = existingTransaction.note;

    const nextAmount = amount !== undefined ? toDecimal(amount) : oldAmount;
    const nextType = type ?? existingTransaction.type;
    const nextDate = normalizedDate ?? oldDate;
    const nextNote = note !== undefined ? note : oldNote;

    const mutationType = getMutationType({
      oldAmount,
      newAmount: nextAmount,
      oldType,
      newType: nextType,
      oldDate,
      newDate: nextDate,
      oldNote,
      newNote: nextNote,
    });

    const oldEffect = getTransactionEffect(oldAmount, oldType);
    const newEffect = getTransactionEffect(nextAmount, nextType);
    const delta = newEffect.minus(oldEffect);
    const nextBalance = toDecimal(wallet.currentBalance).plus(delta);

    if (mutationType !== 'NOTE_ONLY' && nextBalance.isNegative()) {
      throw new InsufficientBalanceError();
    }

    const update: Partial<ITransaction> = {};

    if (amount !== undefined) {
      update.amount = toDecimal128(nextAmount);
    }
    if (type !== undefined) {
      update.type = nextType;
    }
    if (normalizedDate !== undefined) {
      update.date = nextDate;
    }
    if (note !== undefined) {
      update.note = typeof nextNote === 'string' ? nextNote.trim() || undefined : nextNote;
    }

    const editedTransaction = await Transaction.findOneAndUpdate(
      {
        _id: transactionObjectId,
        tenantId,
        userId,
        walletId,
      },
      { $set: update },
      { returnDocument: 'after', session },
    );

    if (!editedTransaction) {
      throw new TransactionNotFoundError();
    }

    if (!delta.isZero()) {
      const nextVersion = (wallet.version ?? 0) + 1;
      const updatedWallet = await Wallet.findOneAndUpdate(
        {
          _id: walletId,
          tenantId,
          userId,
          version: wallet.version ?? 0,
        },
        {
          $set: {
            currentBalance: toDecimal128(nextBalance),
            version: nextVersion,
          },
        },
        {
          returnDocument: 'after',
          session,
        },
      );

      if (!updatedWallet) {
        throw new WalletVersionConflictError();
      }
    }

    if (mutationType !== 'NOTE_ONLY') {
      await invalidateAffectedSnapshots({
        tenantId,
        walletId,
        oldDate,
        newDate: nextDate,
        createdAt: existingTransaction.createdAt,
        transactionId: transactionObjectId,
        session,
        mutationType,
      });
    }

    // best-effort enqueue snapshot check after commit (non-blocking)
    // do this outside the transaction by not passing session
    enqueueSnapshotJob(wallet._id as mongoose.Types.ObjectId, tenantId as any).catch(() => {});

    return editedTransaction as ITransaction;
  });
}
