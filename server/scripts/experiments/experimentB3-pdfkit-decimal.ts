import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import Decimal from 'decimal.js';

function formatDisplayDate(value: Date | string | undefined | null) {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatMoneyWithoutCurrency(value: Decimal | number | string | null | undefined) {
  const decimal = new Decimal(value ?? 0);
  return Number(decimal.toFixed(2)).toLocaleString('vi-VN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function memLog(prefix: string, startTs: number, rows: number) {
  const mem = process.memoryUsage();
  const elapsed = Date.now() - startTs;
  return `${prefix} seen=${rows} rss=${Math.round(mem.rss/1024/1024)}MB heapUsed=${Math.round(mem.heapUsed/1024/1024)}MB heapTotal=${Math.round(mem.heapTotal/1024/1024)}MB external=${Math.round(mem.external/1024/1024)}MB arrayBuffers=${Math.round((mem.arrayBuffers||0)/1024/1024)}MB elapsedMs=${elapsed}`;
}

async function waitStreamFinish(stream: fs.WriteStream | NodeJS.WritableStream) {
  return new Promise<void>((resolve, reject) => {
    (stream as any).on?.('finish', () => resolve());
    (stream as any).on?.('close', () => resolve());
    (stream as any).on?.('error', (err: Error) => reject(err));
  });
}

async function main() {
  const output = process.env.OUTPUT_PATH || '/dev/null';
  const maxRows = Number(process.env.MAX_ROWS || '1000000');
  const checkpoints = new Set([100000, 200000, 500000, 1000000].filter(n => n <= maxRows));

  console.log('Experiment B3 — PDFKit production-like + Decimal');
  console.log('OUTPUT_PATH:', output);
  console.log('MAX_ROWS:', maxRows);
  console.log('Checkpoints:', Array.from(checkpoints).sort((a,b)=>a-b));

  const outDir = path.dirname(output);
  if (outDir && outDir !== '/' && !fs.existsSync(outDir)) {
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { /* ignore */ }
  }

  const outStream = fs.createWriteStream(output);
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(outStream);

  // header similar to production
  doc.fontSize(18).text('Statement Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Wallet: Synthetic Wallet`);
  doc.text(`From: ${formatDisplayDate(new Date())}`);
  doc.text(`To: ${formatDisplayDate(new Date())}`);
  doc.moveDown();
  doc.text(`Opening balance: ${formatMoneyWithoutCurrency(new Decimal(1000000))}`);
  doc.moveDown();
  doc.fontSize(10).text('Date\tType\tAmount\tCategory\tNote\tBefore balance\tAfter balance');

  const startTs = Date.now();
  let seen = 0;

  // simulate production-like rows with Decimal calculations
  let running = new Decimal(1000000);

  const types = ['INCOME', 'EXPENSE'];
  const categories = ['Salary', 'Food', 'Transport', 'Shopping', 'Utilities', 'Other'];

  for (let i = 1; i <= maxRows; i++) {
    const amount = new Decimal((i % 100) + 1);
    const type = (i % 2 === 0) ? 'INCOME' : 'EXPENSE';
    const category = categories[i % categories.length];
    const note = `Note for transaction ${i}`;
    const before = running;
    const effect = type === 'INCOME' ? amount : amount.neg();
    const after = before.plus(effect);
    running = after;

    const line = `${formatDisplayDate(new Date())}\t${type}\t${formatMoneyWithoutCurrency(amount)}\t${category}\t${note}\t${formatMoneyWithoutCurrency(before)}\t${formatMoneyWithoutCurrency(after)}`;
    doc.fontSize(10).text(line);

    seen = i;
    if (checkpoints.has(i)) {
      console.log(memLog('[CHECK]', startTs, i));
      if ((global as any).gc) {
        (global as any).gc();
        const memAfter = process.memoryUsage();
        console.log(`[CHECK] after gc seen=${i} heapUsed=${Math.round(memAfter.heapUsed/1024/1024)}MB`);
      }
    }
  }

  doc.end();
  await waitStreamFinish(outStream);

  const mem = process.memoryUsage();
  console.log('[FINAL]', memLog('FINAL', startTs, seen));
  if ((global as any).gc) {
    (global as any).gc();
    const mem2 = process.memoryUsage();
    console.log('[FINAL] after gc heapUsed=', Math.round(mem2.heapUsed/1024/1024), 'MB');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
