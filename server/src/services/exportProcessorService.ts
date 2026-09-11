import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import { Readable } from 'stream';
import Transaction, { ITransaction, TransactionType } from '../models/Transaction';
import Wallet from '../models/Wallet';
import Category from '../models/Category';
import BalanceSnapshot, { BalanceSnapshotStatus } from '../models/BalanceSnapshot';
import orderingUtils from '../utils/ordering';
import { toDecimal } from '../utils/money';
import { getTransactionEffect } from '../utils/transactionEffect';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import StorageAdapter from './storage/StorageAdapter';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import { spawn } from 'child_process';
import ExportJob, { ExportFormat, ExportJobStatus } from '../models/ExportJob';

export type ExportJobInput = {
  jobId: mongoose.Types.ObjectId;
  storage: StorageAdapter;
};

const PDF_MAX_ROWS_PER_CHUNK = Number(process.env.EXPORT_PDF_MAX_ROWS_PER_CHUNK ?? 2500);
const XLSX_PROGRESS_CHECKPOINTS = (process.env.EXPORT_XLSX_PROGRESS_CHECKPOINTS ?? '10000,100000,200000,500000,1000000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

const formatDisplayDate = (value: Date | string | undefined | null) => {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatMoneyForExport = (value: Decimal | string | number | mongoose.Types.Decimal128 | null | undefined) => {
  const decimal = toDecimal(String(value ?? 0));
  return Number(decimal.toFixed(2)).toLocaleString('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatMoneyWithoutCurrency = (value: Decimal | string | number | mongoose.Types.Decimal128 | null | undefined) => {
  const decimal = toDecimal(String(value ?? 0));
  return Number(decimal.toFixed(2)).toLocaleString('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const resolveCategoryName = (category: any, categoryMap: Record<string, string>) => {
  if (!category) return 'Uncategorized';
  if (typeof category === 'string') return categoryMap[String(category)] ?? category;
  if (typeof category === 'object') {
    const id = category._id ? String(category._id) : '';
    if (id && categoryMap[id]) return categoryMap[id];
    if (category.name) return String(category.name);
    return String(category);
  }
  return 'Uncategorized';
};

export function sumChunkPageCounts(pageCounts: Array<number | null | undefined>): number {
  return pageCounts.reduce<number>((sum, count) => sum + Math.max(0, Number(count ?? 0)), 0);
}

async function mergePdfFiles(inputFiles: string[], outputFile: string): Promise<void> {
  if (!Array.isArray(inputFiles) || inputFiles.length === 0) {
    throw new Error('mergePdfFiles requires at least one input PDF file');
  }

  const preferredBin = process.env.PDFUNITE_BIN || process.env.PDF_MERGE_BIN || 'pdfunite';
  let executable: string | null = null;

  try {
    const resolved = await new Promise<string | null>((resolve) => {
      const proc = spawn('which', [preferredBin], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('close', (code) => resolve(code === 0 && stdout.trim() ? stdout.trim() : null));
      proc.on('error', () => resolve(null));
    });

    if (resolved) {
      executable = resolved;
    }
  } catch {
    executable = null;
  }

  if (!executable) {
    throw new Error('pdfunite is required for large PDF export but was not found in PATH');
  }

  for (const file of inputFiles) {
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size === 0) {
        throw new Error(`input PDF chunk is invalid or empty: ${file}`);
      }
    } catch (error) {
      throw new Error(`input PDF chunk not found or unreadable: ${file}`);
    }
  }

  const start = Date.now();
  const stdioLimit = 64 * 1024;
  let stdout = '';
  let stderr = '';

  const child = spawn(executable, [...inputFiles, outputFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
    if (stdout.length > stdioLimit) stdout = stdout.slice(-stdioLimit);
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > stdioLimit) stderr = stderr.slice(-stdioLimit);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  const durationMs = Date.now() - start;

  if (exitCode !== 0) {
    throw new Error(`pdf merge failed with exit code ${exitCode}: ${stderr || stdout || 'unknown error'}`);
  }

  try {
    await fs.promises.access(outputFile);
    const finalStat = await fs.promises.stat(outputFile);
    if (!finalStat.isFile() || finalStat.size === 0) {
      throw new Error(`expected merged PDF output file missing or empty: ${outputFile}`);
    }
  } catch (error) {
    throw new Error(`merged PDF output was not created: ${outputFile}`);
  }
}

// Helper: compute opening balance (reuse statement semantics)
async function computeOpeningBalance(tenantId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId, walletId: mongoose.Types.ObjectId, from: Date) {
  const wallet = await Wallet.findOne({ _id: walletId, tenantId, userId }).lean();
  if (!wallet) throw new Error('wallet not found');

  const pageStartCandidate = { date: from, createdAt: new Date(0), _id: new mongoose.Types.ObjectId('000000000000000000000000') };
  const beforePred = orderingUtils.buildBeforePredicate(pageStartCandidate);

  const snapshot = await BalanceSnapshot.findOne({ tenantId, walletId, status: BalanceSnapshotStatus.VALID, ...beforePred })
    .sort({ lastTransactionDate: -1, lastTransactionCreatedAt: -1, lastTransactionId: -1 })
    .lean();

  let openingBalanceDecimal = toDecimal(wallet.initialBalance);

  if (snapshot) {
    openingBalanceDecimal = toDecimal(snapshot.balance);
    const afterSnap = orderingUtils.buildAfterPredicate({ date: snapshot.lastTransactionDate!, createdAt: snapshot.lastTransactionCreatedAt!, _id: snapshot.lastTransactionId! });
    const beforeFrom = orderingUtils.buildBeforePredicate({ date: from, createdAt: new Date(0), _id: new mongoose.Types.ObjectId('000000000000000000000000') });
    const aggMatch: any = { tenantId, walletId, $and: [afterSnap, beforeFrom] };
    const agg = await Transaction.aggregate([
      { $match: aggMatch },
      { $project: { amount: 1, type: 1 } },
      { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', { $multiply: ['$amount', -1] } ] } } } },
    ]).exec();
    if (agg.length === 1 && agg[0].total !== undefined && agg[0].total !== null) {
      openingBalanceDecimal = openingBalanceDecimal.plus(toDecimal(agg[0].total));
    }
  } else {
    const beforeFromMatch: any = { tenantId, walletId, date: { $lt: from } };
    const agg = await Transaction.aggregate([
      { $match: beforeFromMatch },
      { $project: { amount: 1, type: 1 } },
      { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', { $multiply: ['$amount', -1] } ] } } } },
    ]).exec();
    if (agg.length === 1 && agg[0].total !== undefined && agg[0].total !== null) {
      openingBalanceDecimal = openingBalanceDecimal.plus(toDecimal(agg[0].total));
    }
  }

  return openingBalanceDecimal;
}

export default async function exportProcessorService({ jobId, storage }: ExportJobInput) {
  const job = await ExportJob.findById(jobId);
  if (!job) throw new Error('export job not found');

  // load context
  const { tenantId, userId, walletId, fromDate, toDate, format } = job as any;

  // mark in progress
  job.status = ExportJobStatus.IN_PROGRESS;
  await job.save();
  try {
    const opening = await computeOpeningBalance(tenantId, userId, walletId, fromDate);
    const wallet = await Wallet.findById(walletId).lean();
    const walletName = wallet?.name ?? String(walletId);

    const match: any = { tenantId, walletId, date: { $gte: fromDate, $lt: toDate } };

    // Prefetch category names via distinct to avoid scanning all transactions into memory.
    const rawCategoryIds = await Transaction.distinct('category', match).exec().catch(() => []);
    const categoryIdList = (Array.isArray(rawCategoryIds) ? rawCategoryIds.filter(Boolean).map(String) : []);
    const categoryDocs = categoryIdList.length > 0 ? await Category.find({ _id: { $in: categoryIdList } }, { _id: 1, name: 1 }).lean() : [];
    const categoryMap: Record<string, string> = Object.fromEntries(categoryDocs.map((c: any) => [String(c._id), String(c.name)]));

    // totals and running balance
    let totalIncome = new Decimal(0);
    let totalExpense = new Decimal(0);
    let precomputedTotalIncome = new Decimal(0);
    let precomputedTotalExpense = new Decimal(0);
    let running = opening;
    let totalsPrecomputed = false;

    // Precompute totals for the export window so we can render them in the
    // PDF intro block (first chunk) and in XLSX header. This avoids having
    // the totals appear only at the end of the document.
    try {
      const agg = await Transaction.aggregate([
        { $match: match },
        { $project: { amount: 1, type: 1 } },
        { $group: {
          _id: null,
          income: { $sum: { $cond: [{ $eq: ['$type', TransactionType.INCOME] }, '$amount', 0] } },
          expense: { $sum: { $cond: [{ $eq: ['$type', TransactionType.EXPENSE] }, '$amount', 0] } },
        } },
      ]).exec();
      if (Array.isArray(agg) && agg.length === 1) {
        precomputedTotalIncome = toDecimal(agg[0].income ?? 0);
        precomputedTotalExpense = toDecimal(agg[0].expense ?? 0);
        totalsPrecomputed = true;
      }
    } catch (e) {
      // If aggregation fails, fall back to streaming accumulation.
      totalsPrecomputed = false;
    }

    // file generation
    if (format === ExportFormat.PDF) {
      const chunkDir = path.join(os.tmpdir(), `pem-export-${String(jobId)}-${Date.now()}`);
      fs.mkdirSync(chunkDir, { recursive: true });
      const chunkFiles: string[] = [];
      const chunkPageCounts: number[] = [];
      let totalPdfPages = 0;
      const maxRowsPerChunk = PDF_MAX_ROWS_PER_CHUNK;

      const applyFont = (doc: any) => {
        const candidateFonts = [
          process.env.PDF_FONT || '',
          path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.ttf'),
          '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
          '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
          '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
        ].filter(Boolean as any) as string[];

        for (const p of candidateFonts) {
          try {
            if (p && fs.existsSync(p)) {
              doc.font(p);
              console.log('Using PDF font:', p);
              return;
            }
          } catch (e) {
            // ignore
          }
        }

        console.warn('No TTF font found for PDF generation; Vietnamese may not render correctly. Set PDF_FONT env or place NotoSans-Regular.ttf in assets/fonts.');
      };

      const createChunkDoc = () => {
        const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: false });
        const filePath = path.join(chunkDir, `chunk-${chunkFiles.length}.pdf`);
        const writer = fs.createWriteStream(filePath);
        doc.pipe(writer);

        applyFont(doc);

        let pageCount = 1;

        // Only include the descriptive intro block (title, wallet, from/to,
        // opening balance) on the very first chunk so the final merged PDF
        // doesn't repeat the intro for every chunk. Subsequent chunks will
        // still include the table header on each page for readability.
        const includeIntro = chunkFiles.length === 0;

        if (includeIntro) {
          doc.fontSize(18).text('Statement Report', { align: 'center' });
          doc.moveDown();
          doc.fontSize(12).text(`Wallet: ${walletName}`);
          doc.text(`From: ${formatDisplayDate(fromDate)}`);
          doc.text(`To: ${formatDisplayDate(toDate)}`);
          doc.moveDown();
          doc.text(`Opening balance: ${formatMoneyForExport(opening)}`);
          // Show precomputed totals in the intro if available so the reader sees
          // total income/expense immediately (useful for large exports).
          if (totalsPrecomputed) {
            doc.moveDown();
            doc.fontSize(10).text(`Total income: ${formatMoneyWithoutCurrency(precomputedTotalIncome)}`);
            doc.text(`Total expense: ${formatMoneyWithoutCurrency(precomputedTotalExpense)}`);
            doc.moveDown();
          }
          doc.moveDown();
        }

        const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const startX = doc.page.margins.left;
        const rowHeight = 18;
        const colPerc = [0.12, 0.10, 0.12, 0.18, 0.22, 0.13, 0.13];
        const colWidths = colPerc.map(p => Math.floor(usableWidth * p));
        const colX: number[] = [startX];
        for (let i = 1; i < colWidths.length; i += 1) colX.push(colX[i - 1] + colWidths[i - 1]);

        const drawHeader = (headerY: number) => {
          doc.fontSize(9);
          const headers = ['Date', 'Type', 'Amount', 'Category', 'Note', 'Before', 'After'];
          headers.forEach((h, i) => {
            doc.text(h, colX[i], headerY, { width: colWidths[i], align: 'left' });
          });
          doc.moveTo(startX, headerY + rowHeight - 6).lineTo(startX + usableWidth, headerY + rowHeight - 6).stroke();
        };

        // Place header just below the last written line (if intro is present)
        // or at the top margin for non-intro chunks.
        const firstHeaderY = (chunkFiles.length === 0)
          ? Math.max(doc.page.margins.top + 8, Math.ceil(doc.y) + 8)
          : (doc.page.margins.top + 8);
        drawHeader(firstHeaderY);
        const initialY = firstHeaderY + rowHeight;

        return { doc, writer, filePath, startX, rowHeight, colX, colWidths, drawHeader, initialY, pageCount };
      };

      const finalizeChunk = async (chunk: ReturnType<typeof createChunkDoc>, includeTotals: boolean) => {
        // Place totals after the last written content. Use doc.y as the current
        // vertical cursor. If there's not enough room on the page, add a new
        // page and draw the header first.
        const totalsBlockHeight = 3 * 16; // approx height for three lines
        let currentYPos = (chunk.doc as any).y ?? chunk.initialY;
        const availableBelow = chunk.doc.page.height - chunk.doc.page.margins.bottom - currentYPos;
        let totalsY = Math.max(chunk.initialY + 12, Math.ceil(currentYPos + 8));
        if (availableBelow < totalsBlockHeight) {
          // start a new page so totals don't overlap table rows
          chunk.doc.addPage();
          chunk.pageCount += 1;
          const headerY = chunk.doc.page.margins.top + 8;
          chunk.drawHeader(headerY);
          // place totals after header area
          totalsY = headerY + chunk.rowHeight + 8;
        }

        if (includeTotals) {
          // Align totals with the table left margin (`startX`) for consistent layout
          const incomeForPrint = totalsPrecomputed ? precomputedTotalIncome : totalIncome;
          const expenseForPrint = totalsPrecomputed ? precomputedTotalExpense : totalExpense;
          chunk.doc.fontSize(10).text(`Total income: ${formatMoneyWithoutCurrency(incomeForPrint)}`, chunk.startX, totalsY, { width: 260 });
          chunk.doc.text(`Total expense: ${formatMoneyWithoutCurrency(expenseForPrint)}`, chunk.startX, totalsY + 16, { width: 260 });
          chunk.doc.text(`Ending balance: ${formatMoneyWithoutCurrency(opening.plus(incomeForPrint).minus(expenseForPrint))}`, chunk.startX, totalsY + 32, { width: 260 });
        }

        await new Promise<void>((resolve, reject) => {
          chunk.doc.end();
          chunk.writer.on('finish', () => resolve());
          chunk.writer.on('error', reject);
        });

        chunkFiles.push(chunk.filePath);
        chunkPageCounts.push(chunk.pageCount);
        totalPdfPages += chunk.pageCount;
      };

      let currentChunk: ReturnType<typeof createChunkDoc> | null = null;
      let seen = 0;
      let chunkRows = 0;
      let currentY = 0;

      const ensureCurrentChunk = () => {
        if (!currentChunk) {
          currentChunk = createChunkDoc();
          currentY = currentChunk.initialY;
          chunkRows = 0;
        }
        return currentChunk;
      };

      const finishCurrentChunk = async (includeTotals: boolean) => {
        if (!currentChunk) return;
        await finalizeChunk(currentChunk, includeTotals);
        currentChunk = null;
        currentY = 0;
        chunkRows = 0;
      };

      try {
        const cursorStream = Transaction.find(match).sort({ date: 1, createdAt: 1, _id: 1 }).lean().cursor();
        for await (const t of cursorStream) {
          const chunk = ensureCurrentChunk();

          if (chunkRows > 0 && currentY + chunk.rowHeight > chunk.doc.page.height - chunk.doc.page.margins.bottom - 20) {
            chunk.doc.addPage();
            chunk.pageCount += 1;
            currentY = chunk.doc.page.margins.top + 8;
            chunk.drawHeader(currentY);
            currentY += chunk.rowHeight;
          }

          seen += 1;
          chunkRows += 1;

          const amount = toDecimal(t.amount);
          const effect = getTransactionEffect(amount, t.type);
          const before = running;
          const after = before.plus(effect);
          running = after;

          if (t.type === TransactionType.INCOME) totalIncome = totalIncome.plus(amount);
          if (t.type === TransactionType.EXPENSE) totalExpense = totalExpense.plus(amount);

          const cells = [
            formatDisplayDate(t.date),
            t.type === TransactionType.INCOME ? 'Income' : 'Expense',
            formatMoneyWithoutCurrency(amount),
            resolveCategoryName(t.category, categoryMap),
            String(t.note ?? '-'),
            formatMoneyWithoutCurrency(before),
            formatMoneyWithoutCurrency(after),
          ];

          cells.forEach((val, i) => {
            chunk.doc.fontSize(8).text(String(val), chunk.colX[i], currentY, { width: chunk.colWidths[i], ellipsis: true });
          });

          currentY += chunk.rowHeight;

          if (chunkRows >= maxRowsPerChunk) {
            await finishCurrentChunk(false);
          }

          if (seen % 10000 === 0 && (global as any).gc) {
            (global as any).gc();
          }
        }

        if (currentChunk) {
          await finishCurrentChunk(true);
        } else if (chunkFiles.length === 0) {
          const emptyChunk = createChunkDoc();
          emptyChunk.doc.fontSize(10).text(`Total income: ${formatMoneyWithoutCurrency(totalIncome)}`, emptyChunk.startX, emptyChunk.initialY + 12, { width: 260 });
          emptyChunk.doc.text(`Total expense: ${formatMoneyWithoutCurrency(totalExpense)}`, emptyChunk.startX, emptyChunk.initialY + 26, { width: 260 });
          emptyChunk.doc.text(`Ending balance: ${formatMoneyWithoutCurrency(opening.plus(totalIncome).minus(totalExpense))}`, emptyChunk.startX, emptyChunk.initialY + 40, { width: 260 });
          await finalizeChunk(emptyChunk, false);
        }

        const finalPdfPath = path.join(chunkDir, `statement-${String(jobId)}.pdf`);
        await mergePdfFiles(chunkFiles, finalPdfPath);

        const res = await storage.put(`statement-${String(jobId)}.pdf`, fs.createReadStream(finalPdfPath));
        try { fs.unlinkSync(finalPdfPath); } catch {}
        for (const file of chunkFiles) { try { fs.unlinkSync(file); } catch {} }
        try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch {}

        job.fileKey = res.fileKey;
        const finalPageTotal = sumChunkPageCounts(chunkPageCounts);
        job.pages = finalPageTotal;
        job.totalPages = finalPageTotal;
        job.status = ExportJobStatus.COMPLETED;
        await job.save();
        return;
      } catch (err) {
        for (const file of chunkFiles) { try { fs.unlinkSync(file); } catch {} }
        try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch {}
        throw err;
      }
    }

    // XLSX streaming via exceljs
    if (format === ExportFormat.XLSX) {
      const tmpDir = os.tmpdir();
      const tmpName = `export-${String(jobId)}-${Date.now()}.xlsx`;
      const tmpPath = path.join(tmpDir, tmpName);

      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: tmpPath, useStyles: false });
      const sheet = workbook.addWorksheet('Sao ke');

      // header (write opening and a top-of-sheet summary using formulas so
      // totals remain visible even for very large streamed worksheets).
      sheet.addRow(['Statement Report']).commit();
      sheet.addRow([`Wallet: ${walletName}`]).commit();
      sheet.addRow([`From: ${formatDisplayDate(fromDate)}`]).commit();
      sheet.addRow([`To: ${formatDisplayDate(toDate)}`]).commit();
      sheet.addRow([]).commit();
      // Opening balance at row 6 (label in A6, value in B6).
      // Write numeric value so formulas like `B6 + B7 - B8` evaluate immediately.
      sheet.addRow(['Opening balance', Number(opening.toFixed(2))]).commit();

      // Top summary formulas (rows 7-9) — Excel will evaluate these on open.
      // If we precomputed totals via aggregation, set the `result` so the
      // values appear immediately (clients that don't auto-calc will still see them).
      const precomputedIncomeResult = totalsPrecomputed ? Number(precomputedTotalIncome.toFixed(2)) : 0;
      const precomputedExpenseResult = totalsPrecomputed ? Number(precomputedTotalExpense.toFixed(2)) : 0;
      const precomputedEndingResult = totalsPrecomputed ? Number(opening.plus(precomputedTotalIncome).minus(precomputedTotalExpense).toFixed(2)) : 0;
      // Sum Income in column C where Type in column B equals 'Income'.
      sheet.addRow(['Total income', { formula: 'SUMIF(B:B,"Income",C:C)', result: precomputedIncomeResult } as any]).commit();
      sheet.addRow(['Total expense', { formula: 'SUMIF(B:B,"Expense",C:C)', result: precomputedExpenseResult } as any]).commit();
      sheet.addRow(['Ending balance', { formula: 'B6 + B7 - B8', result: precomputedEndingResult } as any]).commit();

      // blank row before the table header
      sheet.addRow([]).commit();

      // Freeze top rows so the descriptive header and table header remain visible
      // when the sheet contains many rows. Freeze through row 11 (header at 11).
      try {
        sheet.views = [{ state: 'frozen', ySplit: 11 } as any];
      } catch (e) {
        // ignore if streaming writer doesn't support views in this environment
      }

      // table header (will be row 11)
      sheet.addRow(['Date', 'Type', 'Amount', 'Category', 'Note', 'Before balance', 'After balance']).commit();

      // stream transactions directly into sheet
      {
        const cursorStream = Transaction.find(match).sort({ date: 1, createdAt: 1, _id: 1 }).lean().cursor();
        let seen = 0;
        for await (const t of cursorStream) {
          seen += 1;
          const amount = toDecimal(t.amount);
          const effect = getTransactionEffect(amount, t.type);
          const before = running;
          const after = before.plus(effect);
          running = after;

          if (t.type === TransactionType.INCOME) totalIncome = totalIncome.plus(amount);
          if (t.type === TransactionType.EXPENSE) totalExpense = totalExpense.plus(amount);

          sheet.addRow([
            formatDisplayDate(t.date),
            t.type === TransactionType.INCOME ? 'Income' : 'Expense',
            // amount as numeric cell for SUMIF
            Number(amount.toFixed(2)),
            resolveCategoryName(t.category, categoryMap),
            t.note ?? '',
            // before/after numeric for correctness
            Number(before.toFixed(2)),
            Number(after.toFixed(2)),
          ]).commit();

          if (XLSX_PROGRESS_CHECKPOINTS.includes(seen) || seen % 10_000 === 0) {
            if ((global as any).gc) {
              (global as any).gc();
            }
          }
        }
      }

      // after iterating, write totals and finalize
      sheet.addRow([]).commit();
      sheet.addRow(['Total income', Number(totalIncome.toFixed(2))]).commit();
      sheet.addRow(['Total expense', Number(totalExpense.toFixed(2))]).commit();
      sheet.addRow(['Ending balance', Number(opening.plus(totalIncome).minus(totalExpense).toFixed(2))]).commit();

      await sheet.commit();
      await workbook.commit();

      const read = fs.createReadStream(tmpPath);
      const res = await storage.put(`statement-${String(jobId)}.xlsx`, read);
      try { fs.unlinkSync(tmpPath); } catch {}

      job.fileKey = res.fileKey;
      job.status = ExportJobStatus.COMPLETED;
      await job.save();
      return;
    }

    // If format unsupported
    throw new Error('unsupported format');
  } catch (err: any) {
    const jobErr = await ExportJob.findById(jobId);
    if (jobErr) {
      jobErr.status = ExportJobStatus.FAILED;
      jobErr.error = String(err?.message ?? err);
      await jobErr.save();
    }
    throw err;
  }
}
