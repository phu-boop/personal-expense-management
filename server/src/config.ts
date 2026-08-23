/* Centralized server configuration values. Read from environment variables here so
   code across the server can avoid hard-coded strings. */

const LOCAL_MONGO_URI = 'mongodb://127.0.0.1:27017/expense_manager';
const LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';

const mongoUri = process.env.MONGO_URI?.trim();
const redisUrl = process.env.REDIS_URL?.trim();

export const PORT = process.env.PORT ?? '5000';
export const MONGO_URI = mongoUri || LOCAL_MONGO_URI;
export const REDIS_URL = redisUrl || LOCAL_REDIS_URL;
export const JWT_SECRET = process.env.JWT_SECRET?.trim() ?? '';
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173';

export const EXPORT_DIR = process.env.EXPORT_DIR ?? 'exports';

export default {
  PORT,
  MONGO_URI,
  REDIS_URL,
  JWT_SECRET,
  GOOGLE_CLIENT_ID,
  CORS_ORIGIN,
  EXPORT_DIR,
};
