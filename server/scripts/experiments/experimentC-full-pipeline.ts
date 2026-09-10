import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import stream from 'stream';
import PDFDocument from 'pdfkit';
import v8 from 'v8';
import Decimal from 'decimal.js';
import LocalFilesystemStorage from '../../src/services/storage/LocalFilesystemStorage';
import Transaction from '../../src/models/Transaction';

function maybeObjectId(id?: string) {
  if (!id) return undefined;
  try {
    if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  } catch (e) {}
  return id;
}

const formatDisplayDate = (value: Date | string | undefined | null) => {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatMoneyWithoutCurrency = (value: Decimal | number | string | null | undefined) => {
  const decimal = new Decimal(value ?? 0);
  return Number(decimal.toFixed(2)).toLocaleString('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

function memLog(prefix: string, startTs: number, rows: number) {
  const mem = process.memoryUsage();
  const elapsed = Date.now() - startTs;
  return `${prefix} seen=${rows} rss=${Math.round(mem.rss/1024/1024)}MB heapUsed=${Math.round(mem.heapUsed/1024/1024)}MB heapTotal=${Math.round(mem.heapTotal/1024/1024)}MB external=${Math.round(mem.external/1024/1024)}MB arrayBuffers=${Math.round((mem.arrayBuffers||0)/1024/1024)}MB elapsedMs=${elapsed}`;
}

async function waitStreamFinish(s: NodeJS.WritableStream | fs.WriteStream) {
  return new Promise<void>((resolve, reject) => {
    (s as any).on?.('finish', () => resolve());
    (s as any).on?.('close', () => resolve());
    (s as any).on?.('error', (err: Error) => reject(err));
  });
}

async function main() {
  const mongoUri = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.MONGO_DB || 'expense_manager';
  console.log('Using MONGO_URL:', mongoUri);
  console.log('Using MONGO_DB:', dbName);
  await mongoose.connect(mongoUri, { dbName });

  const tenantId = maybeObjectId(process.env.TENANT_ID);
  const walletId = maybeObjectId(process.env.WALLET_ID);
  const userId = maybeObjectId(process.env.USER_ID);
  const fromDate = process.env.FROM_DATE ? new Date(process.env.FROM_DATE) : new Date(0);
  const toDate = process.env.TO_DATE ? new Date(process.env.TO_DATE) : new Date();

  const match: any = { date: { $gte: fromDate, $lt: toDate } };
  if (tenantId) match.tenantId = tenantId;
  if (walletId) match.walletId = walletId;
  if (userId) match.userId = userId;

  console.log('Using match filter:', match);

  const totalCount = await Transaction.estimatedDocumentCount();
  const matchedCount = await Transaction.countDocuments(match);
  console.log('Collection total (estimated):', totalCount);
  console.log('Matched documents:', matchedCount);

  const cursor = Transaction.find(match).sort({ date: 1, createdAt: 1, _id: 1 }).lean().cursor();

  const collectThresholds = new Set([100000, 200000, 500000, 1000000]);
  let collected = 0;
  const transactionsForExport: Array<any> = [];
  // Expose for heap-snapshot analysis: a stable global reference so
  // the array is easy to locate in V8 heap snapshots.
  (globalThis as any).__transactionsForExport = transactionsForExport;
  const collectStart = Date.now();
  console.log('Collecting transactions into memory (production-like)');
  for await (const t of cursor) {
    transactionsForExport.push(t);
    collected++;
    if (collectThresholds.has(collected)) {
      console.log(memLog('[COLLECT]', collectStart, collected));
      // force GC and record before/after
      const before = process.memoryUsage();
      if ((global as any).gc) (global as any).gc();
      const after = process.memoryUsage();
      console.log('[COLLECT] before GC heapUsed=', Math.round(before.heapUsed/1024/1024), 'MB');
      console.log('[COLLECT] after GC heapUsed=', Math.round(after.heapUsed/1024/1024), 'MB');

      // write heap snapshot
      try {
        const snapDir = path.join(process.cwd(), 'heapsnapshots');
        try { fs.mkdirSync(snapDir, { recursive: true }); } catch (e) {}
        const snapPath = path.join(snapDir, `experimentC-collect-${collected}-${Date.now()}.heapsnapshot`);
        console.log('[COLLECT] writing heap snapshot to', snapPath);
        v8.writeHeapSnapshot(snapPath);
        console.log('[COLLECT] heap snapshot written');
      } catch (e: any) {
        console.warn('[COLLECT] heap snapshot failed', String(e));
      }

      // sample-based size estimate (avoid serializing entire array for large counts)
      try {
        const sampleN = Math.min(1000, transactionsForExport.length);
        let totalBytes = 0;
        for (let i = 0; i < sampleN; i++) {
          const s = JSON.stringify(transactionsForExport[i]);
          totalBytes += Buffer.byteLength(s, 'utf8');
        }
        const avg = sampleN > 0 ? totalBytes / sampleN : 0;
        console.log('[COLLECT] sampleEstimate avgBytesPerItem=', Math.round(avg), 'estimatedTotalMB=', Math.round((avg * transactionsForExport.length)/1024/1024));
      } catch (e) {
        console.warn('[COLLECT] sample estimate failed', String(e));
      }
    }
  }
  console.log('Collection phase completed, total collected=', collected);

  // Map to transactionRows using Decimal.js and production-like fields
  console.log('Mapping transactions to rows (using Decimal.js)');
  let running = new Decimal(0);
  const transactionRows = transactionsForExport.map((t: any, idx: number) => {
    const rawAmount = t.amount ?? 0;
    const amountForDecimal = (rawAmount && typeof rawAmount === 'object' && typeof rawAmount.toString === 'function') ? rawAmount.toString() : rawAmount;
    const amount = new Decimal(amountForDecimal);
    const type = t.type ?? 'EXPENSE';
    const effect = (type === 'INCOME') ? amount : amount.neg();
    const before = running;
    const after = before.plus(effect);
    running = after;
    return {
      date: t.date,
      type: type === 'INCOME' ? 'Income' : 'Expense',
      amount,
      category: t.category ?? '',
      note: t.note ?? '',
      before,
      after,
    };
  });
  console.log('Mapping completed, rows=', transactionRows.length);

  // PDF generation
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const pass = new stream.PassThrough();
  doc.pipe(pass);

  // storage
  const storage = new LocalFilesystemStorage();
  const putPromise = storage.put(`experimentC-${Date.now()}.pdf`, pass);

  // diagnostics before write
  try { console.log('[DIAG] memory before pdf write', process.memoryUsage()); } catch (e) {}

  // header
  doc.fontSize(18).text('Statement Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Wallet: ${String(walletId ?? 'ALL')}`);
  doc.text(`From: ${formatDisplayDate(fromDate)}`);
  doc.text(`To: ${formatDisplayDate(toDate)}`);
  doc.moveDown();
  doc.text(`Opening balance: ${formatMoneyWithoutCurrency(new Decimal(0))}`);
  doc.moveDown();
  doc.fontSize(10).text('Date\tType\tAmount\tCategory\tNote\tBefore balance\tAfter balance');

  // writer
  const writeThresholds = collectThresholds;
  let seen = 0;
  const writeStart = Date.now();

  for (const row of transactionRows) {
    seen++;
    doc.text(`${formatDisplayDate(row.date)}\t${row.type}\t${formatMoneyWithoutCurrency(row.amount)}\t${row.category}\t${row.note}\t${formatMoneyWithoutCurrency(row.before)}\t${formatMoneyWithoutCurrency(row.after)}`);
    if (writeThresholds.has(seen) || seen % 100000 === 0) {
      const mem = process.memoryUsage();
      console.log(memLog('[WRITE]', writeStart, seen));
      // PassThrough diagnostics
      console.log('[WRITE] pass writableLength=', (pass as any).writableLength, 'readableLength=', (pass as any).readableLength);
      if ((global as any).gc) { (global as any).gc(); const mem2 = process.memoryUsage(); console.log(`[WRITE] after gc seen=${seen} heapUsed=${Math.round(mem2.heapUsed/1024/1024)}MB`); }
    }
  }

  // finalize
  doc.end();
  await putPromise; // storage.put logs bytesWritten/finish
  await mongoose.disconnect();

  const memFinal = process.memoryUsage();
  console.log('[FINAL]', memLog('FINAL', writeStart, seen));
  if ((global as any).gc) { (global as any).gc(); const mem2 = process.memoryUsage(); console.log('[FINAL] after gc heapUsed=', Math.round(mem2.heapUsed/1024/1024), 'MB'); }
}

main().catch(err => { console.error(err); process.exit(1); });
