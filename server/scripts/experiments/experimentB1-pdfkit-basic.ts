import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

function memLog(prefix: string, startTs: number, rows: number) {
  const mem = process.memoryUsage();
  const elapsed = Date.now() - startTs;
  return `${prefix} seen=${rows} rss=${Math.round(mem.rss/1024/1024)}MB heapUsed=${Math.round(mem.heapUsed/1024/1024)}MB heapTotal=${Math.round(mem.heapTotal/1024/1024)}MB external=${Math.round(mem.external/1024/1024)}MB arrayBuffers=${Math.round((mem.arrayBuffers||0)/1024/1024)}MB elapsedMs=${elapsed}`;
}

async function waitStreamFinish(stream: fs.WriteStream | NodeJS.WritableStream) {
  return new Promise<void>((resolve, reject) => {
    // stream may be a fs.WriteStream or other; listen for finish/error
    (stream as any).on?.('finish', () => resolve());
    (stream as any).on?.('close', () => resolve());
    (stream as any).on?.('error', (err: Error) => reject(err));
  });
}

async function main() {
  const output = process.env.OUTPUT_PATH || '/dev/null';
  const maxRows = Number(process.env.MAX_ROWS || '1000000');
  const checkpoints = new Set([100000, 200000, 500000, 1000000].filter(n => n <= maxRows));

  console.log('Experiment B1 — PDFKit simple text');
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

  // Header
  doc.fontSize(18).text('PDFKit Experiment B1', { align: 'center' });
  doc.moveDown();

  const startTs = Date.now();
  let seen = 0;

  for (let i = 1; i <= maxRows; i++) {
    seen = i;
    // simple static line; don't build heavy strings
    doc.fontSize(10).text(`Row ${i}: Sample description for experiment B1`);

    if (checkpoints.has(i)) {
      console.log(memLog('[CHECK]', startTs, i));
      if ((global as any).gc) {
        (global as any).gc();
        const memAfter = process.memoryUsage();
        console.log(`[CHECK] after gc seen=${i} heapUsed=${Math.round(memAfter.heapUsed/1024/1024)}MB`);
      }
    }
  }

  // finish
  doc.end();
  await waitStreamFinish(outStream);

  // final metrics
  const mem = process.memoryUsage();
  console.log('[FINAL]', memLog('FINAL', startTs, seen));
  if ((global as any).gc) {
    (global as any).gc();
    const mem2 = process.memoryUsage();
    console.log('[FINAL] after gc heapUsed=', Math.round(mem2.heapUsed/1024/1024), 'MB');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
