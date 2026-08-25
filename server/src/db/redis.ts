import { createClient } from 'redis';

let redisClient: ReturnType<typeof createClient> | null = null;

export const connectRedis = async () => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  redisClient = createClient({ url: redisUrl });
  redisClient.on('error', (error) => {
    console.error('Redis Client Error:', error);
  });

  await redisClient.connect();
  console.log('Redis connected successfully');
  return redisClient;
};

export const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis client is not connected');
  }
  return redisClient;
};

export const cacheSet = async (key: string, value: string, ttlSeconds = 300) => {
  const client = getRedisClient();
  await client.set(key, value, { EX: ttlSeconds });
};

export const cacheGet = async (key: string) => {
  const client = getRedisClient();
  return client.get(key);
};
