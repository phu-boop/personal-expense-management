import mongoose from 'mongoose';

export type TransactionCursorQueryInput = {
  before?: string;
  limit?: string | number;
  page?: string | number;
  walletId?: string;
  type?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  amountMin?: string | number;
  amountMax?: string | number;
};

export type TransactionCursorQuery = {
  limit: number;
  before?: string;
};

const DEFAULT_CURSOR_LIMIT = 50;
const MAX_CURSOR_LIMIT = 100;

export function normalizeTransactionCursorQuery(input: TransactionCursorQueryInput = {}): TransactionCursorQuery {
  const rawLimit = Number(input.limit ?? DEFAULT_CURSOR_LIMIT);

  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_CURSOR_LIMIT) : DEFAULT_CURSOR_LIMIT,
    before: typeof input.before === 'string' ? input.before.trim() : undefined,
  };
}

export function parseCursorToken(before?: string): { date: Date; id: string } | undefined {
  if (!before || typeof before !== 'string') {
    return undefined;
  }

  const separatorIndex = before.lastIndexOf('_');
  if (separatorIndex <= 0 || separatorIndex === before.length - 1) {
    return undefined;
  }

  const datePart = before.slice(0, separatorIndex);
  const idPart = before.slice(separatorIndex + 1);
  const parsedDate = new Date(datePart);

  if (Number.isNaN(parsedDate.getTime()) || !idPart) {
    return undefined;
  }

  return { date: parsedDate, id: idPart };
}

export function buildTransactionListFilter(
  tenantId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId,
  input: TransactionCursorQueryInput = {},
) {
  const filter: Record<string, unknown> = { tenantId, userId };

  if (input.walletId && mongoose.isValidObjectId(input.walletId)) {
    filter.walletId = new mongoose.Types.ObjectId(String(input.walletId));
  }

  if (input.type) {
    filter.type = input.type;
  }

  if (input.category) {
    filter.category = input.category;
  }

  if (input.startDate || input.endDate) {
    filter.date = {} as Record<string, Date>;

    if (input.startDate) {
      (filter.date as Record<string, Date>).$gte = new Date(String(input.startDate));
    }

    if (input.endDate) {
      (filter.date as Record<string, Date>).$lte = new Date(String(input.endDate));
    }
  }

  if (input.amountMin !== undefined || input.amountMax !== undefined) {
    filter.amount = {} as Record<string, number>;

    if (input.amountMin !== undefined) {
      (filter.amount as Record<string, number>).$gte = Number(input.amountMin);
    }

    if (input.amountMax !== undefined) {
      (filter.amount as Record<string, number>).$lte = Number(input.amountMax);
    }
  }

  return filter;
}

export function buildTransactionCursorFilter(baseFilter: Record<string, unknown>, before?: string) {
  const cursor = parseCursorToken(before);
  if (!cursor || !mongoose.isValidObjectId(cursor.id)) {
    return baseFilter;
  }

  const nextFilter: Record<string, unknown> = {
    ...baseFilter,
    $or: [
      { date: { $lt: cursor.date } },
      { date: cursor.date, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
    ],
  };

  return nextFilter;
}

export function encodeCursor(transaction: { date: Date | string; _id: string | mongoose.Types.ObjectId }) {
  return `${new Date(transaction.date).toISOString()}_${String(transaction._id)}`;
}
