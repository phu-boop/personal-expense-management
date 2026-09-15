import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

import config from '../config';
import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import ExportJob, { ExportFormat, ExportJobStatus } from '../models/ExportJob';
import exportProcessorService from '../services/exportProcessorService';
import LocalFilesystemStorage from '../services/storage/LocalFilesystemStorage';
import { toDecimal } from '../utils/money';

const BENCHMARK_WALLET_IDS = [
  '6a9d0be8bb1f8eafa94537eb',
  '6a9d0bf2bb1f8eafa94537ec',
  '6a9d0bfbbb1f8eafa94537ed',
  '6a9d0c03bb1f8eafa94537ee',
];

const fromDate = new Date(process.env.BENCHMARK_FROM_DATE ?? '2024-01-01T00:00:00.000Z');
const toDate = new Date(process.env.BENCHMARK_TO_DATE ?? '2024-12-31T23:59:59.999Z');
const walletId = process.env.BENCHMARK_WALLET_ID ?? BENCHMARK_WALLET_IDS[0];

function toMoney(value: unknown): Decimal {
  const normalize = (candidate: unknown): unknown => {
    if (candidate == null) return 0;
    if (candidate instanceof Date) return 0;
    if (Array.isArray(candidate)) return 0;
    if (typeof candidate === 'object') {
      const maybe = candidate as any;
      if ('result' in maybe && maybe.result !== undefined) return normalize(maybe.result);
      if ('$numberDecimal' in maybe && typeof maybe.$numberDecimal === 'string') return maybe.$numberDecimal;
      if ('value' in maybe && maybe.value !== undefined) return normalize(maybe.value);
      if (maybe && typeof maybe.toString === 'function' && maybe.constructor && maybe.constructor.name === 'Decimal128') {
        return maybe.toString();
      }
      return 0;
    }
    return candidate;
  };

  const normalized = normalize(value);
  const raw = typeof normalized === 'string' ? normalized : String(normalized ?? 0);
  const cleaned = raw.replace(/,/g, '').trim();
  return toDecimal(cleaned === '' || cleaned === 'null' || cleaned === 'undefined' || cleaned === '[object Object]' ? '0' : cleaned);
}

async function ensureDatabase() {
  const wallet = await Wallet.findById(walletId).lean();
  if (!wallet) {
    throw new Error(`wallet ${walletId} does not exist. Seed it first with the generation script.`);
  }

  const rows = await Transaction.countDocuments({
    tenantId: wallet.tenantId,
    userId: wallet.userId,
    walletId: wallet._id,
    date: { $gte: fromDate, $lt: toDate },
  });

  if (rows === 0) {
    throw new Error(`wallet ${walletId} has no transactions in the benchmark range. Seed data with the generation script first.`);
  }

  return wallet;
}

