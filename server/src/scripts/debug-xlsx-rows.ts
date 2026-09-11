import XLSX from 'xlsx';
import fs from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: tsx debug-xlsx-rows.ts <path-to-xlsx>');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error('File not found:', file);
  process.exit(2);
}

const workbook = XLSX.readFile(file, { cellDates: false, type: 'file' });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });

const blocked = ['Statement Report', 'Wallet:', 'From:', 'To:', 'Opening balance', 'Total income', 'Total expense', 'Ending balance', 'Date'];

const nonHeader = rows.map((row, idx) => ({ idx: idx + 1, first: String(row[0] ?? '').trim(), row }));

const dataRows = nonHeader.filter(r => r.first !== '' && !blocked.includes(r.first));
console.log('Total rows read:', rows.length);
console.log('Data rows counted by filter:', dataRows.length);

console.log('\nSample first 40 rows with index and first column:');
nonHeader.slice(0, 40).forEach(r => console.log(r.idx, JSON.stringify(r.first)));

console.log('\nSample last 40 rows with index and first column:');
nonHeader.slice(-40).forEach(r => console.log(r.idx, JSON.stringify(r.first)));

console.log('\nListing unexpected first-column values (not blank, not blocked) with their indices):');
const unexpected = nonHeader.filter(r => r.first !== '' && !blocked.includes(r.first));
unexpected.forEach(r => console.log(r.idx, JSON.stringify(r.first)));

console.log('\nTotal unexpected entries:', unexpected.length);
