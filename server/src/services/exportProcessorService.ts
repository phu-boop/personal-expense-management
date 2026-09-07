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
import ExportJob, { ExportFormat, ExportJobStatus } from '../models/ExportJob';

export type ExportJobInput = {
  jobId: mongoose.Types.ObjectId;
  storage: StorageAdapter;
};

const formatDisplayDate = (value: Date | string | undefined | null) => {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatMoneyForExport = (value: Decimal | string | number | mongoose.Types.Decimal128 | null | undefined) => {
  const decimal = toDecimal(value ?? 0);
  return decimal.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatMoneyWithoutCurrency = (value: Decimal | string | number | mongoose.Types.Decimal128 | null | undefined) => {
  const decimal = toDecimal(value ?? 0);
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

// Helper: compute opening balance (reuse statement semantics)
async function computeOpeningBalance(tenantId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId, walletId: mongoose.Types.ObjectId, from: Date) {
  console.log('DIAG: computeOpeningBalance lookup', { tenantId: String(tenantId), userId: String(userId), walletId: String(walletId), from: from.toISOString() });
  const wallet = await Wallet.findOne({ _id: walletId, tenantId, userId }).lean();
  console.log('DIAG: computeOpeningBalance found wallet?', !!wallet);
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
    const cursor = Transaction.find(match).sort({ date: 1, createdAt: 1, _id: 1 }).lean().cursor();

    const categoryIds = new Set<string>();
    const transactionsForExport: Array<any> = [];
    for await (const t of cursor) {
      const categoryId = t?.category ? String(t.category) : '';
      if (categoryId) categoryIds.add(categoryId);
      transactionsForExport.push(t);
    }

    const categoryDocs = await Category.find({ _id: { $in: Array.from(categoryIds) } }, { _id: 1, name: 1 }).lean();
    const categoryMap: Record<string, string> = Object.fromEntries(categoryDocs.map((c: any) => [String(c._id), String(c.name)]));

    // totals
    let totalIncome = new Decimal(0);
    let totalExpense = new Decimal(0);
    let running = opening;

    const transactionRows = transactionsForExport.map((t: any) => {
      const amount = toDecimal(t.amount);
      const effect = getTransactionEffect(amount, t.type);
      const before = running;
      const after = before.plus(effect);
      running = after;

      if (t.type === TransactionType.INCOME) totalIncome = totalIncome.plus(amount);
      if (t.type === TransactionType.EXPENSE) totalExpense = totalExpense.plus(amount);

      return {
        date: t.date,
        type: t.type === TransactionType.INCOME ? 'Income' : 'Expense',
        amount,
        category: resolveCategoryName(t.category, categoryMap),
        note: t.note ?? '',
        before,
        after,
      };
    });

    // file generation
    if (format === ExportFormat.PDF) {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const pass = new stream.PassThrough();
      doc.pipe(pass);
        // Diagnostic: memory snapshot before writing transactions
        try {
          const mem = process.memoryUsage();
          console.log('[DIAG] memory before pdf write', { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed, external: mem.external });
        } catch (e) {
          console.log('[DIAG] memory before pdf write failed', String(e));
        }

      // Try to find a unicode TTF font that supports Vietnamese (Noto Sans / DejaVu / FreeSans)
      const candidateFonts = [
        process.env.PDF_FONT || '',
        path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.ttf'),
        path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf'),
        '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
      ].filter(Boolean as any) as string[];

      let chosenFont: string | null = null;
      for (const p of candidateFonts) {
        try {
          if (p && fs.existsSync(p)) {
            chosenFont = p;
            break;
          }
        } catch (e) {
          // ignore
        }
      }

      if (chosenFont) {
        try {
          doc.font(chosenFont);
          console.log('Using PDF font:', chosenFont);
        } catch (e) {
          console.warn('Failed to load PDF font', chosenFont, e);
        }
      } else {
        console.warn('No TTF font found for PDF generation; Vietnamese may not render correctly. Set PDF_FONT env or place NotoSans-Regular.ttf in assets/fonts.');
      }

      // write header
      doc.fontSize(18).text('Statement Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Wallet: ${walletName}`);
      doc.text(`From: ${formatDisplayDate(fromDate)}`);
      doc.text(`To: ${formatDisplayDate(toDate)}`);
      doc.moveDown();
      doc.text(`Opening balance: ${formatMoneyForExport(opening)}`);
      doc.moveDown(1.2);

      const tableLeft = 30;
      const tableTop = 200;
      const rowHeight = 18;
      const colWidths = [62, 52, 70, 72, 84, 72, 72];
      const colStarts: number[] = [tableLeft];
      for (let i = 1; i < colWidths.length; i += 1) {
        colStarts.push(colStarts[i - 1] + colWidths[i - 1]);
      }
      const tableHeight = rowHeight * (transactionRows.length + 2) + 10;

      doc.rect(tableLeft, tableTop, 520, tableHeight).stroke();
      doc.moveTo(tableLeft, tableTop + rowHeight).lineTo(tableLeft + 520, tableTop + rowHeight).stroke();

      const headers = ['Date', 'Type', 'Amount', 'Category', 'Note', 'Before', 'After'];
      headers.forEach((header, idx) => {
        const x = colStarts[idx] ?? tableLeft;
        const textX = x + 4;
        doc.fontSize(8).text(header, textX, tableTop + 5, { width: colWidths[idx] - 8, ellipsis: true });
        if (idx < headers.length - 1) {
          doc.moveTo(x, tableTop).lineTo(x, tableTop + tableHeight).stroke();
        }
      });

      const truncateCell = (value: string | number, maxLen: number) => {
        const text = String(value ?? '').replace(/\s+/g, ' ').trim();
        return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
      };

      const writerPromise = (async () => {
        try {
            let seen = 0;
            for (const row of transactionRows) {
              seen += 1;
              const y = tableTop + rowHeight * (seen + 1) + 2;
              const cells = [
                formatDisplayDate(row.date),
                row.type,
                formatMoneyWithoutCurrency(row.amount),
                row.category,
                row.note || '-',
                formatMoneyWithoutCurrency(row.before),
                formatMoneyWithoutCurrency(row.after),
              ];

              cells.forEach((value, idx) => {
                const x = colStarts[idx] ?? tableLeft;
                const width = colWidths[idx] ?? 60;
                doc.fontSize(7).text(truncateCell(value, Math.max(8, Math.floor(width / 6))), x + 2, y, { width: width - 5, ellipsis: true });
              });

              doc.moveTo(tableLeft, y + rowHeight - 2).lineTo(tableLeft + 520, y + rowHeight - 2).stroke();
              if (seen % 1000 === 0) {
                const mem = process.memoryUsage();
                console.log('[DIAG] progress', { jobId: String(jobId), seen, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal });
              }
          }

          const totalsY = tableTop + rowHeight * (transactionRows.length + 2) + 18;
          const totalsLeft = tableLeft + 10;
          doc.fontSize(9).text(`Total income: ${formatMoneyWithoutCurrency(totalIncome)}`, totalsLeft, totalsY, { width: 260 });
          doc.text(`Total expense: ${formatMoneyWithoutCurrency(totalExpense)}`, totalsLeft, totalsY + 16, { width: 260 });
          doc.text(`Ending balance: ${formatMoneyWithoutCurrency(opening.plus(totalIncome).minus(totalExpense))}`, totalsLeft, totalsY + 32, { width: 320 });
        } finally {
          try { doc.end(); } catch (e) { /* ignore */ }
            const mem = process.memoryUsage();
            console.log('[DIAG] memory after doc.end', { jobId: String(jobId), seen: transactionRows.length, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal });
        }
      })();

      // pipe to storage while writer runs; wait for both storage and writer to finish
      const putPromise = storage.put(`statement-${String(jobId)}.pdf`, pass);
      const [res] = await Promise.all([putPromise, writerPromise].map(p => Promise.resolve(p)));
        // Diagnostic: observe storage.put start
        console.log('[DIAG] starting storage.put for pdf', { jobId: String(jobId) });
        console.log('[DIAG] storage.put and writerPromise completed', { jobId: String(jobId), fileKey: res?.fileKey });

      job.fileKey = res.fileKey;
      job.status = ExportJobStatus.COMPLETED;
      await job.save();
      return;
    }

    // XLSX streaming via exceljs
    if (format === ExportFormat.XLSX) {
      const tmpDir = os.tmpdir();
      const tmpName = `export-${String(jobId)}-${Date.now()}.xlsx`;
      const tmpPath = path.join(tmpDir, tmpName);

      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: tmpPath, useStyles: false });
      const sheet = workbook.addWorksheet('Sao ke');

      // header (write opening and leave totals for after processing)
      sheet.addRow(['Statement Report']).commit();
      sheet.addRow([`Wallet: ${walletName}`]).commit();
      sheet.addRow([`From: ${formatDisplayDate(fromDate)}`]).commit();
      sheet.addRow([`To: ${formatDisplayDate(toDate)}`]).commit();
      sheet.addRow([]).commit();
      sheet.addRow(['Opening balance', formatMoneyForExport(opening)]).commit();
      sheet.addRow([]).commit();

      // table header
      sheet.addRow(['Date', 'Type', 'Amount', 'Category', 'Note', 'Before balance', 'After balance']).commit();

      for (const row of transactionRows) {
        sheet.addRow([
          formatDisplayDate(row.date),
          row.type,
          formatMoneyWithoutCurrency(row.amount),
          row.category,
          row.note,
          formatMoneyWithoutCurrency(row.before),
          formatMoneyWithoutCurrency(row.after),
        ]).commit();
      }

      // after iterating, write totals and finalize
      sheet.addRow([]).commit();
      sheet.addRow(['Total income', formatMoneyWithoutCurrency(totalIncome)]).commit();
      sheet.addRow(['Total expense', formatMoneyWithoutCurrency(totalExpense)]).commit();
      sheet.addRow(['Ending balance', formatMoneyWithoutCurrency(opening.plus(totalIncome).minus(totalExpense))]).commit();

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
