import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExportJobStatus, buildExportTransactionFilter, createExportJob } from './exportJobService';

const VALID_OBJECT_ID = '111111111111111111111111';

test('createExportJob creates a pending job tied to the user and requested format', () => {
  const job = createExportJob('tenant_123', 'user_123', {
    walletId: VALID_OBJECT_ID,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    format: 'xlsx',
  });

  assert.equal(job.tenantId, 'tenant_123');
  assert.equal(job.userId, 'user_123');
  assert.equal(job.format, 'xlsx');
  assert.equal(job.status, ExportJobStatus.PENDING);
  assert.ok(job.expiresAt instanceof Date);
});

test('buildExportTransactionFilter applies wallet and date constraints', () => {
  const filter = buildExportTransactionFilter('tenant_123', 'user_123', {
    walletId: VALID_OBJECT_ID,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
  });

  assert.equal(filter.tenantId, 'tenant_123');
  assert.equal(filter.userId, 'user_123');
  assert.equal(String(filter.walletId), VALID_OBJECT_ID);
  assert.ok((filter.date as any).$gte);
  assert.ok((filter.date as any).$lte);
});
