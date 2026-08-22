import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBenchmarkSummary, runBenchmark } from './exportBenchmark';

test('runBenchmark computes throughput and latency summary for export jobs', async () => {
  const result = await runBenchmark(
    Array.from({ length: 10 }, (_, index) => ({ id: index })),
    {
      concurrency: 3,
      worker: async (item) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (item.id === 7) {
          throw new Error('sample failure');
        }
      },
    },
  );

  assert.equal(result.items.length, 10);
  assert.equal(result.summary.totalItems, 10);
  assert.equal(result.summary.successCount + result.summary.failureCount, 10);
  assert.ok(result.summary.averageMs >= 0);
  assert.ok(result.summary.opsPerSecond > 0);
  assert.ok(formatBenchmarkSummary(result.summary).length > 0);
});
