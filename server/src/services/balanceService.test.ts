import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TransactionType } from '../models/Transaction';
import { calculateBalanceChange } from './balanceService';

test('income increases the balance', () => {
  assert.deepEqual(
    calculateBalanceChange(1000000, TransactionType.INCOME, 250000),
    { balanceBefore: 1000000, balanceAfter: 1250000 },
  );
});

test('expense decreases the balance', () => {
  assert.deepEqual(
    calculateBalanceChange(1000000, TransactionType.EXPENSE, 250000),
    { balanceBefore: 1000000, balanceAfter: 750000 },
  );
});

test('expense cannot make the balance negative', () => {
  assert.throws(
    () => calculateBalanceChange(100000, TransactionType.EXPENSE, 100001),
    /Insufficient balance in wallet/,
  );
});