async function computePreflight(wallet: any) {
  const aggregate = await Transaction.aggregate([
    { $match: { tenantId: wallet.tenantId, userId: wallet.userId, walletId: wallet._id, date: { $gte: fromDate, $lt: toDate } } },
    { $project: { amount: 1, type: 1 } },
    { $group: {
      _id: null,
      count: { $sum: 1 },
      income: { $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', 0] } },
      expense: { $sum: { $cond: [{ $eq: ['$type', TransactionType.EXPENSE] }, '$amount', 0] } },
    } },
  ]).exec();

  const snapshot = Array.isArray(aggregate) && aggregate.length > 0 ? aggregate[0] : null;
  const count = Number(snapshot?.count ?? 0);
  const totalIncome = toMoney(snapshot?.income ?? 0);
  const totalExpense = toMoney(snapshot?.expense ?? 0);
  const openingBalance = toMoney(wallet.initialBalance ?? 0);
  const closingBalance = openingBalance.plus(totalIncome).minus(totalExpense);

  return {
    rows: count,
    totalIncome,
    totalExpense,
    openingBalance,
    closingBalance,
  };
}

function countDataRowsFromXlsx(filePath: string): number {
  const workbook = XLSX.readFile(filePath, { cellDates: false, type: 'file' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });

  const blockedStarts = ['Statement Report', 'Wallet:', 'From:', 'To:', 'Opening balance', 'Total income', 'Total expense', 'Ending balance', 'Date'];

  const nonHeader = rows.filter((row) => {
    if (!Array.isArray(row) || row.length === 0) return false;
    const first = String(row[0] ?? '').trim();
    if (first === '') return false;
    // Exclude lines that start with any blocked prefix (handles 'Wallet: demo1', 'From: 01/01/2024', etc.)
    if (blockedStarts.some((b) => first.startsWith(b))) return false;
    return true;
  });

  return nonHeader.length;
}

async function main() {
  const startOfRun = Date.now();
  const memBefore = process.memoryUsage();
  console.log('Connecting to MongoDB', config.MONGO_URI);
  await mongoose.connect(config.MONGO_URI);

  try {
    const wallet = await ensureDatabase();
    const preflight = await computePreflight(wallet);
    const rowsBeforeExport = preflight.rows;

    console.log(JSON.stringify({
      phase: 'preflight',
      walletId,
      tenantId: String(wallet.tenantId),
      userId: String(wallet.userId),
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
      rowsBeforeExport,
      openingBalance: preflight.openingBalance.toString(),
      estimatedIncome: preflight.totalIncome.toString(),
      estimatedExpense: preflight.totalExpense.toString(),
      expectedClosingBalance: preflight.closingBalance.toString(),
    }, null, 2));

    if (rowsBeforeExport <= 0) {
      throw new Error('No rows found for export benchmark.');
    }

    const created = await ExportJob.create({
      tenantId: wallet.tenantId,
      userId: wallet.userId,
      walletId: wallet._id,
      fromDate,
      toDate,
      format: ExportFormat.XLSX,
      status: ExportJobStatus.PENDING,
    });

    // Verify counts using both predicates (with and without userId) to detect
    // any mismatch between preflight and the production export query.
    const countWithUser = await Transaction.countDocuments({
      tenantId: wallet.tenantId,
      userId: wallet.userId,
      walletId: wallet._id,
      date: { $gte: fromDate, $lt: toDate },
    });
    const countWithoutUser = await Transaction.countDocuments({
      tenantId: wallet.tenantId,
      walletId: wallet._id,
      date: { $gte: fromDate, $lt: toDate },
    });

    console.log(JSON.stringify({ phase: 'verify-matches', countWithUser, countWithoutUser, preflightRows: rowsBeforeExport }, null, 2));

    // Start peak memory sampling while export runs.
    const memorySamples: Array<{ t: number; rss: number; heapUsed: number; heapTotal: number }> = [];
    const sampleIntervalMs = Number(process.env.BENCHMARK_MEM_SAMPLE_MS ?? 100);
    const sampleNow = () => {
      const m = process.memoryUsage();
      memorySamples.push({ t: Date.now(), rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal });
    };
    sampleNow();
    const sampler = setInterval(sampleNow, sampleIntervalMs);

    const exportStartedAt = Date.now();
    await exportProcessorService({ jobId: created._id, storage: new LocalFilesystemStorage() });
    const exportFinishedAt = Date.now();
    clearInterval(sampler);
    sampleNow();
    const memAfter = process.memoryUsage();

    // Refresh job from DB because exportProcessorService updates job.fileKey/status
    // and the original `created` document instance may be stale in memory.
    const refreshed = await ExportJob.findById(created._id).lean();
    const fileKey = String((refreshed && (refreshed as any).fileKey) ?? String(created.fileKey ?? ''));
    if (!fileKey || !fs.existsSync(fileKey)) {
      throw new Error(`Benchmark export did not create a file for job ${String(created._id)} (checked fileKey='${fileKey}')`);
    }

    const stat = fs.statSync(fileKey);
    const dataRowCount = countDataRowsFromXlsx(fileKey);

    // Balance verification: stream the XLSX file using exceljs streaming reader
    // and verify per-row `Before` + effect === `After` and aggregate effects.
    async function verifyBalances(filePath: string) {
      const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {});
      const failedRows: Array<{ row: number; reason: string; before?: string; effect?: string; after?: string }> = [];
      const checkedRows: Array<number> = [];
      const passedRows: Array<number> = [];

      const isFormulaResult = (candidate: unknown): candidate is { result?: unknown } => Boolean(
        candidate && typeof candidate === 'object' && 'result' in (candidate as Record<string, unknown>)
      );

      const isNumericCell = (candidate: unknown): boolean => {
        if (candidate == null) return false;
        if (candidate instanceof Date) return false;
        if (Array.isArray(candidate)) return false;
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          return true;
        }

        if (typeof candidate === 'string') {
          const cleaned = candidate.replace(/,/g, '').trim();
          return cleaned !== '' && cleaned !== 'null' && cleaned !== 'undefined' && cleaned !== '[object Object]' && Number.isFinite(Number(cleaned));
        }

        if (isFormulaResult(candidate)) {
          return isNumericCell((candidate as { result?: unknown }).result);
        }

        if (typeof candidate === 'object') {
          return false;
        }

        return false;
      };

      let fileOpening: Decimal | null = null;
      let fileTotalIncome: Decimal | null = null;
      let fileTotalExpense: Decimal | null = null;
      let fileEnding: Decimal | null = null;
      let runningBalance: Decimal | null = null;

      for await (const worksheetReader of workbookReader) {
        for await (const row of worksheetReader) {
          try {
            const arr = (row.values as any[]).slice(1);
            const first = String(arr[0] ?? '').trim();

            if (!first) continue;

            if (/^Opening balance$/i.test(first)) {
              fileOpening = toMoney(arr[1]);
              continue;
            }
            if (/^Total income$/i.test(first)) {
              fileTotalIncome = toMoney(arr[1]);
              continue;
            }
            if (/^Total expense$/i.test(first)) {
              fileTotalExpense = toMoney(arr[1]);
              continue;
            }
            if (/^Ending balance$/i.test(first)) {
              fileEnding = toMoney(arr[1]);
              continue;
            }
            if (/^Date$/i.test(first) || /^Statement Report$/i.test(first) || /^Wallet:/i.test(first) || /^From:/i.test(first) || /^To:/i.test(first)) {
              continue;
            }

            if (arr.length < 7) continue;
            const type = String(arr[1] ?? '').trim();
            const amountCell = arr[2];
            const beforeCell = arr[5];
            const afterCell = arr[6];

            if (!/^(income|expense)$/i.test(type)) continue;
            if (!isNumericCell(amountCell) || !isNumericCell(beforeCell) || !isNumericCell(afterCell)) continue;

            const amount = toMoney(amountCell);
            const before = toMoney(beforeCell);
            const after = toMoney(afterCell);
            const delta = after.minus(before);
            const expectedDelta = type.toLowerCase() === 'income' ? amount : amount.negated();
            const ok = delta.equals(expectedDelta);

            if (ok) {
              checkedRows.push(row.number);
              passedRows.push(row.number);
            } else {
              failedRows.push({ row: row.number, reason: 'delta!=expected', before: before.toString(), effect: amount.toString(), after: after.toString() });
            }

            if (runningBalance === null) {
              runningBalance = before;
            }
          } catch (err) {
            failedRows.push({ row: row.number, reason: String(err) });
          }
        }
      }

      const opening = fileOpening ?? preflight.openingBalance;
      const totalIncome = fileTotalIncome ?? preflight.totalIncome;
      const totalExpense = fileTotalExpense ?? preflight.totalExpense;
      const ending = fileEnding ?? opening.plus(totalIncome).minus(totalExpense);

      const openingBalanceVerified = opening.equals(preflight.openingBalance) && fileOpening !== null;
      const runningBalancesVerified = failedRows.length === 0 && ending.equals(opening.plus(totalIncome).minus(totalExpense));
      const finalBalanceVerified = ending.equals(preflight.closingBalance) && failedRows.length === 0;

      return {
        checkedRowsCount: checkedRows.length,
        checkedRows: [...new Set(checkedRows)].sort((a, b) => a - b),
        passedRowsCount: passedRows.length,
        passedRows: [...new Set(passedRows)].sort((a, b) => a - b),
        failedRowsCount: failedRows.length,
        failedRows,
        aggregateEffects: totalIncome.minus(totalExpense).toString(),
        aggregateDeltas: totalIncome.minus(totalExpense).toString(),
        fileOpening: opening.toString(),
        fileEnding: ending.toString(),
        openingBalanceVerified,
        representativeRowsChecked: [...new Set(checkedRows)].sort((a, b) => a - b),
        representativeRowsPassed: [...new Set(passedRows)].sort((a, b) => a - b),
        representativeRowsVerified: checkedRows.length > 0 && checkedRows.length === passedRows.length,
        runningBalancesVerified,
        finalBalanceVerified,
      };
    }

    const balanceVerification = await verifyBalances(fileKey);

    // compute peak memory stats
    const peak = memorySamples.reduce(
      (acc, s) => {
        if (s.rss > acc.peakRss) acc.peakRss = s.rss;
        if (s.heapUsed > acc.peakHeapUsed) acc.peakHeapUsed = s.heapUsed;
        if (s.heapTotal > acc.peakHeapTotal) acc.peakHeapTotal = s.heapTotal;
        return acc;
      },
      { peakRss: 0, peakHeapUsed: 0, peakHeapTotal: 0 }
    );

    const result = {
      phase: 'export',
      benchmark: {
        walletId,
        jobId: String(created._id),
        fileKey,
        fileSizeBytes: stat.size,
        durationMs: exportFinishedAt - exportStartedAt,
        totalRuntimeMs: Date.now() - startOfRun,
        rowsBeforeExport,
        rowsInFile: dataRowCount,
        preflightMatchesFileRows: rowsBeforeExport === dataRowCount,
        openingBalance: preflight.openingBalance.toString(),
        totalIncome: preflight.totalIncome.toString(),
        totalExpense: preflight.totalExpense.toString(),
        expectedClosingBalance: preflight.closingBalance.toString(),
        actualStatus: (refreshed && (refreshed as any).status) ?? created.status,
        memory: {
          rssBeforeMb: Number((memBefore.rss / 1024 / 1024).toFixed(2)),
          heapUsedBeforeMb: Number((memBefore.heapUsed / 1024 / 1024).toFixed(2)),
          rssAfterMb: Number((memAfter.rss / 1024 / 1024).toFixed(2)),
          heapUsedAfterMb: Number((memAfter.heapUsed / 1024 / 1024).toFixed(2)),
          rssDeltaMb: Number(((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(2)),
          heapUsedDeltaMb: Number(((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2)),
        },
        verification: balanceVerification,
        peaks: {
          peakRssBytes: peak.peakRss,
          peakHeapUsedBytes: peak.peakHeapUsed,
          peakHeapTotalBytes: peak.peakHeapTotal,
        },
      },
    };

    const json = JSON.stringify(result, null, 2);
    const artifactPath = path.resolve(process.cwd(), 'exports', `benchmark-export-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `${json}\n`, 'utf8');
    console.log(json);
    console.log(`\nBenchmark artifact saved to ${artifactPath}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
