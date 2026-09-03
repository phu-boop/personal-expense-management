import mongoose from 'mongoose';
import ExportJob, { ExportJobStatus } from './models/ExportJob';
import Transaction, { TransactionType } from './models/Transaction';
import Wallet from './models/Wallet';
import exportProcessorService from './services/exportProcessorService';
import LocalFilesystemStorage from './services/storage/LocalFilesystemStorage';
import { createRedisQueueFromEnvironment } from './services/redisQueue';
import { createWorkerMetrics } from './services/workerMetrics';
import fs from 'node:fs/promises';
import path from 'node:path';

import config from './config';
const EXPORT_DIR = path.resolve(process.cwd(), config.EXPORT_DIR);
const MAX_RETRIES = 3;
const workerMetrics = createWorkerMetrics();

const ensureExportDirectory = async () => {
  await fs.mkdir(EXPORT_DIR, { recursive: true, mode: 0o777 });
  await fs.chmod(EXPORT_DIR, 0o777);
};

const buildExportFilePath = (jobId: string, format: 'xlsx' | 'pdf') => path.join(EXPORT_DIR, `${jobId}.${format}`);

const processExportJob = async (jobId: string, queue: Awaited<ReturnType<typeof createRedisQueueFromEnvironment>>) => {
  const mongoJob = await ExportJob.findById(jobId);
  if (!mongoJob) {
    console.warn('[worker] job not found, skipping', { jobId });
    return true;
  }

  if (mongoJob.status === ExportJobStatus.EXPIRED) {
    console.warn('[worker] job expired, skipping', { jobId, status: mongoJob.status });
    return true;
  }

  mongoJob.status = ExportJobStatus.IN_PROGRESS;
  await mongoJob.save();
  console.log('[worker] processing export job', { jobId, format: mongoJob.format, tenantId: String(mongoJob.tenantId), userId: String(mongoJob.userId) });

  const startedAt = Date.now();

  try {
    await exportProcessorService({ jobId: mongoJob._id, storage: new LocalFilesystemStorage() });
    console.log('[worker] export job completed', { jobId });
    workerMetrics.recordJobProcessed(Date.now() - startedAt);
    return true;
  } catch (error) {
    const err = error instanceof Error ? error.message : 'Unknown export error';
    const retryCount = Number(mongoJob.error?.match(/Retry\s+(\d+)\//)?.[1] ?? 0);
    const nextRetry = retryCount + 1;

    if (nextRetry <= MAX_RETRIES) {
      console.warn('[worker] export job retrying', { jobId, nextRetry, maxRetries: MAX_RETRIES, error: err });
      workerMetrics.recordRetry();
      mongoJob.status = ExportJobStatus.PENDING;
      mongoJob.error = `Retry ${nextRetry}/${MAX_RETRIES}: ${err}`;
      await mongoJob.save();
      return false;
    }

    console.error('[worker] export job failed permanently', { jobId, error: err });
    workerMetrics.recordDeadLetter();
    await queue.enqueueDeadLetter('export-jobs', {
      jobId: String(mongoJob._id),
      retries: nextRetry,
      error: err,
      tenantId: String(mongoJob.tenantId),
      userId: String(mongoJob.userId),
    });

    workerMetrics.recordJobFailed();
    mongoJob.status = ExportJobStatus.FAILED;
    mongoJob.error = err;
    await mongoJob.save();
    return true;
  }
};

const processNextJob = async (queue: Awaited<ReturnType<typeof createRedisQueueFromEnvironment>>) => {
  const payload = await queue.dequeue('export-jobs');
  let jobId = payload?.jobId ? String(payload.jobId) : undefined;

  if (!jobId) {
    const pendingJob = await ExportJob.findOne({ status: ExportJobStatus.PENDING }).sort({ createdAt: 1 }).lean();
    if (!pendingJob) {
      return false;
    }

    jobId = String(pendingJob._id);
    console.log('[worker] found pending job without queue payload', { jobId });
  } else {
    console.log('[worker] dequeued export payload', payload);
    workerMetrics.recordJobQueued();
  }

  const mongoJob = await ExportJob.findById(jobId);
  if (!mongoJob) {
    console.warn('[worker] export job missing in MongoDB', { jobId });
    return true;
  }

  if (mongoJob.status === ExportJobStatus.IN_PROGRESS || mongoJob.status === ExportJobStatus.COMPLETED) {
    console.log('[worker] skipping already-processed job', { jobId, status: mongoJob.status });
    return true;
  }

  const handled = await processExportJob(jobId, queue);
  if (!handled && (payload?.retries ?? 0) < MAX_RETRIES) {
    const nextPayload = {
      jobId: payload?.jobId ?? jobId,
      retries: (payload?.retries ?? 0) + 1,
    };
    console.log('[worker] re-enqueueing export job for retry', nextPayload);
    await queue.enqueue('export-jobs', nextPayload);
    return true;
  }

  return true;
};

const startWorker = async () => {
  const mongoUri = config.MONGO_URI;
  await mongoose.connect(mongoUri);
  console.log('Worker connected to MongoDB');

  const queue = await createRedisQueueFromEnvironment();
  console.log('Worker connected to Redis');

  const poll = async () => {
    const handled = await processNextJob(queue);
    if (handled) {
      setTimeout(poll, 1000);
      return;
    }

    setTimeout(poll, 2000);
  };

  poll();
};

startWorker().catch((error) => {
  console.error('Worker failed to start', error);
  process.exit(1);
});
