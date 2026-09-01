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

  return { enqueue, dequeue, length, peek, enqueueDeadLetter };
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
    lLen: async (key: string) => redisClient.lLen(key),
    lRange: async (key: string, start: number, end: number) => redisClient.lRange(key, start, end),
  });
}

export async function createRedisQueueFromExistingClient(client: any) {
  return createRedisQueueClient({
    lPush: async (key: string, value: string) => client.lPush(key, value),
    rPop: async (key: string) => client.rPop(key),
    lLen: async (key: string) => client.lLen(key),
    lRange: async (key: string, start: number, end: number) => client.lRange(key, start, end),
  });
}
