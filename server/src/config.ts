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
export const CORS_ORIGIN = process.env.CORS_ORIGIN;

export const EXPORT_DIR = process.env.EXPORT_DIR ?? 'exports';

export const EXPORT_PDF_MAX_ROWS_PER_CHUNK = Number(process.env.EXPORT_PDF_MAX_ROWS_PER_CHUNK ?? 2500);
export const EXPORT_XLSX_PROGRESS_CHECKPOINTS = (process.env.EXPORT_XLSX_PROGRESS_CHECKPOINTS ?? '10000,100000,200000,500000,1000000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

export const SNAPSHOT_DEFAULT_INTERVAL = Number(process.env.SNAPSHOT_DEFAULT_INTERVAL ?? 20000);
export const SNAPSHOT_STALE_JOB_MS = Number(process.env.SNAPSHOT_STALE_JOB_MS ?? 10_000);
export const SNAPSHOT_REQUEUE_INTERVAL_MS = Number(process.env.SNAPSHOT_REQUEUE_INTERVAL_MS ?? 30_000);
export const SNAPSHOT_CLAIM_POLL_MS = Number(process.env.SNAPSHOT_CLAIM_POLL_MS ?? 500);
export const SNAPSHOT_FATAL_RETRY_MS = Number(process.env.SNAPSHOT_FATAL_RETRY_MS ?? 2_000);
export const SNAPSHOT_MAX_RETRIES = Number(process.env.SNAPSHOT_MAX_RETRIES ?? 5);
export const SNAPSHOT_RETRY_BASE_MS = Number(process.env.SNAPSHOT_RETRY_BASE_MS ?? 1000);

export const EXPORT_JOB_POLL_MS = Number(process.env.EXPORT_JOB_POLL_MS ?? 1000);
export const EXPORT_JOB_IDLE_POLL_MS = Number(process.env.EXPORT_JOB_IDLE_POLL_MS ?? 2000);
export const EXPORT_JOB_MAX_RETRIES = Number(process.env.EXPORT_JOB_MAX_RETRIES ?? 3);

export const shouldStartExportWorker = () => {
  const workerMode = process.env.WORKER_MODE?.trim().toLowerCase();
  const explicitToggle = process.env.ENABLE_EXPORT_WORKER?.trim().toLowerCase();

  if (explicitToggle === 'true' || explicitToggle === '1') {
    return true;
  }

  if (explicitToggle === 'false' || explicitToggle === '0') {
    return false;
  }

  if (workerMode === 'api') {
    return false;
  }

  if (workerMode === 'worker') {
    return true;
  }

  return Boolean(process.env.RENDER) || process.env.NODE_ENV === 'production';
};

export default {
  PORT,
  MONGO_URI,
  REDIS_URL,
  JWT_SECRET,
  GOOGLE_CLIENT_ID,
  CORS_ORIGIN,
  EXPORT_DIR,
  EXPORT_PDF_MAX_ROWS_PER_CHUNK,
  EXPORT_XLSX_PROGRESS_CHECKPOINTS,
  SNAPSHOT_DEFAULT_INTERVAL,
  SNAPSHOT_STALE_JOB_MS,
  SNAPSHOT_REQUEUE_INTERVAL_MS,
  SNAPSHOT_CLAIM_POLL_MS,
  SNAPSHOT_FATAL_RETRY_MS,
  SNAPSHOT_MAX_RETRIES,
  SNAPSHOT_RETRY_BASE_MS,
  EXPORT_JOB_POLL_MS,
  EXPORT_JOB_IDLE_POLL_MS,
  EXPORT_JOB_MAX_RETRIES,
  shouldStartExportWorker,
};
