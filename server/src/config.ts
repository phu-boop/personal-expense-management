/* Centralized server configuration values. Read from environment variables here so
   code across the server can avoid hard-coded strings. */

export const PORT = process.env.PORT ?? '5000';
export const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/expense_manager';
export const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
export const JWT_SECRET = process.env.JWT_SECRET ?? '';
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '';

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
