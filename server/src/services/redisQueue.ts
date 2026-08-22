import { createClient, type RedisClientType } from 'redis';

export type RedisQueuePayload = {
  jobId: string;
  retries?: number;
  [key: string]: unknown;
};

export type RedisLikeQueueClient = {
  lPush?: (key: string, value: string) => Promise<number> | number;
  rPop?: (key: string) => Promise<string | null> | string | null;
  lLen?: (key: string) => Promise<number> | number;
  lRange?: (key: string, start: number, end: number) => Promise<string[]> | string[];
  lpush?: (key: string, value: string) => Promise<number> | number;
  rpop?: (key: string) => Promise<string | null> | string | null;
  llen?: (key: string) => Promise<number> | number;
  lrange?: (key: string, start: number, end: number) => Promise<string[]> | string[];
};

export function buildQueueKey(name: string) {
  return `expense_manager:${name}`;
}

export function buildDeadLetterQueueKey(name: string) {
  return `${buildQueueKey(name)}:dead-letter`;
}

export function normalizeQueuePayload<T extends RedisQueuePayload>(payload: T): T {
  return {
    ...payload,
    retries: typeof payload.retries === 'number' ? payload.retries : 0,
  };
}

function getQueueMethod<T>(client: RedisLikeQueueClient | undefined, names: (keyof RedisLikeQueueClient)[]) {
  if (!client) {
    return undefined;
  }

  for (const name of names) {
    const method = client[name];
    if (typeof method === 'function') {
      return method as T;
    }
  }

  return undefined;
}

export function createRedisQueueClient(client?: RedisLikeQueueClient) {
  const fallbackQueue = new Map<string, string[]>();

  const readQueue = (key: string) => {
    const queue = fallbackQueue.get(key) ?? [];
    fallbackQueue.set(key, queue);
    return queue;
  };

  const enqueue = async (queueName: string, payload: RedisQueuePayload) => {
    const queueKey = buildQueueKey(queueName);
    const normalizedPayload = normalizeQueuePayload(payload);
    const serialized = JSON.stringify(normalizedPayload);
    const lPush = getQueueMethod<(key: string, value: string) => Promise<number> | number>(client, ['lPush', 'lpush']);

    if (typeof lPush === 'function') {
      await lPush(queueKey, serialized);
      return normalizedPayload;
    }

    const queue = readQueue(queueKey);
    queue.push(serialized);
    return normalizedPayload;
  };

  const enqueueDeadLetter = async (queueName: string, payload: RedisQueuePayload) => {
    const deadLetterKey = buildDeadLetterQueueKey(queueName);
    return enqueue(deadLetterKey.replace('expense_manager:', ''), { ...payload, deadLetter: true });
  };

  const dequeue = async (queueName: string): Promise<RedisQueuePayload | null> => {
    const queueKey = buildQueueKey(queueName);
    const rPop = getQueueMethod<(key: string) => Promise<string | null> | string | null>(client, ['rPop', 'rpop']);

    if (typeof rPop === 'function') {
      const value = await rPop(queueKey);
      if (!value) {
        return null;
      }

      try {
        return JSON.parse(value) as RedisQueuePayload;
      } catch {
        return null;
      }
    }

    const queue = readQueue(queueKey);
    const value = queue.shift();
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as RedisQueuePayload;
    } catch {
      return null;
    }
  };

  const length = async (queueName: string) => {
    const queueKey = buildQueueKey(queueName);
    const lLen = getQueueMethod<(key: string) => Promise<number> | number>(client, ['lLen', 'llen']);

    if (typeof lLen === 'function') {
      return Number(await lLen(queueKey));
    }

    return readQueue(queueKey).length;
  };

  const peek = async (queueName: string, start = 0, end = -1) => {
    const queueKey = buildQueueKey(queueName);
    const lRange = getQueueMethod<(key: string, start: number, end: number) => Promise<string[]> | string[]>(client, ['lRange', 'lrange']);

    if (typeof lRange === 'function') {
      const values = await lRange(queueKey, start, end);
      return values.map((value) => {
        try {
          return JSON.parse(value) as RedisQueuePayload;
        } catch {
          return null;
        }
      }).filter((value): value is RedisQueuePayload => value !== null);
    }

    return readQueue(queueKey).slice(start, end === -1 ? undefined : end + 1).map((value) => {
      try {
        return JSON.parse(value) as RedisQueuePayload;
      } catch {
        return null;
      }
    }).filter((value): value is RedisQueuePayload => value !== null);
  };

  return { enqueue, dequeue, length, peek, enqueueDeadLetter };
}

export async function createRedisQueueFromEnvironment(redisUrl = process.env.REDIS_URL || 'redis://localhost:6379') {
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

export async function createRedisQueueFromExistingClient(client: RedisClientType) {
  return createRedisQueueClient({
    lPush: async (key: string, value: string) => client.lPush(key, value),
    rPop: async (key: string) => client.rPop(key),
    lLen: async (key: string) => client.lLen(key),
    lRange: async (key: string, start: number, end: number) => client.lRange(key, start, end),
  });
}
