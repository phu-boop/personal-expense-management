import mongoose from 'mongoose';

export type WalletListQueryInput = {
  page?: string | number;
  limit?: string | number;
  search?: string;
};

export type WalletListQuery = {
  page: number;
  limit: number;
  search: string;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export function normalizeWalletListQuery(input: WalletListQueryInput = {}): WalletListQuery {
  const page = Number(input.page ?? 1);
  const limit = Number(input.limit ?? DEFAULT_PAGE_SIZE);
  const search = String(input.search ?? '').trim();

  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
    search,
  };
}

export function buildWalletListFilter(
  tenantId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId,
  search?: string,
) {
  const filter: Record<string, unknown> = { tenantId, userId };
  const normalizedSearch = search?.trim();

  if (normalizedSearch) {
    filter.$or = [
      { name: { $regex: normalizedSearch, $options: 'i' } },
      { accountNumber: { $regex: normalizedSearch, $options: 'i' } },
    ];
  }

  return filter;
}
