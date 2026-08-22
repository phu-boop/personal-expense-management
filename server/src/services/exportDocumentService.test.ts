import assert from 'node:assert/strict';
import { test } from 'node:test';
import XLSX from 'xlsx';
import { createStatementPdfBuffer, createStatementXlsxBuffer, resolvePdfFonts } from './exportDocumentService';

test('resolvePdfFonts picks a Unicode-capable font for Vietnamese text', () => {
  const fonts = resolvePdfFonts();
  assert.ok(fonts.regular || fonts.bold);
  const candidates = [fonts.regular, fonts.bold].filter(Boolean);
  assert.ok(candidates.some((candidate) => /dejavu|liberation|noto/i.test(candidate ?? '')));
});

test('createStatementPdfBuffer returns valid PDF bytes', async () => {
  const summary = {
    openingBalance: 1000000,
    totalIncome: 250000,
    totalExpense: 50000,
    closingBalance: 1200000,
  };

  const pdf = await createStatementPdfBuffer([
    { date: '2026-01-01', category: 'Food', note: 'Lunch', type: 'EXPENSE', amount: 50000, balanceAfter: 950000 },
  ], summary);

  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF');
  assert.ok(pdf.length > 1000);
});

test('createStatementXlsxBuffer returns valid XLSX bytes', () => {
  const summary = {
    openingBalance: 1000000,
    totalIncome: 250000,
    totalExpense: 50000,
    closingBalance: 1200000,
  };

  const xlsx = createStatementXlsxBuffer([
    { date: '2026-01-01', category: 'Food', note: 'Lunch', type: 'EXPENSE', amount: 50000, balanceAfter: 950000 },
  ], summary, { startDate: '2026-01-01', endDate: '2026-01-31' });

  assert.ok(Buffer.isBuffer(xlsx));
  assert.equal(xlsx.subarray(0, 2).toString('ascii'), 'PK');

  const workbook = XLSX.read(xlsx, { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Statement']);

  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets.Statement, { defval: '' });
  assert.deepEqual(sheet[0], {
    'Report Date': 'Metric',
    '2026-01-01 to 2026-01-31': 'Value',
    __EMPTY: '',
    __EMPTY_1: '',
    __EMPTY_2: '',
    __EMPTY_3: '',
  });
  assert.deepEqual(sheet[1], {
    'Report Date': 'Opening Balance',
    '2026-01-01 to 2026-01-31': 1000000,
    __EMPTY: '',
    __EMPTY_1: '',
    __EMPTY_2: '',
    __EMPTY_3: '',
  });
  assert.deepEqual(sheet[2], {
    'Report Date': 'Total Income',
    '2026-01-01 to 2026-01-31': 250000,
    __EMPTY: '',
    __EMPTY_1: '',
    __EMPTY_2: '',
    __EMPTY_3: '',
  });
  assert.deepEqual(sheet[3], {
    'Report Date': 'Total Expense',
    '2026-01-01 to 2026-01-31': 50000,
    __EMPTY: '',
    __EMPTY_1: '',
    __EMPTY_2: '',
    __EMPTY_3: '',
  });
  assert.deepEqual(sheet[4], {
    'Report Date': 'Closing Balance',
    '2026-01-01 to 2026-01-31': 1200000,
    __EMPTY: '',
    __EMPTY_1: '',
    __EMPTY_2: '',
    __EMPTY_3: '',
  });
  assert.deepEqual(sheet[5], {
    'Report Date': 'Date',
    '2026-01-01 to 2026-01-31': 'Category',
    __EMPTY: 'Description',
    __EMPTY_1: 'Type',
    __EMPTY_2: 'Amount',
    __EMPTY_3: 'Balance',
  });
  assert.deepEqual(sheet[6], {
    'Report Date': '2026-01-01',
    '2026-01-01 to 2026-01-31': 'Food',
    __EMPTY: 'Lunch',
    __EMPTY_1: 'EXPENSE',
    __EMPTY_2: 50000,
    __EMPTY_3: 950000,
  });
});
