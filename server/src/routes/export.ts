import express, { Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { AuthRequest, authenticate, requireReadAccess, requireWriteAccess } from '../middleware/auth';
import ExportJob, { ExportJobStatus } from '../models/ExportJob';
import Transaction, { TransactionType } from '../models/Transaction';
import Wallet from '../models/Wallet';
import { buildExportTransactionFilter, normalizeExportFormat } from '../services/exportJobService';
import { calculateStatementSummary } from '../services/statementSummaryService';
import { createStatementPdfBuffer, createStatementXlsxBuffer } from '../services/exportDocumentService';
import { buildQueueKey, createRedisQueueClient, normalizeQueuePayload } from '../services/redisQueue';

const router = express.Router();
router.use(authenticate);
router.use(requireReadAccess);

const EXPORT_DIR = path.resolve(process.cwd(), 'exports');

const ensureExportDirectory = async () => {
  await fs.mkdir(EXPORT_DIR, { recursive: true });
};

const buildExportFilePath = (jobId: string, format: 'xlsx' | 'pdf') => path.join(EXPORT_DIR, `${jobId}.${format}`);

const createJobFileName = (job: { _id: mongoose.Types.ObjectId; filters: { startDate: string; endDate: string }; format: 'xlsx' | 'pdf' }) =>
  `statement_${job.filters.startDate}_to_${job.filters.endDate}.${job.format}`;

const exportQueue = createRedisQueueClient();

const queueExportJob = async (jobId: string) => {
  const queueKey = buildQueueKey('export-jobs');
  const payload = normalizeQueuePayload({ jobId, retries: 0 });

  try {
    await exportQueue.enqueue('export-jobs', payload);
    return { queueKey, payload };
  } catch (error) {
    console.warn('Queue enqueue failed', error);
    return null;
  }
};

const generateExportFileForJob = async (job: any) => {
  const filePath = buildExportFilePath(String(job._id), job.format);
  const filter = buildExportTransactionFilter(job.tenantId.toString(), job.userId.toString(), job.filters);
  const rows = await Transaction.find(filter).sort({ date: -1, createdAt: -1 }).lean();

  const exportRows = rows.map((tx) => ({
    date: new Date(tx.date).toISOString().split('T')[0],
    category: tx.category,
    note: tx.note || '',
    type: tx.type,
    amount: tx.amount,
    balanceAfter: tx.balanceAfter,
  }));

  const periodStart = new Date(job.filters.startDate);
  const periodEnd = new Date(job.filters.endDate);
  const periodQuery: Record<string, unknown> = {
    tenantId: job.tenantId,
    userId: job.userId,
    date: { $gte: periodStart, $lte: periodEnd },
  };

  if (job.filters.walletId) {
    periodQuery.walletId = job.filters.walletId;
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
    tenantId: job.tenantId,
    userId: job.userId,
    ...(job.filters.walletId ? { _id: job.filters.walletId } : {}),
  }).select('_id initialBalance currentBalance').lean();

  const openingBalances = await Transaction.aggregate([
    {
      $match: {
        tenantId: job.tenantId,
        userId: job.userId,
        date: { $lt: periodStart },
        ...(job.filters.walletId ? { walletId: job.filters.walletId } : {}),
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

  const fileBuffer = job.format === 'pdf'
    ? await createStatementPdfBuffer(exportRows, summary, { startDate: job.filters.startDate, endDate: job.filters.endDate })
    : createStatementXlsxBuffer(exportRows, summary, { startDate: job.filters.startDate, endDate: job.filters.endDate });

  await ensureExportDirectory();
  await fs.writeFile(filePath, fileBuffer);

  await ExportJob.findByIdAndUpdate(job._id, {
    status: ExportJobStatus.COMPLETED,
    completedAt: new Date(),
    fileKey: `${String(job._id)}.${job.format}`,
    error: undefined,
  });

  return filePath;
};

router.post('/', requireWriteAccess, async (req: AuthRequest, res: Response) => {
  try {
    const { walletId, startDate, endDate, format } = req.body ?? {};

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    if (walletId && !mongoose.isValidObjectId(walletId)) {
      return res.status(400).json({ message: 'walletId must be a valid ObjectId' });
    }

    const normalizedFormat = normalizeExportFormat(format);
    const job = await ExportJob.create({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      format: normalizedFormat,
      filters: {
        walletId: walletId ? new mongoose.Types.ObjectId(walletId) : undefined,
        startDate,
        endDate,
      },
      status: ExportJobStatus.PENDING,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    });

    try {
      await generateExportFileForJob(job);
      await queueExportJob(String(job._id));
    } catch (error) {
      console.error('Failed to generate export file for job:', error);
      await ExportJob.findByIdAndUpdate(job._id, {
        status: ExportJobStatus.FAILED,
        error: error instanceof Error ? error.message : 'Export generation failed',
      });
      return res.status(500).json({ message: 'Failed to generate export file' });
    }

    res.status(202).json({
      jobId: String(job._id),
      status: ExportJobStatus.COMPLETED,
      format: job.format,
      expiresAt: job.expiresAt,
    });
  } catch (error) {
    console.error('Failed to create export job:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const job = await ExportJob.findOne({ _id: req.params.id, tenantId: req.user!.tenantId, userId: req.user!.id }).lean();

    if (!job) {
      return res.status(404).json({ message: 'Export job not found' });
    }

    if (new Date(job.expiresAt).getTime() < Date.now() && job.status !== ExportJobStatus.COMPLETED) {
      await ExportJob.findByIdAndUpdate(job._id, { status: ExportJobStatus.EXPIRED });
      return res.status(410).json({ message: 'Export job expired', status: ExportJobStatus.EXPIRED });
    }

    res.json(job);
  } catch (error) {
    console.error('Failed to read export job:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/download', async (req: AuthRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const job = await ExportJob.findOne({ _id: req.params.id, tenantId: req.user!.tenantId, userId: req.user!.id }).lean();

    if (!job) {
      return res.status(404).json({ message: 'Export job not found' });
    }

    if (job.status !== ExportJobStatus.COMPLETED) {
      return res.status(409).json({ message: 'Export is not ready yet', status: job.status });
    }

    const filePath = buildExportFilePath(String(job._id), job.format);
    const fileBuffer = await fs.readFile(filePath);

    const contentType = job.format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${createJobFileName(job as any)}"`);
    res.send(fileBuffer);
  } catch (error) {
    console.error('Failed to download export:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
