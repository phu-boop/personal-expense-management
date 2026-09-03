import { createClient } from 'redis';
import config from '../config';

export function buildQueueKey(name: string) {
  return `expense_manager:${name}`;
}

export function buildDeadLetterQueueKey(name: string) {
  return `${buildQueueKey(name)}:dead-letter`;
}

export function normalizeQueuePayload(payload: any) {
  return {
    ...payload,
    retries: typeof payload.retries === 'number' ? payload.retries : 0,
    enqueuedAt: payload?.enqueuedAt ?? new Date().toISOString(),
  };
}

function getQueueMethod(client: any, names: string[]) {
  if (!client) return undefined;
  for (const name of names) {
    const method = client[name];
    if (typeof method === 'function') return method;
  }
  return undefined;
}

export function createRedisQueueClient(client: any) {
  const fallbackQueue = new Map<string, string[]>();
  const readQueue = (key: string) => {
    const queue = fallbackQueue.get(key) ?? [];
    fallbackQueue.set(key, queue);
    return queue;
  };

  const enqueue = async (queueName: string, payload: any) => {
    const queueKey = buildQueueKey(queueName);
    const normalizedPayload = normalizeQueuePayload(payload);
    const serialized = JSON.stringify(normalizedPayload);
    const lPush = getQueueMethod(client, ['lPush', 'lpush']);
    if (typeof lPush === 'function') {
      await lPush(queueKey, serialized);
      return normalizedPayload;
    }
    const queue = readQueue(queueKey);
    queue.push(serialized);
    return normalizedPayload;
  };

  const buildProcessingKey = (queueName: string) => `${buildQueueKey(queueName)}:processing`;

  const claim = async (queueName: string) => {
    const queueKey = buildQueueKey(queueName);
    const processingKey = buildProcessingKey(queueName);
    const rPopLPush = getQueueMethod(client, ['rPopLPush', 'rpoplpush', 'brPopLPush', 'brpoplpush']);
    if (typeof rPopLPush === 'function') {
      const value = await rPopLPush(queueKey, processingKey);
      if (!value) return null;
      try { return { parsed: JSON.parse(value), raw: value }; } catch { return null; }
    }
    // fallback to in-memory: move from main queue to processing queue
    const main = readQueue(queueKey);
    const processing = readQueue(processingKey);
    const value = main.shift();
    if (!value) return null;
    processing.push(value);
    try { return { parsed: JSON.parse(value), raw: value }; } catch { return null; }
  };

  const ack = async (queueName: string, rawPayload: string) => {
    const processingKey = buildProcessingKey(queueName);
    const lRem = getQueueMethod(client, ['lRem', 'lrem']);
    if (typeof lRem === 'function') {
      // remove a single occurrence
      await lRem(processingKey, 1, rawPayload);
      return true;
    }
    const processing = readQueue(processingKey);
    const idx = processing.indexOf(rawPayload);
    if (idx >= 0) processing.splice(idx, 1);
    return true;
  };

  const requeueStale = async (queueName: string, olderThanMs = 60_000) => {
    const processingKey = buildProcessingKey(queueName);
    const lRange = getQueueMethod(client, ['lRange', 'lrange']);
    const lPush = getQueueMethod(client, ['lPush', 'lpush']);
    const lRem = getQueueMethod(client, ['lRem', 'lrem']);
    const now = Date.now();
    if (typeof lRange === 'function' && typeof lPush === 'function' && typeof lRem === 'function') {
      const values = await lRange(processingKey, 0, -1);
      for (const v of values) {
        try {
          const p = JSON.parse(v);
          const enqueued = Date.parse(p.enqueuedAt ?? 0);
          if (Number.isNaN(enqueued) || now - enqueued > olderThanMs) {
            // move back to main queue
            await lPush(buildQueueKey(queueName), v);
            await lRem(processingKey, 1, v);
          }
        } catch {
          // ignore malformed
        }
      }
      return;
    }
    // fallback: in-memory move based on parsed enqueuedAt
    const processing = readQueue(processingKey);
    const main = readQueue(buildQueueKey(queueName));
    for (let i = processing.length - 1; i >= 0; i -= 1) {
      const v = processing[i];
      try {
        const p = JSON.parse(v);
        const enqueued = Date.parse(p.enqueuedAt ?? 0);
        if (Number.isNaN(enqueued) || now - enqueued > olderThanMs) {
          processing.splice(i, 1);
          main.push(v);
        }
      } catch {
        // ignore
      }
    }
  };

  const enqueueDeadLetter = async (queueName: string, payload: any) => {
    const deadLetterKey = buildDeadLetterQueueKey(queueName);
    return enqueue(deadLetterKey.replace('expense_manager:', ''), { ...payload, deadLetter: true });
  };

  const dequeue = async (queueName: string) => {
    const queueKey = buildQueueKey(queueName);
    const rPop = getQueueMethod(client, ['rPop', 'rpop']);
    if (typeof rPop === 'function') {
      const value = await rPop(queueKey);
      if (!value) return null;
      try { return JSON.parse(value); } catch { return null; }
    }
    const queue = readQueue(queueKey);
    const value = queue.shift();
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
  };

  const length = async (queueName: string) => {
    const queueKey = buildQueueKey(queueName);
    const lLen = getQueueMethod(client, ['lLen', 'llen']);
    if (typeof lLen === 'function') return Number(await lLen(queueKey));
    return readQueue(queueKey).length;
  };

  const peek = async (queueName: string, start = 0, end = -1) => {
    const queueKey = buildQueueKey(queueName);
    const lRange = getQueueMethod(client, ['lRange', 'lrange']);
    if (typeof lRange === 'function') {
      const values = await lRange(queueKey, start, end);
      return values.map((v: string) => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
    }
    return readQueue(queueKey).slice(start, end === -1 ? undefined : end + 1).map((v) => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
  };

  return { enqueue, dequeue, claim, ack, requeueStale, length, peek, enqueueDeadLetter };
}

export async function createRedisQueueFromEnvironment(redisUrl = config.REDIS_URL) {
  const redisClient = createClient({ url: redisUrl });
  redisClient.on('error', (error) => {
    console.error('Redis queue error:', error);
  });
  await redisClient.connect();
  return createRedisQueueClient({
    lPush: async (key: string, value: string) => redisClient.lPush(key, value),
    rPop: async (key: string) => redisClient.rPop(key),
    // support atomic claim via RPOPLPUSH if available
    rPopLPush: async (source: string, dest: string) => (redisClient as any).rPopLPush ? (redisClient as any).rPopLPush(source, dest) : null,
    lRem: async (key: string, count: number, value: string) => (redisClient as any).lRem ? (redisClient as any).lRem(key, count, value) : null,
    lLen: async (key: string) => redisClient.lLen(key),
    lRange: async (key: string, start: number, end: number) => redisClient.lRange(key, start, end),
  });
}

export async function createRedisQueueFromExistingClient(client: any) {
  return createRedisQueueClient({
    lPush: async (key: string, value: string) => client.lPush(key, value),
    rPop: async (key: string) => client.rPop(key),
    rPopLPush: async (source: string, dest: string) => client.rPopLPush ? client.rPopLPush(source, dest) : null,
    lRem: async (key: string, count: number, value: string) => client.lRem ? client.lRem(key, count, value) : null,
    lLen: async (key: string) => client.lLen(key),
    lRange: async (key: string, start: number, end: number) => client.lRange(key, start, end),
  });
}
