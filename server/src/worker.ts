import mongoose from 'mongoose';
import ExportJob, { ExportJobStatus } from './models/ExportJob';
import Transaction, { TransactionType } from './models/Transaction';
import Wallet from './models/Wallet';
import { buildExportTransactionFilter } from './services/exportJobService';
import { calculateStatementSummary } from './services/statementSummaryService';
import { createStatementPdfBuffer, createStatementXlsxBuffer } from './services/exportDocumentService';
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
    const filePath = buildExportFilePath(mongoJob._id.toString(), mongoJob.format);
    const filter = buildExportTransactionFilter(
      mongoJob.tenantId.toString(),
      mongoJob.userId.toString(),
      {
        walletId: mongoJob.filters.walletId?.toString(),
        startDate: mongoJob.filters.startDate,
        endDate: mongoJob.filters.endDate,
      },
    );
    const rows = await Transaction.find(filter).sort({ date: -1, createdAt: -1 }).lean();

    const exportRows = rows.map((tx) => ({
      date: new Date(tx.date).toISOString().split('T')[0],
      category: tx.category,
      note: tx.note || '',
      type: tx.type,
      amount: tx.amount,
      balanceAfter: tx.balanceAfter,
    }));

    const periodStart = new Date(mongoJob.filters.startDate);
    const periodEnd = new Date(mongoJob.filters.endDate);
    const periodQuery: Record<string, unknown> = {
      tenantId: mongoJob.tenantId,
      userId: mongoJob.userId,
      date: { $gte: periodStart, $lte: periodEnd },
    };

    if (mongoJob.filters.walletId) {
      periodQuery.walletId = mongoJob.filters.walletId;
    }

    const summaryResult = await Transaction.aggregate([
      { $match: periodQuery },
      {
        $group: {
          _id: null,
          totalIncome: { $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', 0] } },
          totalExpense: { $sum: { $cond: [{ $eq: ['$type', TransactionType.EXPENSE] }, '$amount', 0] } },
        },
      },
    ]);

    const wallets = await Wallet.find({
      tenantId: mongoJob.tenantId,
      userId: mongoJob.userId,
      ...(mongoJob.filters.walletId ? { _id: mongoJob.filters.walletId } : {}),
    }).select('_id initialBalance currentBalance').lean();

    const openingBalances = await Transaction.aggregate([
      {
        $match: {
          tenantId: mongoJob.tenantId,
          userId: mongoJob.userId,
          date: { $lt: periodStart },
          ...(mongoJob.filters.walletId ? { walletId: mongoJob.filters.walletId } : {}),
        },
      },
      { $sort: { date: -1, createdAt: -1, _id: -1 } },
      { $group: { _id: '$walletId', balanceAfter: { $first: '$balanceAfter' } } },
    ]);

    const openingByWallet = new Map(openingBalances.map((item) => [item._id.toString(), item.balanceAfter]));
    const summary = calculateStatementSummary({
      wallets: wallets.map((wallet) => ({ _id: wallet._id.toString(), initialBalance: wallet.initialBalance })),
      openingByWallet,
      totalIncome: summaryResult[0]?.totalIncome ?? 0,
      totalExpense: summaryResult[0]?.totalExpense ?? 0,
    });

    const reportRange = { startDate: mongoJob.filters.startDate, endDate: mongoJob.filters.endDate };
    const fileBuffer = mongoJob.format === 'pdf'
      ? await createStatementPdfBuffer(exportRows, summary, reportRange)
      : createStatementXlsxBuffer(exportRows, summary, reportRange);

    await ensureExportDirectory();
    await fs.writeFile(filePath, fileBuffer);

    mongoJob.status = ExportJobStatus.COMPLETED;
    mongoJob.fileKey = `${mongoJob._id.toString()}.${mongoJob.format}`;
    mongoJob.completedAt = new Date();
    mongoJob.error = undefined;
    await mongoJob.save();

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
