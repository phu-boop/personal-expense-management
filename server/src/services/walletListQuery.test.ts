import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWalletListFilter, normalizeWalletListQuery } from './walletListQuery';

test('normalizeWalletListQuery clamps values and keeps valid defaults', () => {
  assert.deepEqual(normalizeWalletListQuery({ page: '0', limit: '9999', search: '  bank ' }), {
    page: 1,
    limit: 50,
    search: 'bank',
  });
});

test('buildWalletListFilter adds search conditions for wallet name and account number', () => {
  const filter = buildWalletListFilter('tenant_123', 'user_123', 'bank');

  assert.deepEqual(filter, {
    tenantId: 'tenant_123',
    userId: 'user_123',
    $or: [
      { name: { $regex: 'bank', $options: 'i' } },
      { accountNumber: { $regex: 'bank', $options: 'i' } },
    ],
  });
});
