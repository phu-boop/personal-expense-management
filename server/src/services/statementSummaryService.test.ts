import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateStatementSummary } from './statementSummaryService';

test('calculateStatementSummary keeps wallet opening balance when no transactions exist in the period', () => {
  const result = calculateStatementSummary({
    wallets: [
      { _id: 'wallet_1', initialBalance: 5000 },
      { _id: 'wallet_2', initialBalance: 2000 },
    ],
    openingByWallet: new Map(),
    totalIncome: 0,
    totalExpense: 0,
  });

  assert.equal(result.openingBalance, 7000);
  assert.equal(result.closingBalance, 7000);
});

test('calculateStatementSummary prefers prior balance before the period when available', () => {
  const result = calculateStatementSummary({
    wallets: [
      { _id: 'wallet_1', initialBalance: 5000 },
      { _id: 'wallet_2', initialBalance: 2000 },
    ],
    openingByWallet: new Map([['wallet_1', 12000]]),
    totalIncome: 1500,
    totalExpense: 500,
  });

  assert.equal(result.openingBalance, 14000);
  assert.equal(result.closingBalance, 15000);
});
