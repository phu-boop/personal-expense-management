import XLSX from 'xlsx';
import fs from 'fs';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction';
import config from '../config';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: tsx debug-compare-rows.ts <path-to-xlsx>');
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error('File not found:', file);
    process.exit(2);
  }

  await mongoose.connect(config.MONGO_URI);

  const workbook = XLSX.readFile(file, { cellDates: false, type: 'file' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });

  const blockedStarts = ['Statement Report', 'Wallet:', 'From:', 'To:', 'Opening balance', 'Total income', 'Total expense', 'Ending balance', 'Date'];

  const dataRows = rows.filter((row) => {
    if (!Array.isArray(row) || row.length === 0) return false;
    const first = String(row[0] ?? '').trim();
    if (first === '') return false;
    if (blockedStarts.some(b => first.startsWith(b))) return false;
    return true;
  });

  console.log('dataRowsCount', dataRows.length);

  // Build frequency map from sheet: key = date|type|amount
  const freq: Record<string, number> = {};
  dataRows.forEach((r) => {
    const date = String(r[0] ?? '').trim();
    const type = String(r[1] ?? '').trim();
    const amount = String(r[2] ?? '').replace(/[,\s]/g, '');
    const key = `${date}|${type}|${amount}`;
    freq[key] = (freq[key] || 0) + 1;
  });

  // Query DB for same grouping but convert date to ISO date string (day precision)
  // We will group by date string (dd/mm/yyyy as in sheet) using $dateToString if possible.

  // Since sheet dates are localized like '01/07/2024' (dd/MM/yyyy), normalize DB dates to that format.
  const agg = [
    { $match: { walletId: { $exists: true } } },
    { $project: { dateStr: { $dateToString: { format: "%d/%m/%Y", date: "$date" } }, type: 1, amount: 1 } },
    { $group: { _id: { dateStr: "$dateStr", type: "$type", amount: "$amount" }, count: { $sum: 1 } } },
  ];

  const groups = await Transaction.aggregate(agg).exec();

  const dbMap: Record<string, number> = {};
  groups.forEach((g: any) => {
    const k = `${g._id.dateStr}|${g._id.type === 'INCOME' ? 'Income' : 'Expense'}|${String(Number(g._id.amount))}`;
    dbMap[k] = g.count;
  });

  // Compare freq and dbMap to find discrepancies
  const allKeys = new Set<string>([...Object.keys(freq), ...Object.keys(dbMap)]);
  const diffs: Array<{ key: string; sheet: number; db: number }> = [];
  allKeys.forEach((k) => {
    const s = freq[k] ?? 0;
    const d = dbMap[k] ?? 0;
    if (s !== d) diffs.push({ key: k, sheet: s, db: d });
  });

  console.log('diffs count', diffs.length);
  diffs.slice(0, 50).forEach(d => console.log(JSON.stringify(d)));

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
