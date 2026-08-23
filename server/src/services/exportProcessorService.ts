import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import Transaction, { TransactionType } from '../models/Transaction';
import Wallet from '../models/Wallet';
import ExportJob, { ExportJobStatus } from '../models/ExportJob';
import { buildExportTransactionFilter } from './exportJobService';
import { calculateStatementSummary } from './statementSummaryService';
import { createStatementPdfBuffer, createStatementXlsxBuffer } from './exportDocumentService';

const EXPORT_DIR = path.resolve(process.cwd(), 'exports');

const ensureExportDirectory = async () => {
  await fs.mkdir(EXPORT_DIR, { recursive: true, mode: 0o777 });
  await fs.chmod(EXPORT_DIR, 0o777);
};

const buildExportFilePath = (jobId: string, format: 'xlsx' | 'pdf') => path.join(EXPORT_DIR, `${jobId}.${format}`);

export const generateAndSaveExport = async (mongoJob: (typeof ExportJob.prototype) | any) => {
  const filePath = buildExportFilePath(String(mongoJob._id), mongoJob.format);

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

  const fileBuffer = mongoJob.format === 'pdf'
    ? await createStatementPdfBuffer(exportRows, summary, { startDate: mongoJob.filters.startDate, endDate: mongoJob.filters.endDate })
    : createStatementXlsxBuffer(exportRows, summary, { startDate: mongoJob.filters.startDate, endDate: mongoJob.filters.endDate });

  await ensureExportDirectory();
  await fs.writeFile(filePath, fileBuffer);

  mongoJob.status = ExportJobStatus.COMPLETED;
  mongoJob.completedAt = new Date();
  mongoJob.fileKey = `${String(mongoJob._id)}.${mongoJob.format}`;
  mongoJob.error = undefined;
  await mongoJob.save();

  return filePath;
};

export const buildExportPathForJob = (jobId: string, format: 'xlsx' | 'pdf') => buildExportFilePath(jobId, format);
