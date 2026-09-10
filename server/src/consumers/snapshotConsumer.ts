import process from 'process';
import mongoose from 'mongoose';
import config from '../config';
import { createRedisQueueFromEnvironment } from '../services/redisQueue';
import { createSnapshotIfNeeded } from '../workers/snapshotWorker';

const QUEUE_NAME = 'snapshot-check';
const MAX_RETRIES = config.SNAPSHOT_MAX_RETRIES;

const isTransientError = (err: any) => {
  if (!err) return false;
  const msg = String(err.message ?? err);
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|transient|timeout|write conflict|TransientTransactionError/i.test(msg);
};

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function recoverStaleJobs(queue: any) {
  try {
    await queue.requeueStale(QUEUE_NAME, config.SNAPSHOT_STALE_JOB_MS);
  } catch (err) {
    console.warn('[SnapshotConsumer] stale recovery failed', err);
  }
}

async function runConsumer() {
  console.log('[SnapshotConsumer] starting');
  // ensure MongoDB connection so Mongoose queries won't buffer
  try {
    await mongoose.connect(config.MONGO_URI);
    console.log('[SnapshotConsumer] connected to MongoDB');
  } catch (err) {
    console.error('[SnapshotConsumer] failed to connect to MongoDB', err);
    throw err;
  }

  const queue = await createRedisQueueFromEnvironment();
  let running = true;

  process.on('SIGINT', () => { console.log('[SnapshotConsumer] SIGINT'); running = false; });
  process.on('SIGTERM', () => { console.log('[SnapshotConsumer] SIGTERM'); running = false; });

  await recoverStaleJobs(queue);
  const requeueInterval = setInterval(() => {
    recoverStaleJobs(queue).catch((e: any) => console.error('[SnapshotConsumer] requeueStale error', e));
  }, config.SNAPSHOT_REQUEUE_INTERVAL_MS);

  while (running) {
    try {
      // recover jobs that were left in processing by a previous crash or timeout
      await recoverStaleJobs(queue);

      // claim a job atomically (move to processing list) so crashes won't lose it
      const claimed = await queue.claim(QUEUE_NAME);
      if (!claimed) {
        await sleep(config.SNAPSHOT_CLAIM_POLL_MS);
        continue;
      }

      const { parsed: job, raw } = claimed as { parsed: any; raw: string };

      console.log('[SnapshotConsumer] claimed job', { walletId: job.walletId, tenantId: job.tenantId, retries: job.retries });

      if (!job || !job.walletId) {
        console.warn('[SnapshotConsumer] invalid job, sending to dead-letter', job);
        await queue.enqueueDeadLetter(QUEUE_NAME, { ...job, failedAt: new Date().toISOString(), error: 'invalid payload' });
        await queue.ack(QUEUE_NAME, raw);
        continue;
      }

      try {
        await createSnapshotIfNeeded(job.walletId, { tenantId: job.tenantId });
        console.log('[SnapshotConsumer] snapshot check completed', { walletId: job.walletId });
        await queue.ack(QUEUE_NAME, raw);
      } catch (err: any) {
        console.error('[SnapshotConsumer] processing error', err?.message ?? err);
        const retries = typeof job.retries === 'number' ? job.retries + 1 : 1;
        if (!isTransientError(err) || retries > MAX_RETRIES) {
          console.warn('[SnapshotConsumer] sending to dead-letter', { walletId: job.walletId, tenantId: job.tenantId, retries, error: String(err?.message ?? err) });
          await queue.enqueueDeadLetter(QUEUE_NAME, { ...job, retries, failedAt: new Date().toISOString(), error: String(err?.message ?? err) });
          await queue.ack(QUEUE_NAME, raw);
        } else {
          const backoffMs = config.SNAPSHOT_RETRY_BASE_MS * Math.pow(2, retries - 1);
          console.log(`[SnapshotConsumer] transient error, retry=${retries}, backoff=${backoffMs}ms`);
          await sleep(backoffMs);
          await queue.enqueue(QUEUE_NAME, { ...job, retries });
          await queue.ack(QUEUE_NAME, raw);
        }
      }
    } catch (err) {
      console.error('[SnapshotConsumer] fatal loop error', err);
      await sleep(config.SNAPSHOT_FATAL_RETRY_MS);
    }
  }

  clearInterval(requeueInterval);
  try {
    await mongoose.disconnect();
    console.log('[SnapshotConsumer] disconnected MongoDB');
  } catch (e) {
    console.warn('[SnapshotConsumer] error disconnecting MongoDB', e);
  }
  console.log('[SnapshotConsumer] shutting down');
  process.exit(0);
}

if (require.main === module) {
  runConsumer().catch((err) => { console.error('[SnapshotConsumer] run failed', err); process.exit(1); });
}

export default runConsumer;
