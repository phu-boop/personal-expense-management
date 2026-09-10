import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportJob } from '../../../src/models/ExportJob';
import { sumChunkPageCounts } from '../../../src/services/exportProcessorService';

test('export job tracks PDF page totals across chunked exports', () => {
  const pagesPath = ExportJob.schema.path('pages');
  const totalPagesPath = ExportJob.schema.path('totalPages');

  assert.ok(pagesPath, 'pages path should exist on ExportJob schema');
  assert.ok(totalPagesPath, 'totalPages path should exist on ExportJob schema');
  assert.equal(pagesPath.options.default, 0);
  assert.equal(totalPagesPath.options.default, 0);
  assert.equal(sumChunkPageCounts([4, 2, 5]), 11);
  assert.equal(sumChunkPageCounts([0, 3, null, undefined]), 3);
});
