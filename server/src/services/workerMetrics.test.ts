import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkerMetrics } from './workerMetrics';

test('createWorkerMetrics tracks processed, failed, retry and dead-letter counts', () => {
  const metrics = createWorkerMetrics();

  metrics.recordJobQueued();
  metrics.recordJobProcessed(48);
  metrics.recordJobFailed();
  metrics.recordRetry();
  metrics.recordDeadLetter();

  const snapshot = metrics.snapshot();

  assert.equal(snapshot.queued, 1);
  assert.equal(snapshot.processed, 1);
  assert.equal(snapshot.failed, 1);
  assert.equal(snapshot.retries, 1);
  assert.equal(snapshot.deadLetters, 1);
  assert.equal(snapshot.totalProcessingMs, 48);
});
