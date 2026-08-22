import mongoose from 'mongoose';
import ExportJob, { ExportJobStatus } from './models/ExportJob';
import Transaction, { TransactionType } from './models/Transaction';
import Wallet from './models/Wallet';
import { buildExportTransactionFilter } from './services/exportJobService';
import { calculateStatementSummary } from './services/statementSummaryService';
import { createStatementPdfBuffer, createStatementXlsxBuffer } from './services/exportDocumentService';
import { generateAndSaveExport } from './services/exportProcessorService';
import { createRedisQueueFromEnvironment } from './services/redisQueue';
import { createWorkerMetrics } from './services/workerMetrics';
import fs from 'node:fs/promises';
import path from 'node:path';

const EXPORT_DIR = path.resolve(process.cwd(), 'exports');
const MAX_RETRIES = 3;
const workerMetrics = createWorkerMetrics();

const ensureExportDirectory = async () => {
  await fs.mkdir(EXPORT_DIR, { recursive: true });
};

const buildExportFilePath = (jobId: string, format: 'xlsx' | 'pdf') => path.join(EXPORT_DIR, `${jobId}.${format}`);

const processExportJob = async (jobId: string, queue: Awaited<ReturnType<typeof createRedisQueueFromEnvironment>>) => {
  const mongoJob = await ExportJob.findById(jobId);
  if (!mongoJob) {
    return true;
  }

  if (mongoJob.status === ExportJobStatus.EXPIRED) {
    return true;
  }

  mongoJob.status = ExportJobStatus.PROCESSING;
  await mongoJob.save();

  const startedAt = Date.now();

  try {
    await generateAndSaveExport(mongoJob);
    workerMetrics.recordJobProcessed(Date.now() - startedAt);
    return true;
  } catch (error) {
    const err = error instanceof Error ? error.message : 'Unknown export error';
    const retryCount = Number(mongoJob.error?.match(/Retry\s+(\d+)\//)?.[1] ?? 0);
    const nextRetry = retryCount + 1;

    if (nextRetry <= MAX_RETRIES) {
      workerMetrics.recordRetry();
      mongoJob.error = `Retry ${nextRetry}/${MAX_RETRIES}: ${err}`;
      await mongoJob.save();
      return false;
    }

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
  } else {
    workerMetrics.recordJobQueued();
  }

  const mongoJob = await ExportJob.findById(jobId);
  if (!mongoJob) {
    return true;
  }

  if (mongoJob.status === ExportJobStatus.PROCESSING || mongoJob.status === ExportJobStatus.COMPLETED) {
    return true;
  }

  const handled = await processExportJob(jobId, queue);
  if (!handled && (payload?.retries ?? 0) < MAX_RETRIES) {
    const nextPayload = {
      jobId: payload?.jobId ?? jobId,
      retries: (payload?.retries ?? 0) + 1,
    };
    await queue.enqueue('export-jobs', nextPayload);
    return true;
  }

  return true;
};

const startWorker = async () => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/expense_manager';
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
