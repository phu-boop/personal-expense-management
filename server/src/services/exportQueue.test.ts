import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExportJobStatus } from '../models/ExportJob';
import { buildPendingExportJobQuery } from './exportQueue';

test('buildPendingExportJobQuery filters only pending export jobs', () => {
  const query = buildPendingExportJobQuery();

  assert.deepEqual(query, {
    status: ExportJobStatus.PENDING,
  });
});
