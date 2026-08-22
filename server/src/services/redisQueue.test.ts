import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDeadLetterQueueKey, buildQueueKey, createRedisQueueClient, normalizeQueuePayload } from './redisQueue';

test('buildQueueKey creates a namespaced redis key', () => {
  assert.equal(buildQueueKey('export-jobs'), 'expense_manager:export-jobs');
});

test('buildDeadLetterQueueKey creates a separated replay queue for failed jobs', () => {
  assert.equal(buildDeadLetterQueueKey('export-jobs'), 'expense_manager:export-jobs:dead-letter');
});

test('normalizeQueuePayload keeps plain values and serializes job ids', () => {
  const payload = normalizeQueuePayload({ jobId: 'job_123', retries: 0 });

  assert.equal(payload.jobId, 'job_123');
  assert.equal(payload.retries, 0);
});

test('createRedisQueueClient enqueues and dequeues jobs in FIFO order', async () => {
  const queue = createRedisQueueClient();

  await queue.enqueue('export-jobs', { jobId: 'job_1', retries: 0 });
  await queue.enqueue('export-jobs', { jobId: 'job_2', retries: 1 });

  assert.equal(await queue.length('export-jobs'), 2);
  assert.deepEqual(await queue.dequeue('export-jobs'), { jobId: 'job_1', retries: 0 });
  assert.equal(await queue.length('export-jobs'), 1);

  const pending = await queue.peek('export-jobs');
  assert.deepEqual(pending[0], { jobId: 'job_2', retries: 1 });
});

test('createRedisQueueClient supports a custom client implementation', async () => {
  const memory: Record<string, string[]> = {
    'expense_manager:export-jobs': [],
  };

  const client = {
    lpush: async (key: string, value: string) => {
      memory[key] = [value, ...(memory[key] ?? [])];
      return memory[key].length;
    },
    rpop: async (key: string) => {
      const values = memory[key] ?? [];
      const value = values.pop() ?? null;
      memory[key] = values;
      return value;
    },
    llen: async (key: string) => (memory[key] ?? []).length,
    lrange: async (key: string, start: number, end: number) => {
      const values = memory[key] ?? [];
      const sliced = values.slice(start, end === -1 ? undefined : end + 1);
      return sliced;
    },
  };

  const queue = createRedisQueueClient(client);
  await queue.enqueue('export-jobs', { jobId: 'job_abc', retries: 2 });

  assert.equal(await queue.length('export-jobs'), 1);
  assert.deepEqual(await queue.dequeue('export-jobs'), { jobId: 'job_abc', retries: 2 });
});

test('createRedisQueueClient can push jobs into the dead-letter queue', async () => {
  const queue = createRedisQueueClient();

  await queue.enqueueDeadLetter('export-jobs', { jobId: 'job_dlq', retries: 3 });

  assert.equal(await queue.length('export-jobs:dead-letter'), 1);
  assert.deepEqual(await queue.dequeue('export-jobs:dead-letter'), { jobId: 'job_dlq', retries: 3, deadLetter: true });
});
