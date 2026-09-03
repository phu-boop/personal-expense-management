import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import { Readable } from 'stream';
import Transaction, { ITransaction, TransactionType } from '../models/Transaction';
import Wallet from '../models/Wallet';
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

    // Prepare cursor
    const match: any = { tenantId, walletId, date: { $gte: fromDate, $lt: toDate } };
    const cursor = Transaction.find(match).sort({ date: 1, createdAt: 1, _id: 1 }).lean().cursor();

    // totals
    let totalIncome = new Decimal(0);
    let totalExpense = new Decimal(0);
    let running = opening;

    // file generation
    if (format === ExportFormat.PDF) {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const pass = new stream.PassThrough();
      doc.pipe(pass);

      // write header (Vietnamese)
      doc.fontSize(18).text('Sao kê giao dịch', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Ví: ${String(walletId)}`);
      doc.text(`Từ ngày: ${fromDate.toISOString()}`);
      doc.text(`Đến ngày: ${toDate.toISOString()}`);
      doc.moveDown();
      doc.text(`Số dư đầu kỳ: ${opening.toFixed(2)}`);
      doc.moveDown();
      doc.fontSize(10).text('Ngày\tLoại giao dịch\tSố tiền\tDanh mục\tGhi chú\tSố dư trước\tSố dư sau');

      // start writer promise that iterates cursor and writes to doc; ensure doc.end() in finally
      const writerPromise = (async () => {
        try {
          for await (const t of cursor) {
            const effect = getTransactionEffect(toDecimal(t.amount), t.type);
            const before = running;
            const after = before.plus(effect);
            running = after;

            if (t.type === TransactionType.INCOME) totalIncome = totalIncome.plus(toDecimal(t.amount));
            if (t.type === TransactionType.EXPENSE) totalExpense = totalExpense.plus(toDecimal(t.amount));

            doc.text(`${t.date.toISOString()}\t${t.type === TransactionType.INCOME ? 'Thu' : 'Chi'}\t${toDecimal(t.amount).toFixed(2)}\t${t.category ?? ''}\t${t.note ?? ''}\t${before.toFixed(2)}\t${after.toFixed(2)}`);
          }
        } finally {
          try { doc.end(); } catch (e) { /* ignore */ }
        }
      })();

      // pipe to storage while writer runs; wait for both storage and writer to finish
      const putPromise = storage.put(`statement-${String(jobId)}.pdf`, pass);
      const [res] = await Promise.all([putPromise, writerPromise].map(p => Promise.resolve(p)));

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
      sheet.addRow(['Sao kê giao dịch']).commit();
      sheet.addRow([`Ví: ${String(walletId)}`]).commit();
      sheet.addRow([`Từ ngày: ${fromDate.toISOString()}`]).commit();
      sheet.addRow([`Đến ngày: ${toDate.toISOString()}`]).commit();
      sheet.addRow([]).commit();
      sheet.addRow(['Số dư đầu kỳ', opening.toFixed(2)]).commit();
      sheet.addRow([]).commit();

      // table header
      sheet.addRow(['Ngày', 'Loại giao dịch', 'Số tiền', 'Danh mục', 'Ghi chú', 'Số dư trước', 'Số dư sau']).commit();

      for await (const t of cursor) {
        const effect = getTransactionEffect(toDecimal(t.amount), t.type);
        const before = running;
        const after = before.plus(effect);
        running = after;

        if (t.type === TransactionType.INCOME) totalIncome = totalIncome.plus(toDecimal(t.amount));
        if (t.type === TransactionType.EXPENSE) totalExpense = totalExpense.plus(toDecimal(t.amount));

        const row = [t.date.toISOString(), t.type === TransactionType.INCOME ? 'Thu' : 'Chi', toDecimal(t.amount).toFixed(2), t.category ?? '', t.note ?? '', before.toFixed(2), after.toFixed(2)];
        sheet.addRow(row).commit();
      }

      // after iterating, write totals and finalize
      sheet.addRow([]).commit();
      sheet.addRow(['Tổng thu', totalIncome.toFixed(2)]).commit();
      sheet.addRow(['Tổng chi', totalExpense.toFixed(2)]).commit();
      sheet.addRow(['Số dư cuối kỳ', opening.plus(totalIncome).minus(totalExpense).toFixed(2)]).commit();

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
