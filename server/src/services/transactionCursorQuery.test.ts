import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTransactionCursorFilter, buildTransactionListFilter, encodeCursor, normalizeTransactionCursorQuery, parseCursorToken } from './transactionCursorQuery';

const VALID_OBJECT_ID = '111111111111111111111111';

test('normalizeTransactionCursorQuery uses safe defaults', () => {
  assert.deepEqual(normalizeTransactionCursorQuery({ limit: '9999', before: '2026-08-12T00:00:00.000Z_' + VALID_OBJECT_ID }), {
    limit: 100,
    before: '2026-08-12T00:00:00.000Z_' + VALID_OBJECT_ID,
  });
});

test('parseCursorToken extracts date and id', () => {
  assert.deepEqual(parseCursorToken('2026-08-12T00:00:00.000Z_' + VALID_OBJECT_ID), {
    date: new Date('2026-08-12T00:00:00.000Z'),
    id: VALID_OBJECT_ID,
  });
});

test('buildTransactionListFilter adds supported filters', () => {
  const filter = buildTransactionListFilter('tenant_123', 'user_123', {
    walletId: VALID_OBJECT_ID,
    type: 'EXPENSE',
    category: 'Food',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    amountMin: 1000,
    amountMax: 5000,
  });

  assert.equal(filter.tenantId, 'tenant_123');
  assert.equal(filter.userId, 'user_123');
  assert.equal(String(filter.walletId), VALID_OBJECT_ID);
  assert.equal(filter.type, 'EXPENSE');
  assert.equal(filter.category, 'Food');
  assert.equal((filter.date as any).$gte.toISOString(), new Date('2026-08-01').toISOString());
  assert.equal((filter.amount as any).$gte, 1000);
  assert.equal((filter.amount as any).$lte, 5000);
});

test('buildTransactionCursorFilter applies cursor logic', () => {
  const filter = buildTransactionCursorFilter({ tenantId: 'tenant_123', userId: 'user_123' }, '2026-08-12T00:00:00.000Z_' + VALID_OBJECT_ID);

  assert.equal((filter as any).tenantId, 'tenant_123');
  assert.equal((filter as any).userId, 'user_123');
  assert.ok((filter as any).$or);
});

test('encodeCursor returns stable token', () => {
  assert.equal(encodeCursor({ date: '2026-08-12T00:00:00.000Z', _id: VALID_OBJECT_ID }), '2026-08-12T00:00:00.000Z_' + VALID_OBJECT_ID);
});
